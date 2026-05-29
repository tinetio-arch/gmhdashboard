/**
 * CEO Revenue Breakdown API
 *
 * Returns revenue broken down by:
 *   1. Service category (Peptides, Pelleting/Hormone, Consultations, Injections, Shipped Orders, Other)
 *   2. Location/Brand (Men's Health, Primary Care, Longevity, ABXTAC, Unassigned)
 *   3. Payment type (Direct Stripe iPad, Healthie Recurring, Ship-to-Patient)
 *
 * Sources: payment_transactions (Direct Stripe) + Healthie billing cache
 *
 * GET /api/ipad/ceo/revenue-breakdown?period=today|week|month
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ────────────────────────────────────────────────────────────────────────
// Healthie one-time sales (requestedPayments → invoices Phil sends from
// Healthie UI). These are DIFFERENT from billing_items (the recurring
// subscription path that lives in Snowflake HEALTHIE_BILLING_ITEMS and
// powers the existing `healthie_recurring` figure). Until 2026-05-28
// they were invisible on the CEO dashboard. Phil flagged: "We often do
// one-time Healthie sales within Healthie. I do not see these purchases
// tracked in the CEO dashboard."
//
// Cached on the route module for 5 min so back-to-back loads don't pay
// the Healthie GraphQL roundtrip + pagination cost. The route returns the
// already-bucketed totals — single load is ~3 page fetches at 100/page.
// ────────────────────────────────────────────────────────────────────────

// Classification by offering.billing_frequency. Phil 2026-05-28: every paid
// requestedPayment is an offering charge; offering.billing_frequency tells
// us whether it's a recurring membership (Monthly/Weekly/etc.) or a true
// one-time charge (null/empty). Earlier hot-fix had labels inverted.
type HealthiePayment = {
  id: string;
  paid_at: string;
  price: number;
  billing_item_id: string | null;
  invoice_type: string | null;
  offering_id: string | null;
  offering_name: string | null;
  billing_frequency: string | null;  // raw string from Healthie ("Monthly", "Weekly", "", or null)
  is_recurring: boolean;
  patient: string;
};

type PeriodBucket = { total: number; count: number };

type HealthieBuckets = {
  cached_at: number;
  // recurring = paid invoices whose offering has a non-empty billing_frequency
  //            (subscription/membership auto-charges).
  // onetime   = paid invoices whose offering has no billing_frequency
  //            (ad-hoc / single charges).
  // Source of truth = Healthie GraphQL requestedPayments; the Snowflake
  // billing_items cache is intentionally NOT used for this split anymore
  // — it lumps both and forced a flawed dedup last patch.
  today: { recurring: PeriodBucket; onetime: PeriodBucket };
  week:  { recurring: PeriodBucket; onetime: PeriodBucket };
  month: { recurring: PeriodBucket; onetime: PeriodBucket };
  daily: Array<{ day: string; recurring: number; onetime: number; recurring_count: number; onetime_count: number }>;
  items: HealthiePayment[]; // up to ~500 most-recent for the granular list
};

let healthieCache: HealthieBuckets | null = null;
const HEALTHIE_TTL_MS = 5 * 60 * 1000;

function classifyRecurring(billing_frequency: string | null | undefined): boolean {
  if (!billing_frequency) return false;
  const v = String(billing_frequency).trim();
  if (!v || v === '0' || v.toLowerCase() === 'none' || v.toLowerCase() === 'null') return false;
  return true; // any other non-empty value (Monthly, Weekly, Yearly, an integer days, etc.) = recurring
}

async function getHealthieBuckets(): Promise<HealthieBuckets> {
  if (healthieCache && (Date.now() - healthieCache.cached_at) < HEALTHIE_TTL_MS) {
    return healthieCache;
  }
  const PAGE = 100;
  const MAX_PAGES = 6; // up to 600 paid invoices — covers 30d at Phil's volume
  const items: HealthiePayment[] = [];
  let offset = 0;
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const data = await healthieGraphQL<{
        requestedPayments: Array<{
          id: string;
          paid_at: string | null;
          price: string | null;
          billing_item_id: string | null;
          invoice_type: string | null;
          offering_id: string | null;
          offering: { id: string; name: string | null; billing_frequency: string | null } | null;
          recipient: { full_name: string | null } | null;
        }>;
      }>(
        `query CeoHealthieRev($status: String, $page: Int, $offset: Int) {
           requestedPayments(status_filter: $status, page_size: $page, offset: $offset, order_by: UPDATED_AT_DESC) {
             id paid_at price billing_item_id invoice_type offering_id
             offering { id name billing_frequency }
             recipient { full_name }
           }
         }`,
        { status: 'paid', page: PAGE, offset }
      );
      const batch = data.requestedPayments || [];
      if (batch.length === 0) break;
      for (const r of batch) {
        if (!r.paid_at) continue;
        const p = parseFloat(r.price || '0');
        if (!isFinite(p) || p <= 0) continue;
        const bf = r.offering?.billing_frequency ?? null;
        items.push({
          id: r.id,
          paid_at: r.paid_at,
          price: p,
          billing_item_id: r.billing_item_id || null,
          invoice_type: r.invoice_type || null,
          offering_id: r.offering_id || null,
          offering_name: r.offering?.name || null,
          billing_frequency: bf,
          is_recurring: classifyRecurring(bf),
          patient: r.recipient?.full_name || 'Unknown',
        });
      }
      const oldest = batch[batch.length - 1].paid_at;
      const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
      if (oldest && new Date(oldest).getTime() < cutoff) break;
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
  } catch (e) {
    console.error('[CEO Revenue] requestedPayments fetch failed:', e instanceof Error ? e.message : e);
  }
  const tzDay = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
  const nowDay = tzDay(new Date());
  const startOfWeek = (() => {
    const d = new Date();
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    return tzDay(monday);
  })();
  const startOfMonth = (() => {
    const d = new Date();
    return tzDay(new Date(d.getFullYear(), d.getMonth(), 1));
  })();
  const empty = (): { recurring: PeriodBucket; onetime: PeriodBucket } => ({
    recurring: { total: 0, count: 0 },
    onetime: { total: 0, count: 0 },
  });
  const todayB = empty();
  const weekB = empty();
  const monthB = empty();
  type DayBucket = { recurring: number; onetime: number; recurring_count: number; onetime_count: number };
  const byDay = new Map<string, DayBucket>();
  const acc = (b: { recurring: PeriodBucket; onetime: PeriodBucket }, p: number, isRec: boolean) => {
    if (isRec) {
      b.recurring.total += p;
      b.recurring.count += 1;
    } else {
      b.onetime.total += p;
      b.onetime.count += 1;
    }
  };
  for (const r of items) {
    const day = tzDay(new Date(r.paid_at));
    if (day >= nowDay) acc(todayB, r.price, r.is_recurring);
    if (day >= startOfWeek) acc(weekB, r.price, r.is_recurring);
    if (day >= startOfMonth) acc(monthB, r.price, r.is_recurring);
    const cur = byDay.get(day) || { recurring: 0, onetime: 0, recurring_count: 0, onetime_count: 0 };
    if (r.is_recurring) { cur.recurring += r.price; cur.recurring_count += 1; }
    else { cur.onetime += r.price; cur.onetime_count += 1; }
    byDay.set(day, cur);
  }
  const daily = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 60);
  healthieCache = {
    cached_at: Date.now(),
    today: todayB,
    week: weekB,
    month: monthB,
    daily,
    items,
  };
  return healthieCache;
}

// Service category rules — match on payment description
const CATEGORIES = [
  { key: 'peptides', label: 'Peptide Sales', icon: '💊', pattern: /bpc|tb[\s-]?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend/i },
  { key: 'pelleting', label: 'Pelleting & Hormone', icon: '💉', pattern: /pellet|hormone|testosterone|trt|hrt/i },
  { key: 'consults', label: 'Consultations', icon: '🩺', pattern: /consult|visit|sick|physical|eval|apob|mental|psych/i },
  { key: 'injections', label: 'Injections & IV', icon: '💧', pattern: /kenalog|injection|iv\s|infusion|therapy/i },
  { key: 'shipped', label: 'Shipped Orders', icon: '📦', pattern: /ship-to-patient|shipped/i },
];

function categorize(description: string): string {
  for (const cat of CATEGORIES) {
    if (cat.pattern.test(description)) return cat.key;
  }
  return 'other';
}

function getBrandFromClinic(clinic: string | null, clientType: string | null): string {
  const c = (clinic || '').toLowerCase();
  const t = (clientType || '').toLowerCase();
  if (t.includes('nowmenshealth') || t.includes('tcmh') || t.includes('f_f_fr_veteran') || t.includes('approved_disc') || t.includes('ins_supp')) return 'mens_health';
  if (t.includes('nowprimarycare') || t.includes('primecare')) return 'primary_care';
  if (t.includes('nowlongevity')) return 'longevity';
  if (t.includes('nowmentalhealth')) return 'mental_health';
  if (t.includes('abxtac')) return 'abxtac';
  if (c.includes('menshealth')) return 'mens_health';
  if (c.includes('primary')) return 'primary_care';
  return 'unassigned';
}

const BRAND_META: Record<string, { label: string; color: string }> = {
  mens_health: { label: 'NOW Men\'s Health', color: '#DC2626' },
  primary_care: { label: 'NOW Primary Care', color: '#060F6A' },
  longevity: { label: 'NOW Longevity', color: '#6B8F71' },
  mental_health: { label: 'NOW Mental Health', color: '#7C3AED' },
  abxtac: { label: 'ABXTAC', color: '#3A7D32' },
  unassigned: { label: 'Unassigned', color: '#6B7280' },
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'read');
    // CEO only
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'CEO access only' }, { status: 403 });
    }

    const period = request.nextUrl.searchParams.get('period') || 'month';
    const specificDate = request.nextUrl.searchParams.get('date'); // YYYY-MM-DD for drill-down

    let dateFilter: string;
    let dateLabel: string;
    // FIX(2026-04-09): Parameterize specificDate to prevent SQL injection
    // Previously used string interpolation: `'${specificDate}'::date`
    const dateParams: any[] = [];
    if (specificDate) {
      // Validate date format before using as parameter
      if (!/^\d{4}-\d{2}-\d{2}$/.test(specificDate)) {
        return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 });
      }
      dateFilter = `pt.created_at::date = $1::date`;
      dateParams.push(specificDate);
      dateLabel = specificDate;
    } else if (period === 'today') {
      dateFilter = `pt.created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date`;
      dateLabel = 'today';
    } else if (period === 'week') {
      dateFilter = `pt.created_at >= date_trunc('week', (NOW() AT TIME ZONE 'America/Phoenix')::date)`;
      dateLabel = 'this week';
    } else {
      dateFilter = `pt.created_at >= date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date)`;
      dateLabel = 'this month';
    }

    // Get all succeeded transactions for the period — EXCLUDE refunded
    const transactions = await query<any>(`
      SELECT pt.amount, pt.description, pt.stripe_account, pt.created_at,
             p.clinic, p.client_type_key, p.full_name as patient_name
      FROM payment_transactions pt
      LEFT JOIN patients p ON pt.patient_id = p.patient_id
      WHERE pt.status = 'succeeded' AND pt.amount > 0 AND ${dateFilter}
        AND pt.stripe_refund_id IS NULL
        AND pt.refunded_at IS NULL
      ORDER BY pt.created_at DESC
    `, dateParams);

    // Get refunded transactions for the period
    const refunds = await query<any>(`
      SELECT ABS(pt.amount) as amount, pt.description, pt.created_at,
             p.full_name as patient_name
      FROM payment_transactions pt
      LEFT JOIN patients p ON pt.patient_id = p.patient_id
      WHERE (pt.status = 'refund' OR pt.status = 'refunded') AND ${dateFilter}
      ORDER BY pt.created_at DESC
    `, dateParams).catch(() => []);

    // Get failed/declined charges
    const failedCharges = await query<any>(`
      SELECT pt.amount, pt.description, pt.created_at, pt.status,
             p.full_name as patient_name
      FROM payment_transactions pt
      LEFT JOIN patients p ON pt.patient_id = p.patient_id
      WHERE pt.status IN ('failed', 'error', 'declined') AND pt.amount > 0 AND ${dateFilter}
      ORDER BY pt.created_at DESC
    `, dateParams).catch(() => []);

    // By category
    const byCategory: Record<string, { count: number; total: number; label: string; icon: string }> = {};
    for (const cat of CATEGORIES) {
      byCategory[cat.key] = { count: 0, total: 0, label: cat.label, icon: cat.icon };
    }
    byCategory['other'] = { count: 0, total: 0, label: 'Other', icon: '💵' };

    // By brand/location
    const byBrand: Record<string, { count: number; total: number; label: string; color: string }> = {};
    for (const [key, meta] of Object.entries(BRAND_META)) {
      byBrand[key] = { count: 0, total: 0, ...meta };
    }

    // By payment type
    const byType: Record<string, { count: number; total: number; label: string }> = {
      direct_ipad: { count: 0, total: 0, label: 'Direct Stripe (iPad)' },
      shipped: { count: 0, total: 0, label: 'Ship-to-Patient' },
      healthie: { count: 0, total: 0, label: 'Healthie Billing' },
    };

    let grandTotal = 0;

    for (const tx of transactions) {
      const amt = parseFloat(tx.amount || 0);
      grandTotal += amt;

      // Category
      const cat = categorize(tx.description || '');
      if (byCategory[cat]) { byCategory[cat].count++; byCategory[cat].total += amt; }

      // Brand
      const brand = getBrandFromClinic(tx.clinic, tx.client_type_key);
      if (byBrand[brand]) { byBrand[brand].count++; byBrand[brand].total += amt; }

      // Type
      if ((tx.description || '').toLowerCase().includes('ship-to-patient')) {
        byType.shipped.count++; byType.shipped.total += amt;
      } else if (tx.stripe_account === 'healthie') {
        byType.healthie.count++; byType.healthie.total += amt;
      } else {
        byType.direct_ipad.count++; byType.direct_ipad.total += amt;
      }
    }

    // Healthie revenue — both recurring and one-time, classified from
    // requestedPayments(status_filter:"paid").offering.billing_frequency.
    // Source of truth = Healthie GraphQL. Snowflake cache no longer used
    // (it lumped recurring and one-time, which broke the previous patch).
    let healthieRecurring = 0;
    let healthieRecurringCount = 0;
    let healthieOnetime = 0;
    let healthieOnetimeCount = 0;
    let healthieDaily: Array<{ day: string; recurring: number; onetime: number; recurring_count: number; onetime_count: number }> = [];
    let healthieAllItems: HealthiePayment[] = [];
    try {
      const buckets = await getHealthieBuckets();
      healthieDaily = buckets.daily;
      healthieAllItems = buckets.items;
      let b: { recurring: { total: number; count: number }; onetime: { total: number; count: number } };
      if (specificDate) {
        const entry = buckets.daily.find(d => d.day === specificDate);
        b = entry
          ? { recurring: { total: entry.recurring, count: entry.recurring_count }, onetime: { total: entry.onetime, count: entry.onetime_count } }
          : { recurring: { total: 0, count: 0 }, onetime: { total: 0, count: 0 } };
      } else if (period === 'today') {
        b = buckets.today;
      } else if (period === 'week') {
        b = buckets.week;
      } else {
        b = buckets.month;
      }
      healthieRecurring = b.recurring.total;
      healthieRecurringCount = b.recurring.count;
      healthieOnetime = b.onetime.total;
      healthieOnetimeCount = b.onetime.count;
    } catch (e) {
      console.error('[CEO Revenue] healthie bucket lookup failed:', e instanceof Error ? e.message : e);
    }
    // Per-row items for the active period — split into the two buckets so
    // the UI can render two separate itemized lists.
    const { healthieRecurringItems, healthieOnetimeItems } = (() => {
      const tzDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
      const today = tzDay(new Date());
      const startOfWeek = (() => {
        const d = new Date();
        const day = d.getDay();
        const m = new Date(d);
        m.setDate(d.getDate() - ((day + 6) % 7));
        return tzDay(m);
      })();
      const startOfMonth = (() => {
        const d = new Date();
        return tzDay(new Date(d.getFullYear(), d.getMonth(), 1));
      })();
      const cutoff = specificDate ? specificDate
        : period === 'today' ? today
        : period === 'week' ? startOfWeek
        : startOfMonth;
      const eqOnly = !!specificDate;
      const inPeriod = healthieAllItems.filter(r => {
        const d = tzDay(new Date(r.paid_at));
        return eqOnly ? d === cutoff : d >= cutoff;
      });
      const mapItem = (r: HealthiePayment) => ({
        amount: r.price,
        patient: r.patient,
        paid_at: r.paid_at,
        offering: r.offering_name,
        billing_frequency: r.billing_frequency,
        invoice_type: r.invoice_type,
      });
      return {
        healthieRecurringItems: inPeriod.filter(r => r.is_recurring).map(mapItem),
        healthieOnetimeItems: inPeriod.filter(r => !r.is_recurring).map(mapItem),
      };
    })();

    // Top transactions
    const topTransactions = transactions.slice(0, 15).map((tx: any) => ({
      amount: parseFloat(tx.amount),
      description: tx.description,
      patient: tx.patient_name,
      date: tx.created_at,
      category: categorize(tx.description || ''),
    }));

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      stripe_data_source: 'payment_transactions (real-time)',
      healthie_data_source: 'Healthie GraphQL requestedPayments (5-min route cache)',
      classifier: 'offering.billing_frequency non-empty → recurring; otherwise one-time',
      period,
      grand_total: grandTotal,
      // RECURRING — paid invoices for offerings with a billing frequency
      // (Monthly/Weekly/etc.). These are membership / subscription auto-charges.
      healthie_recurring: healthieRecurring,
      healthie_recurring_count: healthieRecurringCount,
      // ONE-TIME — paid invoices for offerings with NO billing frequency.
      // Ad-hoc / single-charge invoices Phil sends manually.
      healthie_onetime: healthieOnetime,
      healthie_onetime_count: healthieOnetimeCount,
      // Combined total — direct + recurring + one-time. Single source of truth
      // per bucket; no double-count.
      combined_total: grandTotal + healthieRecurring + healthieOnetime,
      // Per-row itemization for each bucket, scoped to the active period.
      healthie_recurring_items: healthieRecurringItems,
      healthie_onetime_items: healthieOnetimeItems,
      by_category: Object.entries(byCategory)
        .map(([k, v]) => ({ key: k, ...v }))
        .filter(c => c.total > 0)
        .sort((a, b) => b.total - a.total),
      by_brand: Object.entries(byBrand)
        .map(([k, v]) => ({ key: k, ...v }))
        .filter(b => b.total > 0)
        .sort((a, b) => b.total - a.total),
      by_type: Object.entries(byType)
        .map(([k, v]) => ({ key: k, ...v }))
        .filter(t => t.total > 0)
        .sort((a, b) => b.total - a.total),
      transaction_count: transactions.length,
      top_transactions: topTransactions,
      date_label: dateLabel,
      // Daily breakdown: stripe + healthie_recurring + healthie_onetime per day
      daily_history: await (async () => {
        try {
          const stripeDays = await query<any>(`
            SELECT created_at::date as day, COUNT(*) as txns, SUM(amount)::numeric(10,2) as total
            FROM payment_transactions
            WHERE status = 'succeeded' AND amount > 0 AND stripe_refund_id IS NULL
              AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY created_at::date ORDER BY day DESC
          `);
          const dayMap: Record<string, { stripe: number; healthie: number; healthie_onetime: number; total: number; txns: number }> = {};
          for (const d of stripeDays) {
            const day = typeof d.day === 'string' ? d.day : d.day.toISOString().split('T')[0];
            if (!dayMap[day]) dayMap[day] = { stripe: 0, healthie: 0, healthie_onetime: 0, total: 0, txns: 0 };
            dayMap[day].stripe = parseFloat(d.total);
            dayMap[day].txns = parseInt(d.txns);
          }
          for (const d of healthieDaily) {
            if (!dayMap[d.day]) dayMap[d.day] = { stripe: 0, healthie: 0, healthie_onetime: 0, total: 0, txns: 0 };
            dayMap[d.day].healthie = d.recurring;
            dayMap[d.day].healthie_onetime = d.onetime;
            dayMap[d.day].txns += d.recurring_count + d.onetime_count;
          }
          Object.values(dayMap).forEach(d => d.total = d.stripe + d.healthie + d.healthie_onetime);
          return Object.entries(dayMap)
            .map(([day, data]) => ({ day, ...data }))
            .sort((a, b) => b.day.localeCompare(a.day))
            .slice(0, 30);
        } catch { return []; }
      })(),
      refunds: {
        count: refunds.length,
        total: refunds.reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0),
        items: refunds.slice(0, 10).map((r: any) => ({
          amount: parseFloat(r.amount),
          description: r.description,
          patient: r.patient_name,
          date: r.created_at,
        })),
      },
      failed_charges: {
        count: failedCharges.length,
        total: failedCharges.reduce((s: number, f: any) => s + parseFloat(f.amount || 0), 0),
        items: failedCharges.slice(0, 10).map((f: any) => ({
          amount: parseFloat(f.amount),
          description: f.description,
          patient: f.patient_name,
          status: f.status,
          date: f.created_at,
        })),
      },
      // FIX(2026-04-09): Healthie recurring failures weren't showing — they only exist
      // in patients.notes + alert_status, NOT in payment_transactions
      payment_holds: await (async () => {
        try {
          const holds = await query<any>(`
            SELECT full_name, client_type, membership_owes, notes,
                   updated_at
            FROM patients
            WHERE alert_status = 'Hold - Payment Research'
            ORDER BY updated_at DESC
          `);
          return {
            count: holds.length,
            total_owes: holds.reduce((s: number, h: any) => s + parseFloat(h.membership_owes || 0), 0),
            patients: holds.map((h: any) => {
              // Extract most recent failure note
              const failNote = (h.notes || '').split('\n')
                .filter((l: string) => /PAYMENT FAILED|PAYMENT DECLINED/i.test(l))
                .pop() || null;
              return {
                patient: h.full_name,
                package: h.client_type || 'Unknown',
                owes: parseFloat(h.membership_owes || 0),
                last_failure: failNote,
              };
            }),
          };
        } catch { return { count: 0, total_owes: 0, patients: [] }; }
      })(),
      // Recurring revenue by package — active patients grouped by client_type
      recurring_by_package: await (async () => {
        try {
          const packages = await query<any>(`
            SELECT client_type,
                   count(*) as active_patients,
                   SUM(membership_owes) as total_outstanding
            FROM patients
            WHERE status_key NOT IN ('inactive', 'discharged', 'hold_payment_research')
              AND client_type IS NOT NULL
            GROUP BY client_type
            ORDER BY count(*) DESC
          `);
          // Extract monthly rate from client_type name (e.g. "PrimeCare Premier $50/Month" → 50)
          return packages.map((p: any) => {
            const match = (p.client_type || '').match(/\$(\d+)/);
            const monthlyRate = match ? parseInt(match[1]) : 0;
            const count = parseInt(p.active_patients);
            return {
              package: p.client_type,
              active_patients: count,
              monthly_rate: monthlyRate,
              estimated_mrr: monthlyRate * count,
              outstanding: parseFloat(p.total_outstanding || 0),
            };
          });
        } catch { return []; }
      })(),
    });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Revenue Breakdown] Error:', error);
    return NextResponse.json({ error: 'Failed to load revenue breakdown' }, { status: 500 });
  }
}

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

type OnetimeItem = {
  id: string;
  paid_at: string;
  price: number;
  billing_item_id: string | null;     // when set → also in HEALTHIE_BILLING_ITEMS
  invoice_type: string | null;
  patient: string;
};

type OnetimeBuckets = {
  cached_at: number;
  // Three totals per period:
  //   total_paid    = all paid requestedPayments (what Phil thinks of as "one-time")
  //   overlap       = subset that has a billing_item_id (already in recurring cache;
  //                   we MUST subtract this from recurring to avoid double-count)
  //   pure_onetime  = total_paid − overlap (in our data this is usually 0 — Healthie
  //                   creates a billing_item every time a paid invoice clears Stripe)
  today: { total_paid: number; overlap: number; pure_onetime: number };
  week:  { total_paid: number; overlap: number; pure_onetime: number };
  month: { total_paid: number; overlap: number; pure_onetime: number };
  daily: Array<{ day: string; total_paid: number; overlap: number; pure_onetime: number; count: number }>;
  items: OnetimeItem[]; // up to ~500 most-recent for the granular list
};

let onetimeCache: OnetimeBuckets | null = null;
const ONETIME_TTL_MS = 5 * 60 * 1000;

async function getHealthieOnetimeBuckets(): Promise<OnetimeBuckets> {
  if (onetimeCache && (Date.now() - onetimeCache.cached_at) < ONETIME_TTL_MS) {
    return onetimeCache;
  }
  const PAGE = 100;
  const MAX_PAGES = 5; // 500 paid invoices is well past 30d for our volume
  const items: OnetimeItem[] = [];
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
          recipient: { full_name: string | null } | null;
        }>;
      }>(
        `query CeoOnetime($status: String, $page: Int, $offset: Int) {
           requestedPayments(status_filter: $status, page_size: $page, offset: $offset, order_by: UPDATED_AT_DESC) {
             id paid_at price billing_item_id invoice_type
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
        items.push({
          id: r.id,
          paid_at: r.paid_at,
          price: p,
          billing_item_id: r.billing_item_id || null,
          invoice_type: r.invoice_type || null,
          patient: r.recipient?.full_name || 'Unknown',
        });
      }
      // Once the oldest in this batch is older than 35 days back we can stop
      const oldest = batch[batch.length - 1].paid_at;
      const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
      if (oldest && new Date(oldest).getTime() < cutoff) break;
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
  } catch (e) {
    console.error('[CEO Revenue] requestedPayments fetch failed:', e instanceof Error ? e.message : e);
    // Fall through with whatever we accumulated (likely none)
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
  const emptyBucket = () => ({ total_paid: 0, overlap: 0, pure_onetime: 0 });
  const todayB = emptyBucket();
  const weekB = emptyBucket();
  const monthB = emptyBucket();
  type DayBucket = { total_paid: number; overlap: number; pure_onetime: number; count: number };
  const byDay = new Map<string, DayBucket>();
  const acc = (b: { total_paid: number; overlap: number; pure_onetime: number }, p: number, hasOverlap: boolean) => {
    b.total_paid += p;
    if (hasOverlap) b.overlap += p;
    else b.pure_onetime += p;
  };
  for (const r of items) {
    const day = tzDay(new Date(r.paid_at));
    const hasOverlap = !!r.billing_item_id; // paid req-payment has a corresponding billing_item
    if (day >= nowDay) acc(todayB, r.price, hasOverlap);
    if (day >= startOfWeek) acc(weekB, r.price, hasOverlap);
    if (day >= startOfMonth) acc(monthB, r.price, hasOverlap);
    const cur = byDay.get(day) || { total_paid: 0, overlap: 0, pure_onetime: 0, count: 0 };
    cur.total_paid += r.price;
    if (hasOverlap) cur.overlap += r.price; else cur.pure_onetime += r.price;
    cur.count += 1;
    byDay.set(day, cur);
  }
  const daily = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 60);
  onetimeCache = {
    cached_at: Date.now(),
    today: todayB,
    week: weekB,
    month: monthB,
    daily,
    items,
  };
  return onetimeCache;
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

    // Also get Healthie recurring revenue from cache
    let healthieRecurring = 0;
    try {
      const fs = require('fs');
      const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
      if (specificDate) {
        const entry = (cache.daily || []).find((d: any) => d.day === specificDate);
        healthieRecurring = entry?.amount || 0;
      } else if (period === 'today') {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const entry = (cache.daily || []).find((d: any) => d.day === today);
        healthieRecurring = entry?.amount || 0;
      } else if (period === 'week') {
        healthieRecurring = cache.day7 || 0;
      } else {
        healthieRecurring = cache.day30 || 0;
      }
    } catch { /* cache unavailable */ }

    // Healthie one-time sales (requestedPayments) + overlap-dedup against the
    // recurring cache. CRITICAL: Healthie creates a billing_item every time a
    // paid invoice clears Stripe, so the paid requestedPayment ALSO sits in
    // HEALTHIE_BILLING_ITEMS — which is what `healthie_recurring` sums. Phil
    // caught this on 2026-05-28 looking at the dashboard the same day I shipped
    // the one-time bucket: the total was inflated by the overlap.
    //
    // Resolution (no double-count):
    //   healthie_onetime           = paid requestedPayments (full $ — what
    //                                Phil intuitively wants to see in the
    //                                "one-time invoices" bucket)
    //   healthie_recurring_pure    = healthie_recurring − overlap (true
    //                                subscriptions/packages, no paid invoices
    //                                folded in)
    //   combined_total             = direct + healthie_recurring_pure + healthie_onetime
    //                              ≡ direct + healthie_recurring + healthie_onetime_pure
    // We expose all four values so the UI can show "what's truly recurring
    // vs what's invoices" and the dashboard math adds up exactly once.
    let healthieOnetime = 0;
    let healthieOnetimeOverlap = 0;
    let healthieOnetimePure = 0;
    let healthieOnetimeDaily: Array<{ day: string; total_paid: number; overlap: number; pure_onetime: number; count: number }> = [];
    let healthieOnetimeItems: OnetimeItem[] = [];
    try {
      const buckets = await getHealthieOnetimeBuckets();
      healthieOnetimeDaily = buckets.daily;
      healthieOnetimeItems = buckets.items;
      let b: { total_paid: number; overlap: number; pure_onetime: number };
      if (specificDate) {
        const entry = buckets.daily.find(d => d.day === specificDate);
        b = entry
          ? { total_paid: entry.total_paid, overlap: entry.overlap, pure_onetime: entry.pure_onetime }
          : { total_paid: 0, overlap: 0, pure_onetime: 0 };
      } else if (period === 'today') {
        b = buckets.today;
      } else if (period === 'week') {
        b = buckets.week;
      } else {
        b = buckets.month;
      }
      healthieOnetime = b.total_paid;
      healthieOnetimeOverlap = b.overlap;
      healthieOnetimePure = b.pure_onetime;
    } catch (e) {
      console.error('[CEO Revenue] healthie one-time bucket lookup failed:', e instanceof Error ? e.message : e);
    }
    // Subtract overlap from the recurring figure → "pure recurring" =
    // subscriptions/packages NOT created by a paid invoice.
    const healthieRecurringPure = Math.max(0, healthieRecurring - healthieOnetimeOverlap);
    // Items list for the One-Time card, scoped to the active period (so the
    // drill-down on a specific day shows only that day's invoices).
    const onetimeItemsForPeriod = (() => {
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
      const cutoff = specificDate
        ? specificDate
        : period === 'today' ? today
        : period === 'week' ? startOfWeek
        : startOfMonth;
      const eqOnly = !!specificDate;
      return healthieOnetimeItems
        .filter(r => {
          const d = tzDay(new Date(r.paid_at));
          return eqOnly ? d === cutoff : d >= cutoff;
        })
        .map(r => ({
          amount: r.price,
          patient: r.patient,
          paid_at: r.paid_at,
          invoice_type: r.invoice_type,
          billing_item_id: r.billing_item_id,
          double_counted_in_recurring: !!r.billing_item_id,
        }));
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
      healthie_data_source: 'billing cache (refreshes every 15 min)',
      healthie_onetime_source: 'Healthie GraphQL requestedPayments (5-min route cache)',
      period,
      grand_total: grandTotal,
      // Recurring figure on the dashboard — dedupes the paid invoices that
      // also live in the cache. This is "true" recurring (subscriptions/packages).
      healthie_recurring: healthieRecurringPure,
      // Raw cache total (recurring + paid-invoice overlap) — kept for the
      // audit-trail / data-source label only; UI should NOT add this back in.
      healthie_recurring_raw_cache: healthieRecurring,
      // One-time invoices Phil sent from Healthie UI. Full value (includes both
      // those that overlap with the cache and those that don't).
      healthie_onetime: healthieOnetime,
      healthie_onetime_overlap_in_recurring: healthieOnetimeOverlap,
      healthie_onetime_pure: healthieOnetimePure,
      // Combined total — adds direct iPad Stripe + true recurring + one-time
      // (no double-count because we subtracted the overlap from recurring).
      combined_total: grandTotal + healthieRecurringPure + healthieOnetime,
      // Per-row itemization for the One-Time card.
      healthie_onetime_items: onetimeItemsForPeriod,
      healthie_onetime_count: onetimeItemsForPeriod.length,
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
      // Daily breakdown from all three sources
      daily_history: await (async () => {
        try {
          // Direct Stripe daily
          const stripeDays = await query<any>(`
            SELECT created_at::date as day, COUNT(*) as txns, SUM(amount)::numeric(10,2) as total
            FROM payment_transactions
            WHERE status = 'succeeded' AND amount > 0 AND stripe_refund_id IS NULL
              AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY created_at::date ORDER BY day DESC
          `);
          // Healthie recurring daily from cache
          const fs = require('fs');
          let healthieDays: any[] = [];
          try {
            const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
            healthieDays = cache.daily || [];
          } catch {}
          // Merge stripe + healthie recurring + healthie one-time into combined daily view
          const dayMap: Record<string, { stripe: number; healthie: number; healthie_onetime: number; total: number; txns: number }> = {};
          for (const d of stripeDays) {
            const day = typeof d.day === 'string' ? d.day : d.day.toISOString().split('T')[0];
            if (!dayMap[day]) dayMap[day] = { stripe: 0, healthie: 0, healthie_onetime: 0, total: 0, txns: 0 };
            dayMap[day].stripe = parseFloat(d.total);
            dayMap[day].txns = parseInt(d.txns);
          }
          for (const d of healthieDays) {
            if (!dayMap[d.day]) dayMap[d.day] = { stripe: 0, healthie: 0, healthie_onetime: 0, total: 0, txns: 0 };
            dayMap[d.day].healthie = d.amount;
          }
          for (const d of healthieOnetimeDaily) {
            if (!dayMap[d.day]) dayMap[d.day] = { stripe: 0, healthie: 0, healthie_onetime: 0, total: 0, txns: 0 };
            dayMap[d.day].healthie_onetime = d.total_paid;
            // Subtract per-day overlap so the "healthie" column shows pure
            // subscriptions/packages, not paid invoices that are also in the
            // one-time bucket. Without this the per-day rows would also
            // double-count.
            dayMap[d.day].healthie = Math.max(0, dayMap[d.day].healthie - d.overlap);
            dayMap[d.day].txns += d.count;
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

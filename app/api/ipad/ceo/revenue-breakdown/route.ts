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

export const dynamic = 'force-dynamic';

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
    if ((user as any).email !== 'admin@nowoptimal.com') {
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
      if (period === 'today') {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const entry = (cache.daily || []).find((d: any) => d.day === today);
        healthieRecurring = entry?.amount || 0;
      } else if (period === 'week') {
        healthieRecurring = cache.day7 || 0;
      } else {
        healthieRecurring = cache.day30 || 0;
      }
    } catch { /* cache unavailable */ }

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
      period,
      grand_total: grandTotal,
      healthie_recurring: healthieRecurring,
      combined_total: grandTotal + healthieRecurring,
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
      // Daily breakdown from both sources
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
          // Healthie daily from cache
          const fs = require('fs');
          let healthieDays: any[] = [];
          try {
            const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
            healthieDays = cache.daily || [];
          } catch {}
          // Merge into combined daily view
          const dayMap: Record<string, { stripe: number; healthie: number; total: number; txns: number }> = {};
          for (const d of stripeDays) {
            const day = typeof d.day === 'string' ? d.day : d.day.toISOString().split('T')[0];
            if (!dayMap[day]) dayMap[day] = { stripe: 0, healthie: 0, total: 0, txns: 0 };
            dayMap[day].stripe = parseFloat(d.total);
            dayMap[day].txns = parseInt(d.txns);
          }
          for (const d of healthieDays) {
            if (!dayMap[d.day]) dayMap[d.day] = { stripe: 0, healthie: 0, total: 0, txns: 0 };
            dayMap[d.day].healthie = d.amount;
          }
          Object.values(dayMap).forEach(d => d.total = d.stripe + d.healthie);
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
    });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Revenue Breakdown] Error:', error);
    return NextResponse.json({ error: 'Failed to load revenue breakdown' }, { status: 500 });
  }
}

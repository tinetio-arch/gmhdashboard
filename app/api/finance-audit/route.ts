import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

// In-memory cache: { data, timestamp }
let cache: { data: FinanceAuditRow[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface PatientRow {
  patient_id: string;
  full_name: string;
  healthie_client_id: string | null;
  status_key: string;
  payment_method_key: string | null;
  clinic: string;
  regimen: string | null;
  has_testosterone_dispense: boolean;
}

interface FinanceAuditRow extends PatientRow {
  has_recurring_payment: boolean;
  recurring_amount: string | null;
  next_payment_date: string | null;
  has_card_on_file: boolean;
  card_info: string | null;
}

/**
 * GET /api/finance-audit
 * Returns all active/hold patients with Healthie billing status.
 * Results cached for 1 hour to avoid Healthie rate limits.
 * Pass ?refresh=true to force a fresh fetch.
 */
export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Return cached data if still fresh
    if (cache && !forceRefresh && (Date.now() - cache.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json({ data: cache.data, cached: true, cached_at: new Date(cache.timestamp).toISOString() });
    }

    const pool = getPool();

    // Fetch all active/hold patients from DB
    const { rows: patients } = await pool.query<PatientRow>(`
      SELECT
        p.patient_id,
        p.full_name,
        p.healthie_client_id,
        p.status_key,
        p.payment_method_key,
        COALESCE(p.clinic, '') as clinic,
        p.regimen,
        CASE WHEN EXISTS (
          SELECT 1 FROM dispenses d WHERE d.patient_id = p.patient_id
        ) THEN true ELSE false END as has_testosterone_dispense
      FROM patients p
      WHERE p.status_key IN ('active', 'active_pending', 'hold_payment_research')
      ORDER BY p.full_name
    `);

    // Batch query Healthie for recurring payment + card info
    const results: FinanceAuditRow[] = [];
    const patientsWithHealthieId = patients.filter(p => p.healthie_client_id);
    const patientsWithoutHealthieId = patients.filter(p => !p.healthie_client_id);

    // Add patients without Healthie IDs directly (no Healthie data)
    for (const p of patientsWithoutHealthieId) {
      results.push({
        ...p,
        has_recurring_payment: false,
        recurring_amount: null,
        next_payment_date: null,
        has_card_on_file: false,
        card_info: null,
      });
    }

    // Batch Healthie queries: 10 per request, 1s delay between batches
    const BATCH_SIZE = 10;

    for (let i = 0; i < patientsWithHealthieId.length; i += BATCH_SIZE) {
      const batch = patientsWithHealthieId.slice(i, i + BATCH_SIZE);

      const aliases = batch.map((p, idx) => `
        u${idx}: user(id: "${p.healthie_client_id}") {
          id
          next_recurring_payment { amount_paid start_at }
          stripe_customer_detail { card_type_label last_four }
        }
      `).join('\n');

      try {
        const data = await healthieGraphQL<Record<string, any>>(`query { ${aliases} }`);

        for (let idx = 0; idx < batch.length; idx++) {
          const patient = batch[idx];
          const user = data?.[`u${idx}`];
          const recurring = user?.next_recurring_payment;
          const card = user?.stripe_customer_detail;

          results.push({
            ...patient,
            has_recurring_payment: !!recurring?.amount_paid,
            recurring_amount: recurring?.amount_paid || null,
            next_payment_date: recurring?.start_at?.split(' ')[0] || null,
            has_card_on_file: !!card?.card_type_label,
            card_info: card?.card_type_label ? `${card.card_type_label} ****${card.last_four}` : null,
          });
        }
      } catch (err) {
        console.error(`[finance-audit] Healthie batch ${i / BATCH_SIZE + 1} error:`, err);
        // Still include these patients with unknown Healthie status
        for (const patient of batch) {
          results.push({
            ...patient,
            has_recurring_payment: false,
            recurring_amount: null,
            next_payment_date: null,
            has_card_on_file: false,
            card_info: null,
          });
        }
      }

      // Rate limit delay between batches
      if (i + BATCH_SIZE < patientsWithHealthieId.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Sort by name
    results.sort((a, b) => a.full_name.localeCompare(b.full_name));

    // Cache the results
    cache = { data: results, timestamp: Date.now() };

    return NextResponse.json({
      data: results,
      cached: false,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[finance-audit] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

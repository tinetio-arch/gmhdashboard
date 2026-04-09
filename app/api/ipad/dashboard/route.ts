import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { getTestosteroneInventoryByVendor } from '@/lib/testosteroneInventory';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  try {
    const [stagedDoses, paymentIssues, todayPatients, revenueData, activePatientCount, patientsByType] = await Promise.all([
      // Today's staged doses
      query<any>(`
        SELECT
          sd.staged_dose_id,
          sd.patient_id,
          sd.patient_name,
          sd.dose_ml,
          sd.waste_ml,
          sd.syringe_count,
          sd.total_ml,
          sd.vendor,
          sd.vial_external_id,
          sd.staged_for_date,
          sd.staged_by_name,
          sd.status,
          sd.notes
        FROM staged_doses sd
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date
          AND sd.status = 'staged'
        ORDER BY sd.patient_name ASC
      `),

      // Unresolved payment issues with patient info
      query<any>(`
        SELECT
          pi.issue_id,
          pi.patient_id,
          p.full_name as patient_name,
          pi.issue_type,
          pi.issue_severity,
          pi.amount_owed,
          pi.days_overdue,
          pi.created_at
        FROM payment_issues pi
        JOIN patients p ON pi.patient_id = p.patient_id
        WHERE pi.resolved_at IS NULL
          AND p.status_key = 'Active'
        ORDER BY pi.issue_severity DESC, pi.amount_owed DESC
        LIMIT 50
      `),

      // Patients with today's staged doses (unique list for patient cards)
      query<any>(`
        SELECT DISTINCT ON (p.patient_id)
          p.patient_id,
          p.full_name,
          p.dob,
          p.status_key,
          p.regimen,
          p.phone_primary,
          p.healthie_client_id,
          sd.staged_for_date,
          sd.vendor as visit_type,
          (SELECT COUNT(*) FROM staged_doses sd2
           WHERE sd2.patient_id = p.patient_id
             AND sd2.status = 'staged'
             AND sd2.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date
          ) as staged_dose_count,
          (SELECT COUNT(*) FROM payment_issues pi
           WHERE pi.patient_id = p.patient_id
             AND pi.resolved_at IS NULL
          ) as open_alert_count
        FROM patients p
        JOIN staged_doses sd ON sd.patient_id = p.patient_id
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date
          AND sd.status = 'staged'
        ORDER BY p.patient_id, p.full_name
      `),

      // Revenue: Use Healthie billing cache (same as main dashboard) instead of just peptide_sales
      // This includes ALL revenue (peptides, consults, TRT, labs, etc.) from Healthie Billing API
      Promise.resolve().then(() => {
        try {
          const fs = require('fs');
          const cacheFile = '/tmp/healthie-revenue-cache.json';
          if (fs.existsSync(cacheFile)) {
            const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

            // Get today's date in Phoenix timezone
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

            // Find today's revenue from daily array
            let todayRevenue = 0;
            if (cache.daily && Array.isArray(cache.daily)) {
              const todayEntry = cache.daily.find((d: any) => d.day === today);
              todayRevenue = todayEntry?.amount || 0;
            }

            return [{
              today: String(todayRevenue),
              week: String(cache.day7 || 0),
              month: String(cache.day30 || 0)
            }];
          }
        } catch (e) {
          console.warn('[iPad Dashboard] Failed to read Healthie revenue cache:', e);
        }
        // Fallback to peptide_sales if cache unavailable
        return query<any>(`
          SELECT
            COALESCE(SUM(CASE WHEN sale_date >= (NOW() AT TIME ZONE 'America/Phoenix')::date
                          THEN total_price::numeric ELSE 0 END), 0)::text as today,
            COALESCE(SUM(CASE WHEN sale_date >= date_trunc('week', (NOW() AT TIME ZONE 'America/Phoenix')::date)
                          THEN total_price::numeric ELSE 0 END), 0)::text as week,
            COALESCE(SUM(CASE WHEN sale_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date)
                          THEN total_price::numeric ELSE 0 END), 0)::text as month
          FROM peptide_sales
          WHERE sale_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date)
        `).catch(() => [{ today: '0', week: '0', month: '0' }]);
      }),

      // Total active patients
      query<any>(`SELECT COUNT(*) as count FROM patients WHERE status_key = 'Active'`),

      // Patients by client type
      query<any>(`
        SELECT client_type_key, COUNT(*) as count
        FROM patients
        WHERE status_key = 'Active' AND client_type_key IS NOT NULL AND client_type_key != ''
        GROUP BY client_type_key
        ORDER BY count DESC
      `),
    ]);

    const healthieRev = revenueData[0] || {};
    const ptByType: Record<string, number> = {};
    for (const row of patientsByType) {
      ptByType[row.client_type_key] = parseInt(row.count, 10);
    }

    // Also fetch QuickBooks revenue (cash payments, insurance, etc. not in Healthie)
    let qbRev = { today: 0, week: 0, month: 0 };
    try {
      const qbData = await query<any>(`
        SELECT
          COALESCE(SUM(CASE WHEN receipt_date >= (NOW() AT TIME ZONE 'America/Phoenix')::date
                        THEN amount ELSE 0 END), 0) as today,
          COALESCE(SUM(CASE WHEN receipt_date >= date_trunc('week', (NOW() AT TIME ZONE 'America/Phoenix')::date)
                        THEN amount ELSE 0 END), 0) as week,
          COALESCE(SUM(CASE WHEN receipt_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date)
                        THEN amount ELSE 0 END), 0) as month
        FROM quickbooks_sales_receipts
        WHERE receipt_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date)
      `);
      qbRev = {
        today: parseFloat(qbData[0]?.today || '0'),
        week: parseFloat(qbData[0]?.week || '0'),
        month: parseFloat(qbData[0]?.month || '0')
      };
    } catch (e) {
      console.warn('[iPad Dashboard] QuickBooks revenue query failed (non-critical):', e);
    }

    // Combine all revenue sources (Healthie is primary, QuickBooks is supplementary)
    const combinedRevenue = {
      today: parseFloat(healthieRev.today || '0') + qbRev.today,
      week: parseFloat(healthieRev.week || '0') + qbRev.week,
      month: parseFloat(healthieRev.month || '0') + qbRev.month,
      healthie_today: parseFloat(healthieRev.today || '0'),
      healthie_week: parseFloat(healthieRev.week || '0'),
      healthie_month: parseFloat(healthieRev.month || '0'),
      quickbooks_today: qbRev.today,
      quickbooks_week: qbRev.week,
      quickbooks_month: qbRev.month
    };

    // === CEO-ONLY DATA (loaded in parallel, non-blocking) ===
    const [testosteroneInventory, accountsReceivable, patientRetention, peptideSales] = await Promise.all([
      // Testosterone inventory by vendor
      getTestosteroneInventoryByVendor().catch(e => {
        console.warn('[iPad Dashboard] T-inventory error:', e);
        return [];
      }),

      // Accounts receivable — failed/declined charges in last 30 days
      query<any>(`
        SELECT pt.patient_id, p.full_name as patient_name, pt.amount, pt.status,
               pt.description, pt.created_at, pt.stripe_charge_id,
               EXTRACT(DAY FROM NOW() - pt.created_at)::int as days_ago
        FROM payment_transactions pt
        JOIN patients p ON pt.patient_id = p.patient_id
        WHERE pt.status IN ('failed', 'error', 'declined')
          AND pt.created_at >= NOW() - INTERVAL '30 days'
        ORDER BY pt.created_at DESC
        LIMIT 20
      `).catch(() => []),

      // Patient retention — contract expiring within 30 days + not seen in 60+ days
      query<any>(`
        SELECT
          (SELECT COUNT(*) FROM patients WHERE status_key = 'Active'
           AND contract_end IS NOT NULL
           AND contract_end::date <= (NOW() AT TIME ZONE 'America/Phoenix')::date + INTERVAL '30 days'
           AND contract_end::date >= (NOW() AT TIME ZONE 'America/Phoenix')::date
          ) as expiring_contracts,
          (SELECT COUNT(*) FROM patients WHERE status_key = 'Active'
           AND (last_visit_date IS NULL OR last_visit_date < (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '60 days')
          ) as no_recent_visit
      `).catch(() => [{ expiring_contracts: 0, no_recent_visit: 0 }]),

      // Peptide sales today + pending shipments
      query<any>(`
        SELECT
          COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%'
                      AND status = 'succeeded'
                      AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_peptide_revenue,
          COALESCE((SELECT COUNT(*) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%'
                      AND status = 'succeeded'
                      AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_peptide_orders
      `).catch(() => [{ today_peptide_revenue: 0, today_peptide_orders: 0 }]),
    ]);

    // Strip time from date-only columns to prevent UTC midnight → Arizona timezone shift
    const toDateOnly = (v: any): string | null => {
      if (!v) return null;
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : s;
    };

    // Fix date fields in patient rows before sending to client
    const fixedPatients = todayPatients.map((p: any) => ({
      ...p,
      dob: toDateOnly(p.dob),
    }));

    return NextResponse.json({
      success: true,
      data: {
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }),
        patients: fixedPatients,
        staged_doses: stagedDoses,
        payment_alerts: paymentIssues,
        revenue: combinedRevenue,
        total_active_patients: parseInt(activePatientCount[0]?.count || '0', 10),
        patients_by_type: ptByType,
        summary: {
          total_patients: todayPatients.length,
          total_staged_doses: stagedDoses.length,
          total_payment_alerts: paymentIssues.length,
        },
        // CEO-only data
        ceo: {
          testosterone_inventory: testosteroneInventory,
          accounts_receivable: accountsReceivable,
          patient_retention: patientRetention[0] || { expiring_contracts: 0, no_recent_visit: 0 },
          peptide_sales: peptideSales[0] || { today_peptide_revenue: 0, today_peptide_orders: 0 },
        },
      },
    });
  } catch (error) {
    console.error('[iPad Dashboard] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

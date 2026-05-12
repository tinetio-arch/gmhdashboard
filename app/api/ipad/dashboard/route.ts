import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query, pgTimestampToUTCISO } from '@/lib/db';
import { getTestosteroneInventoryByVendor } from '@/lib/testosteroneInventory';

export const dynamic = 'force-dynamic';

type DataError = { _error: string; _query: string };

function safeQuery<T>(sql: string, params?: any[]): Promise<T[] | DataError> {
  return query<T>(sql, params).catch((e: Error) => ({
    _error: e.message,
    _query: sql.slice(0, 80).replace(/\s+/g, ' ').trim(),
  }));
}

function isError(v: any): v is DataError {
  return v && typeof v === 'object' && '_error' in v;
}

export async function GET(request: NextRequest) {
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  const dataWarnings: string[] = [];
  const now = new Date();

  try {
    const [stagedDoses, paymentIssues, todayPatients, revenueData, activePatientCount, patientsByType] = await Promise.all([
      query<any>(`
        SELECT sd.staged_dose_id, sd.patient_id, sd.patient_name, sd.dose_ml,
          sd.waste_ml, sd.syringe_count, sd.total_ml, sd.vendor,
          sd.vial_external_id, sd.staged_for_date, sd.staged_by_name, sd.status, sd.notes
        FROM staged_doses sd
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date AND sd.status = 'staged'
        ORDER BY sd.patient_name ASC
      `),

      query<any>(`
        SELECT pi.issue_id, pi.patient_id, p.full_name as patient_name,
          pi.issue_type, pi.issue_severity, pi.amount_owed, pi.days_overdue, pi.created_at
        FROM payment_issues pi
        JOIN patients p ON pi.patient_id = p.patient_id
        WHERE pi.resolved_at IS NULL AND p.status_key = 'Active'
        ORDER BY pi.issue_severity DESC, pi.amount_owed DESC LIMIT 50
      `),

      query<any>(`
        SELECT DISTINCT ON (p.patient_id) p.patient_id, p.full_name, p.dob, p.status_key,
          p.regimen, p.phone_primary, p.healthie_client_id, sd.staged_for_date,
          sd.vendor as visit_type,
          (SELECT COUNT(*) FROM staged_doses sd2 WHERE sd2.patient_id = p.patient_id
           AND sd2.status = 'staged' AND sd2.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date) as staged_dose_count,
          (SELECT COUNT(*) FROM payment_issues pi WHERE pi.patient_id = p.patient_id
           AND pi.resolved_at IS NULL) as open_alert_count
        FROM patients p JOIN staged_doses sd ON sd.patient_id = p.patient_id
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date AND sd.status = 'staged'
        ORDER BY p.patient_id, p.full_name
      `),

      // Revenue: Healthie cache + Direct Stripe
      Promise.resolve().then(async () => {
        let healthieToday = 0, healthieWeek = 0, healthieMonth = 0;
        let healthieFresh = false;
        try {
          const fs = require('fs');
          const cacheFile = '/tmp/healthie-revenue-cache.json';
          if (fs.existsSync(cacheFile)) {
            const stat = fs.statSync(cacheFile);
            const cacheAgeHours = (Date.now() - stat.mtimeMs) / 3600000;
            if (cacheAgeHours > 12) {
              dataWarnings.push(`Revenue cache is ${Math.round(cacheAgeHours)}h old — may be stale`);
            }
            const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
            if (cache.daily && Array.isArray(cache.daily)) {
              const todayEntry = cache.daily.find((d: any) => d.day === today);
              healthieToday = todayEntry?.amount || 0;
            }
            healthieWeek = cache.day7 || 0;
            healthieMonth = cache.day30 || 0;
            healthieFresh = true;
          } else {
            dataWarnings.push('Revenue cache file missing — Healthie revenue not included');
          }
        } catch (e) {
          dataWarnings.push('Revenue cache unreadable — Healthie revenue not included');
        }

        const stripeRev = await safeQuery<any>(`
          SELECT
            COALESCE(SUM(CASE WHEN created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date THEN amount ELSE 0 END), 0)::numeric(10,2) as today,
            COALESCE(SUM(CASE WHEN created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '7 days' THEN amount ELSE 0 END), 0)::numeric(10,2) as week,
            COALESCE(SUM(CASE WHEN created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days' THEN amount ELSE 0 END), 0)::numeric(10,2) as month
          FROM payment_transactions WHERE status = 'succeeded'
        `);

        if (isError(stripeRev)) {
          dataWarnings.push(`Direct Stripe revenue query failed: ${stripeRev._error}`);
          return [{ today: String(healthieToday), week: String(healthieWeek), month: String(healthieMonth), source: healthieFresh ? 'healthie_only' : 'none' }];
        }

        const s = stripeRev[0] || { today: 0, week: 0, month: 0 };
        const sToday = parseFloat(s.today), sWeek = parseFloat(s.week), sMonth = parseFloat(s.month);
        return [{
          today: String(healthieToday + sToday),
          week: String(healthieWeek + sWeek),
          month: String(healthieMonth + sMonth),
          source: healthieFresh ? 'healthie+stripe' : 'stripe_only',
          stripe_today: sToday, stripe_week: sWeek, stripe_month: sMonth,
          healthie_today: healthieToday, healthie_week: healthieWeek, healthie_month: healthieMonth,
        }];
      }),

      query<any>(`SELECT COUNT(*) as count FROM patients WHERE LOWER(status_key) = 'active'`),

      query<any>(`
        SELECT client_type_key, COUNT(*) as count FROM patients
        WHERE LOWER(status_key) = 'active' AND client_type_key IS NOT NULL AND client_type_key != ''
        GROUP BY client_type_key ORDER BY count DESC
      `),
    ]);

    const healthieRev = revenueData[0] || {};
    const ptByType: Record<string, number> = {};
    for (const row of patientsByType) {
      ptByType[row.client_type_key] = parseInt(row.count, 10);
    }

    const activeCount = parseInt(activePatientCount[0]?.count || '0', 10);

    // Sanity check: active patients should never be 0 on a real system
    if (activeCount === 0) {
      dataWarnings.push('CRITICAL: Active patient count is 0 — database query may be broken');
    }

    // Sanity check: NULL status_key patients
    const nullStatusCheck = await safeQuery<any>(
      `SELECT COUNT(*) as count FROM patients WHERE status_key IS NULL OR status_key = ''`
    );
    if (!isError(nullStatusCheck) && parseInt(nullStatusCheck[0]?.count || '0', 10) > 0) {
      dataWarnings.push(`${nullStatusCheck[0].count} patients have NULL status_key — not included in active count`);
    }

    const combinedRevenue = {
      today: parseFloat(healthieRev.today || '0'),
      week: parseFloat(healthieRev.week || '0'),
      month: parseFloat(healthieRev.month || '0'),
    };

    // === CEO-ONLY DATA ===
    const ceoResults = await Promise.allSettled([
      getTestosteroneInventoryByVendor(),

      query<any>(`
        SELECT 'payment_transactions' as source, pt.transaction_id::text as id,
               pt.patient_id, p.full_name as patient_name, pt.amount::numeric(10,2) as amount, pt.status,
               pt.description, pt.created_at, pt.stripe_charge_id,
               EXTRACT(DAY FROM NOW() - pt.created_at)::int as days_ago
        FROM payment_transactions pt JOIN patients p ON pt.patient_id = p.patient_id
        WHERE pt.status IN ('failed', 'error', 'declined') AND pt.created_at >= NOW() - INTERVAL '30 days'
        UNION ALL
        SELECT 'payment_issues' as source, pi.issue_id::text as id,
               pi.patient_id, p.full_name as patient_name, pi.amount_owed::numeric(10,2) as amount,
               pi.issue_type as status, pi.issue_type as description, pi.created_at,
               NULL as stripe_charge_id,
               EXTRACT(DAY FROM NOW() - pi.created_at)::int as days_ago
        FROM payment_issues pi JOIN patients p ON pi.patient_id = p.patient_id
        WHERE pi.resolved_at IS NULL AND p.status_key != 'inactive'
        ORDER BY amount DESC
        LIMIT 30
      `),

      query<any>(`
        SELECT
          (SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active'
           AND contract_end_date IS NOT NULL
           AND contract_end_date::date <= (NOW() AT TIME ZONE 'America/Phoenix')::date + INTERVAL '30 days'
           AND contract_end_date::date >= (NOW() AT TIME ZONE 'America/Phoenix')::date
          ) as expiring_contracts,
          (SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active'
           AND contract_end_date IS NOT NULL
           AND contract_end_date::date < (NOW() AT TIME ZONE 'America/Phoenix')::date
          ) as expired_contracts,
          (SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active'
           AND last_lab_date IS NOT NULL
           AND last_lab_date::date < (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '90 days'
          ) as no_recent_activity
      `),

      query<any>(`
        SELECT
          COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%' AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_shipped_revenue,
          COALESCE((SELECT COUNT(*) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%' AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_shipped_orders,
          COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE description ~* '(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)'
                    AND description NOT ILIKE '%ship-to-patient%'
                    AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_inhouse_revenue,
          COALESCE((SELECT COUNT(*) FROM payment_transactions
                    WHERE description ~* '(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)'
                    AND description NOT ILIKE '%ship-to-patient%'
                    AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date), 0) as today_inhouse_orders,
          COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%' AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'), 0) as month_shipped_revenue,
          COALESCE((SELECT COUNT(*) FROM payment_transactions
                    WHERE description ILIKE '%ship-to-patient%' AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'), 0) as month_shipped_orders,
          COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE description ~* '(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)'
                    AND description NOT ILIKE '%ship-to-patient%'
                    AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'), 0) as month_inhouse_revenue,
          COALESCE((SELECT COUNT(*) FROM payment_transactions
                    WHERE description ~* '(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)'
                    AND description NOT ILIKE '%ship-to-patient%'
                    AND status = 'succeeded'
                    AND created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'), 0) as month_inhouse_orders
      `),
    ]);

    // Extract results with error tracking
    const testosteroneInventory = ceoResults[0].status === 'fulfilled' ? ceoResults[0].value : (() => {
      dataWarnings.push(`Testosterone inventory error: ${(ceoResults[0] as PromiseRejectedResult).reason?.message || 'unknown'}`);
      return [];
    })();

    let accountsReceivable = ceoResults[1].status === 'fulfilled' ? ceoResults[1].value : (() => {
      dataWarnings.push(`Accounts receivable error: ${(ceoResults[1] as PromiseRejectedResult).reason?.message || 'unknown'}`);
      return [];
    })();

    // Add Healthie failed billing items from Snowflake cache (exclude dismissed)
    try {
      const fs = require('fs');
      const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
      if (cache.failed_items && Array.isArray(cache.failed_items)) {
        const dismissed = await query<any>('SELECT billing_item_id FROM dismissed_healthie_billing');
        const dismissedSet = new Set(dismissed.map((d: any) => d.billing_item_id));
        const healthieFailures = cache.failed_items
          .filter((f: any) => !dismissedSet.has(f.billing_item_id))
          .map((f: any) => ({
            source: 'healthie_billing',
            id: f.billing_item_id,
            patient_id: null,
            patient_name: f.patient_name,
            amount: f.amount,
            status: f.status,
            description: 'Healthie recurring billing',
            created_at: f.date,
            stripe_charge_id: null,
            days_ago: Math.floor((Date.now() - new Date(f.date).getTime()) / 86400000),
          }));
        accountsReceivable = [...(accountsReceivable || []), ...healthieFailures]
          .sort((a: any, b: any) => parseFloat(b.amount) - parseFloat(a.amount));
      }
    } catch {} // cache unavailable, non-critical

    const retentionRaw = ceoResults[2].status === 'fulfilled' ? ceoResults[2].value : (() => {
      dataWarnings.push(`Patient retention error: ${(ceoResults[2] as PromiseRejectedResult).reason?.message || 'unknown'}`);
      return [{ expiring_contracts: '-1', no_recent_activity: '-1' }];
    })();

    const peptideSalesRaw = ceoResults[3].status === 'fulfilled' ? ceoResults[3].value : (() => {
      dataWarnings.push(`Peptide sales error: ${(ceoResults[3] as PromiseRejectedResult).reason?.message || 'unknown'}`);
      return [{ today_peptide_revenue: 0, today_peptide_orders: 0 }];
    })();

    const retentionData = retentionRaw[0] || {};
    const expiringContracts = parseInt(retentionData.expiring_contracts ?? '0', 10);
    const noRecentVisit = parseInt(retentionData.no_recent_activity ?? '0', 10);

    // Critical lab alerts
    let criticalLabAlerts: any[] = [];
    try {
      const THRESHOLDS = [
        { pattern: /hematocrit/i, threshold: 54, op: '>' },
        { pattern: /\bpsa\b$/i, threshold: 2.5, op: '>' },
        { pattern: /^hemoglobin$/i, threshold: 18, op: '>' },
        { pattern: /^potassium$/i, threshold: 5.5, op: '>' },
        { pattern: /^creatinine$/i, threshold: 1.5, op: '>' },
      ];

      const recentLabs = await query<any>(
        `SELECT lrq.id, lrq.patient_name, lrq.raw_result, lrq.healthie_id,
                lrq.approved_by, lrq.collection_date, lrq.created_at as result_received_at, lrq.approved_at,
                p.patient_id
         FROM lab_review_queue lrq
         LEFT JOIN patients p ON p.healthie_client_id = lrq.healthie_id
         WHERE lrq.status = 'approved' AND lrq.raw_result IS NOT NULL
           AND lrq.approved_at >= NOW() - INTERVAL '7 days'
           AND lrq.id NOT IN (SELECT DISTINCT lab_queue_id FROM critical_lab_alerts WHERE lab_queue_id IS NOT NULL)
         LIMIT 50`
      );

      for (const lab of recentLabs) {
        const raw = lab.raw_result;
        if (!raw?.['Ordered Codes']) continue;
        const extract = (comps: any[]) => {
          if (!Array.isArray(comps)) return;
          for (const c of comps) {
            if (c['Test Name'] && c['Result']) {
              const val = parseFloat(c['Result']);
              if (isNaN(val)) continue;
              for (const rule of THRESHOLDS) {
                if (!rule.pattern.test(c['Test Name'])) continue;
                if (rule.op === '>' ? val > rule.threshold : val < rule.threshold) {
                  const severity = val > rule.threshold * 1.1 ? 'critical' : 'high';
                  query(`INSERT INTO critical_lab_alerts (lab_queue_id, patient_id, patient_name, test_name, test_value, test_units, reference_range, abnormal_flag, severity, ordering_provider, collection_date, result_received_at, approved_at)
                         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
                         WHERE NOT EXISTS (SELECT 1 FROM critical_lab_alerts WHERE lab_queue_id = $1 AND test_name = $4)`,
                    [lab.id, lab.patient_id, lab.patient_name, c['Test Name'], c['Result'], c['Test Units'] || '', c['Range'] || '', c['Abnormal Flag'] || '', severity, lab.approved_by || 'Unknown', lab.collection_date || null, lab.result_received_at || null, lab.approved_at || null]
                  ).catch((e) => console.warn('[Critical Labs] Insert error:', e.message));
                }
              }
            }
            if (c['Components']) extract(c['Components']);
          }
        };
        for (const code of raw['Ordered Codes']) {
          if (code['Components']) extract(code['Components']);
        }
      }

      criticalLabAlerts = await query<any>(
        `SELECT * FROM critical_lab_alerts WHERE status = 'pending'
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                  created_at DESC
         LIMIT 20`
      );
    } catch (e) {
      dataWarnings.push(`Critical labs scan error: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    const toDateOnly = (v: any): string | null => {
      if (!v) return null;
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : s;
    };

    const fixedPatients = todayPatients.map((p: any) => ({ ...p, dob: toDateOnly(p.dob) }));

    // Cron health: check when key cron jobs last ran
    let cronHealth: any = {};
    try {
      const agentLastRun = await query<any>(
        `SELECT agent_name, MAX(created_at) as last_run FROM agent_action_log
         WHERE agent_name IN ('morning_intelligence', 'system_monitor')
         GROUP BY agent_name`
      );
      for (const row of agentLastRun) {
        const ageHours = (Date.now() - new Date(row.last_run).getTime()) / 3600000;
        cronHealth[row.agent_name] = { last_run: row.last_run, age_hours: Math.round(ageHours * 10) / 10 };
        if (row.agent_name === 'morning_intelligence' && ageHours > 25) {
          dataWarnings.push('Morning intelligence agent has not run in 25+ hours');
        }
        if (row.agent_name === 'system_monitor' && ageHours > 2) {
          dataWarnings.push('System monitor has not run in 2+ hours');
        }
      }
    } catch {} // non-critical

    return NextResponse.json({
      success: true,
      data: {
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }),
        generated_at: now.toISOString(),
        patients: fixedPatients,
        staged_doses: stagedDoses,
        payment_alerts: paymentIssues,
        revenue: combinedRevenue,
        stripe_today: healthieRev.stripe_today || 0,
        stripe_month: healthieRev.stripe_month || 0,
        healthie_today: healthieRev.healthie_today || 0,
        healthie_month: healthieRev.healthie_month || 0,
        revenue_source: healthieRev.source || 'unknown',
        total_active_patients: activeCount,
        patients_by_type: ptByType,
        summary: {
          total_patients: todayPatients.length,
          total_staged_doses: stagedDoses.length,
          total_payment_alerts: paymentIssues.length,
        },
        ceo: {
          testosterone_inventory: testosteroneInventory,
          accounts_receivable: (accountsReceivable || []).map((r: any) => ({
            ...r,
            created_at: pgTimestampToUTCISO(r.created_at),
          })),
          patient_retention: {
            expiring_contracts: expiringContracts === -1 ? null : expiringContracts,
            expired_contracts: parseInt(retentionData.expired_contracts ?? '0', 10),
            no_recent_visit: noRecentVisit === -1 ? null : noRecentVisit,
          },
          peptide_sales: peptideSalesRaw[0] || {},
          critical_lab_alerts: (criticalLabAlerts || []).map((a: any) => ({
            ...a,
            created_at: pgTimestampToUTCISO(a.created_at),
            result_received_at: pgTimestampToUTCISO(a.result_received_at),
            approved_at: pgTimestampToUTCISO(a.approved_at),
          })),
          cron_health: cronHealth,
          data_warnings: dataWarnings.length > 0 ? dataWarnings : undefined,
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

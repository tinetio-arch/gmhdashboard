import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

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
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Denver')::date
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
             AND sd2.staged_for_date = (NOW() AT TIME ZONE 'America/Denver')::date
          ) as staged_dose_count,
          (SELECT COUNT(*) FROM payment_issues pi
           WHERE pi.patient_id = p.patient_id
             AND pi.resolved_at IS NULL
          ) as open_alert_count
        FROM patients p
        JOIN staged_doses sd ON sd.patient_id = p.patient_id
        WHERE sd.staged_for_date = (NOW() AT TIME ZONE 'America/Denver')::date
          AND sd.status = 'staged'
        ORDER BY p.patient_id, p.full_name
      `),

      // Revenue: today, this week, this month (gracefully handle missing table)
      query<any>(`
        SELECT
          COALESCE(SUM(CASE WHEN sale_date >= (NOW() AT TIME ZONE 'America/Denver')::date
                        THEN total_price::numeric ELSE 0 END), 0)::text as today,
          COALESCE(SUM(CASE WHEN sale_date >= date_trunc('week', (NOW() AT TIME ZONE 'America/Denver')::date)
                        THEN total_price::numeric ELSE 0 END), 0)::text as week,
          COALESCE(SUM(CASE WHEN sale_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Denver')::date)
                        THEN total_price::numeric ELSE 0 END), 0)::text as month
        FROM peptide_sales
        WHERE sale_date >= date_trunc('month', (NOW() AT TIME ZONE 'America/Denver')::date)
      `).catch(() => [{ today: '0', week: '0', month: '0' }]),

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

    const rev = revenueData[0] || {};
    const ptByType: Record<string, number> = {};
    for (const row of patientsByType) {
      ptByType[row.client_type_key] = parseInt(row.count, 10);
    }

    return NextResponse.json({
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        patients: todayPatients,
        staged_doses: stagedDoses,
        payment_alerts: paymentIssues,
        revenue: {
          today: parseFloat(rev.today || '0'),
          week: parseFloat(rev.week || '0'),
          month: parseFloat(rev.month || '0'),
        },
        total_active_patients: parseInt(activePatientCount[0]?.count || '0', 10),
        patients_by_type: ptByType,
        summary: {
          total_patients: todayPatients.length,
          total_staged_doses: stagedDoses.length,
          total_payment_alerts: paymentIssues.length,
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

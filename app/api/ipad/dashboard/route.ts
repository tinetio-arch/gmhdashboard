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
        const [stagedDoses, paymentIssues, todayPatients] = await Promise.all([
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
        ]);

        return NextResponse.json({
            success: true,
            data: {
                date: new Date().toISOString().split('T')[0],
                patients: todayPatients,
                staged_doses: stagedDoses,
                payment_alerts: paymentIssues,
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

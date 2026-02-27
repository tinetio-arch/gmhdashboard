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
        const [stagedDoses, overdueLabs, paymentHolds] = await Promise.all([
            // Staged doses pending dispensing
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
          sd.notes,
          CASE
            WHEN sd.staged_for_date < (NOW() AT TIME ZONE 'America/Denver')::date
            THEN true ELSE false
          END as is_stale
        FROM staged_doses sd
        WHERE sd.status = 'staged'
        ORDER BY sd.staged_for_date ASC, sd.created_at ASC
      `),

            // Labs pending review
            query<any>(`
        SELECT
          id,
          patient->>'healthie_id' as healthie_id,
          patient->>'name' as patient_name,
          status,
          created_at,
          EXTRACT(DAY FROM NOW() - created_at)::integer as days_pending
        FROM lab_review_queue
        WHERE status = 'pending_review'
        ORDER BY created_at ASC
      `),

            // Unresolved payment issues
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
      `),
        ]);

        return NextResponse.json({
            success: true,
            data: {
                staged_doses: stagedDoses,
                overdue_labs: overdueLabs,
                payment_holds: paymentHolds,
                summary: {
                    total_staged_doses: stagedDoses.length,
                    stale_staged_doses: stagedDoses.filter((sd: any) => sd.is_stale).length,
                    total_overdue_labs: overdueLabs.length,
                    total_payment_holds: paymentHolds.length,
                    total_outstanding: paymentHolds.reduce(
                        (sum: number, ph: any) => sum + parseFloat(ph.amount_owed || '0'), 0
                    ),
                },
            },
        });
    } catch (error) {
        console.error('[iPad Tasks] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

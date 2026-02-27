import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    const resolvedParams = params instanceof Promise ? await params : params;
    const { id: patientId } = resolvedParams;

    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        // Get patient demographics first
        const [patient] = await query<any>(
            'SELECT patient_id, full_name FROM patients WHERE patient_id = $1',
            [patientId]
        );
        if (!patient) {
            return NextResponse.json(
                { success: false, error: 'Patient not found' }, { status: 404 }
            );
        }

        // Run all financial queries in parallel
        const [
            paymentIssues,
            balanceSummary,
            trtCount,
            peptideCount,
            lastDispense,
            specialtyActive,
            specialtyPending,
        ] = await Promise.all([
            // Payment issues (unresolved)
            query<{
                issue_id: string;
                issue_type: string;
                issue_severity: string;
                amount_owed: string;
                days_overdue: number;
                qb_invoice_id: string | null;
                created_at: string;
            }>(`
        SELECT
          issue_id,
          issue_type,
          COALESCE(issue_severity, 'info') as issue_severity,
          COALESCE(amount_owed, 0) as amount_owed,
          COALESCE(days_overdue, 0) as days_overdue,
          qb_invoice_id,
          created_at
        FROM payment_issues
        WHERE patient_id = $1 AND resolved_at IS NULL
        ORDER BY days_overdue DESC, amount_owed DESC
      `, [patientId]),

            // Balance summary
            query<{
                total_outstanding: string;
                overdue_amount: string;
                days_oldest_overdue: string;
                payment_issues_count: string;
            }>(`
        SELECT
          COALESCE(SUM(amount_owed), 0)::text as total_outstanding,
          COALESCE(SUM(CASE WHEN days_overdue > 0 THEN amount_owed ELSE 0 END), 0)::text as overdue_amount,
          COALESCE(MAX(days_overdue), 0)::text as days_oldest_overdue,
          COUNT(*)::text as payment_issues_count
        FROM payment_issues
        WHERE patient_id = $1 AND resolved_at IS NULL
      `, [patientId]),

            // TRT dispense count
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count
        FROM dispenses
        WHERE patient_id = $1
      `, [patientId]),

            // Peptide dispense count
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count
        FROM peptide_dispenses pd
        JOIN patients p ON pd.patient_name ILIKE '%' || p.full_name || '%'
        WHERE p.patient_id = $1
      `, [patientId]),

            // Last dispense date (most recent across both types)
            query<{ last_date: string | null }>(`
        SELECT MAX(last_date)::text as last_date
        FROM (
          SELECT MAX(dispense_date) as last_date FROM dispenses WHERE patient_id = $1
          UNION ALL
          SELECT MAX(pd.sale_date) as last_date
          FROM peptide_dispenses pd
          JOIN patients p ON pd.patient_name ILIKE '%' || p.full_name || '%'
          WHERE p.patient_id = $1
        ) sub
      `, [patientId]),

            // Specialty orders — active (staged doses that are staged)
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count
        FROM staged_doses
        WHERE patient_id = $1 AND status = 'staged'
      `, [patientId]),

            // Specialty orders — pending (staged doses scheduled for future)
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count
        FROM staged_doses
        WHERE patient_id = $1
          AND status = 'staged'
          AND staged_for_date > (NOW() AT TIME ZONE 'America/Denver')::date
      `, [patientId]),
        ]);

        const bal = balanceSummary[0];

        return NextResponse.json({
            success: true,
            data: {
                patient_id: patient.patient_id,
                patient_name: patient.full_name,
                balance_summary: {
                    total_outstanding: parseFloat(bal?.total_outstanding || '0'),
                    overdue_amount: parseFloat(bal?.overdue_amount || '0'),
                    days_oldest_overdue: parseInt(bal?.days_oldest_overdue || '0'),
                    payment_issues_count: parseInt(bal?.payment_issues_count || '0'),
                },
                payment_issues: paymentIssues.map((pi) => ({
                    issue_id: pi.issue_id,
                    issue_type: pi.issue_type,
                    issue_severity: pi.issue_severity,
                    amount_owed: parseFloat(pi.amount_owed || '0'),
                    days_overdue: pi.days_overdue,
                    qb_invoice_id: pi.qb_invoice_id,
                    created_at: pi.created_at,
                })),
                dispense_history: {
                    trt_dispenses: parseInt(trtCount[0]?.count || '0'),
                    peptide_dispenses: parseInt(peptideCount[0]?.count || '0'),
                    last_dispense_date: lastDispense[0]?.last_date || null,
                },
                specialty_orders: {
                    active_count: parseInt(specialtyActive[0]?.count || '0'),
                    pending_count: parseInt(specialtyPending[0]?.count || '0'),
                },
            },
        });
    } catch (error) {
        console.error('[FinancialSummary] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

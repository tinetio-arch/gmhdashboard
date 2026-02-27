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
        // 1. Patient demographics
        const [patient] = await query<any>(
            'SELECT * FROM patients WHERE patient_id = $1', [patientId]
        );
        if (!patient) {
            return NextResponse.json(
                { success: false, error: 'Patient not found' }, { status: 404 }
            );
        }

        // Run remaining queries in parallel
        const [recentDispenses, recentPeptides, paymentIssues, stagedDoses] = await Promise.all([
            // Recent TRT dispenses (last 5)
            query<any>(`
        SELECT
          d.dispense_id,
          d.dispense_date,
          d.total_dispensed_ml,
          d.syringe_count,
          d.dose_per_syringe_ml,
          d.waste_ml,
          d.signature_status,
          d.prescriber,
          d.notes,
          v.external_id as vial_label,
          v.dea_drug_name
        FROM dispenses d
        JOIN vials v ON d.vial_id = v.vial_id
        WHERE d.patient_id = $1
        ORDER BY d.dispense_date DESC
        LIMIT 5
      `, [patientId]),

            // Recent peptide dispenses (last 5)
            query<any>(`
        SELECT
          pd.dispense_id,
          pd.sale_date,
          pd.quantity,
          pd.unit_price,
          pd.total_price,
          pp.name as product_name,
          pd.notes
        FROM peptide_dispenses pd
        JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.patient_name ILIKE $1
        ORDER BY pd.sale_date DESC
        LIMIT 5
      `, [`%${patient.full_name}%`]),

            // Unresolved payment issues
            query<any>(`
        SELECT
          issue_id,
          issue_type,
          issue_severity,
          amount_owed,
          days_overdue,
          created_at
        FROM payment_issues
        WHERE patient_id = $1 AND resolved_at IS NULL
        ORDER BY created_at DESC
      `, [patientId]),

            // Pending staged doses
            query<any>(`
        SELECT
          staged_dose_id,
          dose_ml,
          waste_ml,
          syringe_count,
          total_ml,
          vendor,
          vial_external_id,
          staged_for_date,
          staged_by_name,
          notes
        FROM staged_doses
        WHERE patient_id = $1 AND status = 'staged'
        ORDER BY staged_for_date ASC
      `, [patientId]),
        ]);

        return NextResponse.json({
            success: true,
            data: {
                demographics: {
                    patient_id: patient.patient_id,
                    full_name: patient.full_name,
                    dob: patient.dob,
                    phone_primary: patient.phone_primary,
                    email: patient.email,
                    status_key: patient.status_key,
                    regimen: patient.regimen,
                    client_type_key: patient.client_type_key,
                    healthie_client_id: patient.healthie_client_id,
                    last_controlled_dispense_at: patient.last_controlled_dispense_at,
                    last_dea_drug: patient.last_dea_drug,
                },
                recent_dispenses: recentDispenses,
                recent_peptides: recentPeptides,
                payment_issues: paymentIssues,
                staged_doses: stagedDoses,
                summary: {
                    has_payment_issues: paymentIssues.length > 0,
                    total_outstanding: paymentIssues.reduce(
                        (sum: number, pi: any) => sum + parseFloat(pi.amount_owed || '0'), 0
                    ),
                    pending_staged_doses: stagedDoses.length,
                },
            },
        });
    } catch (error) {
        console.error('[iPad Patient] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

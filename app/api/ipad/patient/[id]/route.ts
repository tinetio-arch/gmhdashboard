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

        // Run remaining queries in parallel — each query fault-tolerant
        const safeQuery = async (label: string, sql: string, params: any[]): Promise<any[]> => {
            try {
                return await query<any>(sql, params);
            } catch (err) {
                console.warn(`[iPad Patient] ${label} query failed:`, err instanceof Error ? err.message : err);
                return [];
            }
        };

        const [recentDispenses, recentPeptides, paymentIssues, stagedDoses] = await Promise.all([
            // Recent TRT dispenses (last 5)
            safeQuery('dispenses', `
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
        LEFT JOIN vials v ON d.vial_id = v.vial_id
        WHERE d.patient_id = $1
        ORDER BY d.dispense_date DESC
        LIMIT 5
      `, [patientId]),

            // Recent peptide dispenses (last 5)
            safeQuery('peptides', `
        SELECT
          pd.sale_date,
          pd.quantity,
          pp.name as product_name
        FROM peptide_dispenses pd
        LEFT JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.patient_name ILIKE $1
        ORDER BY pd.sale_date DESC
        LIMIT 5
      `, [`%${patient.full_name}%`]),

            // Unresolved payment issues
            safeQuery('payments', `
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
            safeQuery('staged_doses', `
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
        WHERE patient_id = $1 AND status IN ('staged', 'pending')
        ORDER BY staged_for_date ASC
      `, [patientId]),
        ]);

        // Fetch Healthie avatar if we have a healthie_client_id
        let healthieAvatarUrl: string | null = null;
        if (patient.healthie_client_id) {
            try {
                const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
                const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `query GetAvatar($id: ID) { user(id: $id) { avatar_url } }`,
                        variables: { id: patient.healthie_client_id },
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (resp.ok) {
                    const result = await resp.json();
                    healthieAvatarUrl = result?.data?.user?.avatar_url || null;
                }
            } catch (e) {
                // Avatar fetch is non-critical — swallow errors
            }
        }

        // Helper: PostgreSQL date columns serialize as "2026-03-28T00:00:00.000Z" via pg driver.
        // The iPhone interprets UTC midnight in Arizona (UTC-7) as the PREVIOUS day.
        // Fix: strip time component — send "2026-03-28" only.
        const toDateOnly = (v: any): string | null => {
            if (!v) return null;
            const s = String(v);
            // Already date-only
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            // ISO timestamp — extract date part
            const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
            return match ? match[1] : s;
        };

        return NextResponse.json({
            success: true,
            data: {
                demographics: {
                    patient_id: patient.patient_id,
                    full_name: patient.full_name,
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    dob: toDateOnly(patient.dob),
                    gender: patient.gender,
                    phone_primary: patient.phone_primary,
                    email: patient.email,
                    address_line_1: patient.address_line_1,
                    city: patient.city,
                    state: patient.state,
                    zip: patient.zip,
                    status_key: patient.status_key,
                    regimen: patient.regimen,
                    client_type_key: patient.client_type_key,
                    healthie_client_id: patient.healthie_client_id,
                    ghl_contact_id: patient.ghl_contact_id,
                    provider_name: patient.provider_name,
                    location_name: patient.location_name,
                    last_controlled_dispense_at: patient.last_controlled_dispense_at,
                    last_dea_drug: patient.last_dea_drug,
                    last_lab: toDateOnly(patient.last_lab),
                    next_lab: toDateOnly(patient.next_lab),
                    lab_status: patient.lab_status,
                    healthie_avatar_url: healthieAvatarUrl,
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

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { createHealthieClient } from '@/lib/healthie';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

interface Patient360 {
    demographics: any;
    medications: { peptides: any[]; trt: any[] };
    labs: { queue_items: any[]; healthie_labs: any[] };
    payments: { issues: any[]; total_outstanding: number };
    visits: any[];
    alerts: any[];
    controlled_substances: any[];
}

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
        // 1. Demographics
        const [patient] = await query<any>(
            'SELECT * FROM patients WHERE patient_id = $1', [patientId]
        );
        if (!patient) {
            return NextResponse.json(
                { success: false, error: 'Patient not found' }, { status: 404 }
            );
        }

        // Run all data source queries in parallel
        const [
            peptides,
            trt,
            labQueue,
            payments,
            paymentTotal,
            stagedDoses,
            deaTransactions,
        ] = await Promise.all([
            // 2. Current medications — peptides
            query<any>(`
        SELECT pd.*, pp.name as product_name
        FROM peptide_dispenses pd
        JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.patient_name ILIKE $1
        ORDER BY pd.sale_date DESC LIMIT 20
      `, [`%${patient.full_name}%`]),

            // 3. Current medications — TRT
            query<any>(`
        SELECT d.*, v.dea_drug_name, v.external_id as vial_label
        FROM dispenses d
        JOIN vials v ON d.vial_id = v.vial_id
        WHERE d.patient_id = $1
        ORDER BY d.dispense_date DESC LIMIT 20
      `, [patientId]),

            // 4. Lab status from lab_review_queue
            query<any>(`
        SELECT * FROM lab_review_queue
        WHERE patient->>'healthie_id' = $1
        ORDER BY created_at DESC LIMIT 10
      `, [patient.healthie_client_id || '']),

            // 5. Payment issues (unresolved)
            query<any>(`
        SELECT * FROM payment_issues
        WHERE patient_id = $1 AND resolved_at IS NULL
        ORDER BY created_at DESC
      `, [patientId]),

            // 5b. Payment total outstanding
            query<any>(`
        SELECT COALESCE(SUM(amount_owed), 0) as total_outstanding
        FROM payment_issues
        WHERE patient_id = $1 AND resolved_at IS NULL
      `, [patientId]),

            // 9a. Staged doses pending
            query<any>(`
        SELECT sd.*, v.dea_drug_name, v.external_id as vial_label
        FROM staged_doses sd
        LEFT JOIN vials v ON sd.vial_id = v.vial_id
        WHERE sd.patient_id = $1
          AND sd.status = 'pending'
        ORDER BY sd.staged_for_date ASC
      `, [patientId]),

            // 10. Controlled substance history
            query<any>(`
        SELECT * FROM dea_transactions
        WHERE patient_id = $1
        ORDER BY dispense_date DESC LIMIT 20
      `, [patientId]),
        ]);

        // Healthie data (visits + labs) — graceful fallback on failure
        let healthieVisits: any[] = [];
        let healthieLabs: any[] = [];

        const healthieId = patient.healthie_client_id;
        if (healthieId) {
            try {
                // Fetch appointments from Healthie GraphQL
                const appointmentData = await healthieGraphQL<{
                    appointments: Array<{
                        id: string;
                        date: string;
                        appointment_type?: { name?: string } | null;
                        provider?: { full_name?: string } | null;
                        status?: string | null;
                        location?: string | null;
                        notes?: string | null;
                    }>;
                }>(`
          query GetPatientAppointments($clientId: ID, $offset: Int) {
            appointments(
              client_id: $clientId,
              offset: $offset,
              should_paginate: true,
              filter: "all"
            ) {
              id
              date
              appointment_type {
                name
              }
              provider {
                full_name
              }
              status
              location
              notes
            }
          }
        `, { clientId: healthieId, offset: 0 });

                healthieVisits = appointmentData.appointments || [];
            } catch (visitErr) {
                console.error(`[Patient360] Healthie visits failed for ${healthieId}:`, visitErr instanceof Error ? visitErr.message : visitErr);
                // Gracefully continue with empty visits
            }

            // Optional: fetch lab orders from Healthie if needed
            try {
                const labData = await healthieGraphQL<{
                    labOrders: Array<{
                        id: string;
                        patient_id: string;
                        date_received: string;
                        lab_company?: string | null;
                        status?: string | null;
                    }>;
                }>(`
          query GetPatientLabOrders($clientId: ID) {
            labOrders(patient_id: $clientId) {
              id
              patient_id
              date_received
              lab_company
              status
            }
          }
        `, { clientId: healthieId });

                healthieLabs = labData.labOrders || [];
            } catch (labErr) {
                console.error(`[Patient360] Healthie labs failed for ${healthieId}:`, labErr instanceof Error ? labErr.message : labErr);
                // Gracefully continue with empty labs
            }
        }

        // Build alerts from aggregated sources
        const alerts: any[] = [];

        // Alert: Staged doses pending
        if (stagedDoses.length > 0) {
            alerts.push({
                type: 'staged_doses_pending',
                severity: 'info',
                message: `${stagedDoses.length} staged dose(s) pending`,
                count: stagedDoses.length,
                details: stagedDoses,
            });
        }

        // Alert: Overdue labs (pending_review older than 14 days)
        const overdueLabItems = labQueue.filter((item: any) => {
            if (item.status !== 'pending_review') return false;
            const created = new Date(item.created_at);
            const daysSince = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
            return daysSince > 14;
        });
        if (overdueLabItems.length > 0) {
            alerts.push({
                type: 'overdue_labs',
                severity: 'warning',
                message: `${overdueLabItems.length} lab result(s) pending review for 14+ days`,
                count: overdueLabItems.length,
                details: overdueLabItems,
            });
        }

        // Alert: Payment holds
        if (payments.length > 0) {
            const totalOwed = parseFloat(paymentTotal[0]?.total_outstanding || '0');
            alerts.push({
                type: 'payment_hold',
                severity: totalOwed > 500 ? 'critical' : 'warning',
                message: `${payments.length} unresolved payment issue(s) — $${totalOwed.toFixed(2)} outstanding`,
                count: payments.length,
                total_outstanding: totalOwed,
            });
        }

        // Alert: Stale staged doses (past their staged_for_date)
        const now = new Date();
        const staleDoses = stagedDoses.filter((sd: any) => {
            if (!sd.staged_for_date) return false;
            return new Date(sd.staged_for_date) < now;
        });
        if (staleDoses.length > 0) {
            alerts.push({
                type: 'stale_staged_doses',
                severity: 'warning',
                message: `${staleDoses.length} staged dose(s) past their scheduled date`,
                count: staleDoses.length,
                details: staleDoses,
            });
        }

        const totalOutstanding = parseFloat(paymentTotal[0]?.total_outstanding || '0');

        const result: Patient360 = {
            demographics: patient,
            medications: {
                peptides,
                trt,
            },
            labs: {
                queue_items: labQueue,
                healthie_labs: healthieLabs,
            },
            payments: {
                issues: payments,
                total_outstanding: totalOutstanding,
            },
            visits: healthieVisits,
            alerts,
            controlled_substances: deaTransactions,
        };

        return NextResponse.json({ success: true, data: result });

    } catch (error) {
        console.error('[Patient360] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

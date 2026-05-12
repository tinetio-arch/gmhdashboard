import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

interface PatientCandidate {
    patient_id: string;
    full_name: string;
    healthie_client_id: string;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GET /api/cron/missing-recurring-payments
 *
 * Scans all active Healthie-billed member patients. For each, checks whether
 * they still have a recurringPayment in Healthie. If they have a package but
 * no recurring payment, inserts a payment_issues row so it surfaces on the
 * CEO dashboard Accounts Receivable section.
 *
 * Also auto-resolves any previously-flagged patients who now have a recurring
 * payment again (card was re-added).
 */
export async function GET(request: NextRequest): Promise<Response> {
    if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    console.log('[missing-recurring] Starting scan...');

    // 1. Get all active Healthie-billed member patients
    const candidates = await query<PatientCandidate>(`
        SELECT p.patient_id, p.full_name, p.healthie_client_id
        FROM patients p
        WHERE p.status_key IN ('active', 'active_pending')
          AND p.patient_type = 'member'
          AND p.healthie_client_id IS NOT NULL
          AND p.payment_method_key = 'healthie'
        ORDER BY p.full_name
    `);

    console.log(`[missing-recurring] Found ${candidates.length} active Healthie-billed members to check`);

    let flagged = 0;
    let resolved = 0;
    let checked = 0;
    let errors = 0;
    const flaggedPatients: string[] = [];

    // 2. Process in batches to avoid Healthie rate limits
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
            batch.map(async (patient) => {
                try {
                    const data = await healthieGraphQL<{
                        recurringPayments: Array<{ id: string }>;
                        userPackageSelections: Array<{ id: string; offering: { name: string } | null }>;
                    }>(`
                        query CheckBilling($userId: ID) {
                            recurringPayments(user_id: $userId) { id }
                            userPackageSelections(user_id: $userId) { id offering { name } }
                        }
                    `, { userId: patient.healthie_client_id });

                    const hasPackage = (data.userPackageSelections?.length ?? 0) > 0;
                    const hasRecurring = (data.recurringPayments?.length ?? 0) > 0;
                    const packageName = data.userPackageSelections?.[0]?.offering?.name || 'Unknown Package';

                    if (hasPackage && !hasRecurring) {
                        // Flag: has package but no recurring payment
                        await query(`
                            INSERT INTO payment_issues (
                                patient_id, issue_type, issue_severity, amount_owed,
                                days_overdue, previous_status_key, status_changed_to
                            ) VALUES (
                                $1, 'membership_delinquent', 'critical', 0,
                                0, $2, $3
                            )
                            ON CONFLICT (patient_id, issue_type, COALESCE(qb_invoice_id, ''), COALESCE(qb_sales_receipt_id, ''))
                            WHERE resolved_at IS NULL
                            DO UPDATE SET updated_at = NOW(), days_overdue = EXTRACT(DAY FROM NOW() - payment_issues.created_at)::int
                        `, [
                            patient.patient_id,
                            `Package: ${packageName}`,
                            `Missing recurring payment — patient has package but no active billing`
                        ]);

                        flagged++;
                        flaggedPatients.push(patient.full_name);
                        console.log(`[missing-recurring] ⚠️ FLAGGED: ${patient.full_name} (${patient.healthie_client_id}) — has package "${packageName}" but no recurring payment`);
                    } else if (hasRecurring) {
                        // Auto-resolve if previously flagged but now has recurring payment
                        const resolveResult = await query(`
                            UPDATE payment_issues
                            SET resolved_at = NOW(), resolution_notes = 'Auto-resolved: recurring payment detected'
                            WHERE patient_id = $1
                              AND issue_type = 'membership_delinquent'
                              AND resolved_at IS NULL
                            RETURNING issue_id
                        `, [patient.patient_id]);

                        if (resolveResult.length > 0) {
                            resolved++;
                            console.log(`[missing-recurring] ✅ Auto-resolved: ${patient.full_name} — recurring payment restored`);
                        }
                    }

                    checked++;
                } catch (err) {
                    errors++;
                    console.error(`[missing-recurring] Error checking ${patient.full_name}:`, err instanceof Error ? err.message : err);
                }
            })
        );

        // Delay between batches to avoid rate limits
        if (i + BATCH_SIZE < candidates.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    const elapsedMs = Date.now() - startedAt;
    const summary = {
        checked,
        flagged,
        resolved,
        errors,
        total_candidates: candidates.length,
        flagged_patients: flaggedPatients,
        elapsed_ms: elapsedMs,
    };

    console.log(`[missing-recurring] Done in ${elapsedMs}ms:`, summary);

    return NextResponse.json({ success: true, ...summary });
}

export const POST = GET;

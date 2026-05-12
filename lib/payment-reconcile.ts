import { query } from '@/lib/db';

/**
 * Auto-clear stale "Unpaid" alerts when a successful payment lands.
 *
 * Why this exists:
 *   The iPad CEO "Unpaid" panel UNIONs (a) failed payment_transactions and
 *   (b) unresolved payment_issues. When a patient retries and succeeds, neither
 *   row clears automatically — staff have to dismiss them by hand. This module
 *   resolves both for a given patient when we know a charge just succeeded.
 *
 * Called from:
 *   - /api/ipad/billing/charge (right after a successful direct/Healthie charge)
 *   - /api/headless/checkout   (after Mobile App Stripe charge)
 *   - /api/cron/payment-reconcile (safety-net sweep every 30 min for charges
 *      that landed elsewhere — Stripe webhooks, Healthie recurring, manual)
 */
export async function reconcilePatientPayments(patientId: string, opts?: {
    actorEmail?: string;
    note?: string;
    lookbackDays?: number;
}): Promise<{ resolvedTransactions: number; resolvedIssues: number }> {
    const lookback = opts?.lookbackDays ?? 90;
    const note = opts?.note || 'Auto-resolved — subsequent payment succeeded';
    const tag = `[${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })} ${opts?.actorEmail || 'system'}] auto: ${note}`;

    // 1. Resolve failed/declined payment_transactions for this patient where a
    //    later succeeded transaction exists. We mark them as 'resolved' (the
    //    same status used by the manual /api/ipad/ceo/resolve-charge route).
    const txnResult = await query<{ transaction_id: string }>(`
        UPDATE payment_transactions pt
        SET status = 'resolved',
            error_message = COALESCE(error_message, '') || E'\n' || $3,
            updated_at = NOW()
        WHERE pt.patient_id = $1::uuid
          AND pt.status IN ('failed', 'error', 'declined')
          AND pt.created_at >= NOW() - ($2 || ' days')::interval
          AND EXISTS (
            SELECT 1 FROM payment_transactions later
            WHERE later.patient_id = pt.patient_id
              AND later.status = 'succeeded'
              AND later.created_at > pt.created_at
          )
        RETURNING transaction_id
    `, [patientId, String(lookback), tag]);

    // 2. Resolve any open payment_issues for this patient. The check-payment-failures
    //    route already does an active-patient sweep, but it only runs on demand;
    //    do it eagerly here so the iPad clears the moment a payment lands.
    const issueResult = await query<{ issue_id: string }>(`
        UPDATE payment_issues
        SET resolved_at = NOW(),
            resolution_notes = COALESCE(resolution_notes, '') || E'\n' || $2,
            auto_updated = TRUE
        WHERE patient_id = $1::uuid
          AND resolved_at IS NULL
        RETURNING issue_id
    `, [patientId, tag]);

    return {
        resolvedTransactions: txnResult.length,
        resolvedIssues: issueResult.length,
    };
}

/**
 * System-wide sweep — for the cron job. Resolves any failed payment_transactions
 * where a succeeded charge for the same patient exists later in the lookback window,
 * and any open payment_issues for patients who are now active or have a recent
 * successful charge.
 */
export async function sweepReconcile(lookbackDays = 90): Promise<{
    resolvedTransactions: number;
    resolvedIssues: number;
}> {
    const txnResult = await query<{ transaction_id: string }>(`
        UPDATE payment_transactions pt
        SET status = 'resolved',
            error_message = COALESCE(error_message, '') || E'\n[' || to_char(NOW(),'YYYY-MM-DD') || ' system] auto: subsequent payment succeeded',
            updated_at = NOW()
        WHERE pt.status IN ('failed', 'error', 'declined')
          AND pt.created_at >= NOW() - ($1 || ' days')::interval
          AND EXISTS (
            SELECT 1 FROM payment_transactions later
            WHERE later.patient_id = pt.patient_id
              AND later.status = 'succeeded'
              AND later.created_at > pt.created_at
          )
        RETURNING transaction_id
    `, [String(lookbackDays)]);

    const issueResult = await query<{ issue_id: string }>(`
        UPDATE payment_issues pi
        SET resolved_at = NOW(),
            resolution_notes = COALESCE(resolution_notes, 'Auto-resolved — patient active or recent successful payment'),
            auto_updated = TRUE
        WHERE pi.resolved_at IS NULL
          AND (
            EXISTS (
                SELECT 1 FROM patients p
                WHERE p.patient_id = pi.patient_id
                  AND LOWER(p.status_key) = 'active'
            )
            OR EXISTS (
                SELECT 1 FROM payment_transactions pt
                WHERE pt.patient_id = pi.patient_id
                  AND pt.status = 'succeeded'
                  AND pt.created_at > pi.created_at
                  AND pt.created_at >= NOW() - INTERVAL '30 days'
            )
          )
        RETURNING issue_id
    `);

    return {
        resolvedTransactions: txnResult.length,
        resolvedIssues: issueResult.length,
    };
}

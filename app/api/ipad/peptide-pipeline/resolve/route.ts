import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { refundPaymentTransaction } from '@/lib/abxtac-refund';

export const dynamic = 'force-dynamic';

type Action = 'handled_internally' | 'mark_picked_up' | 'reship' | 'refund';

/**
 * POST /api/ipad/peptide-pipeline/resolve
 * Body: { tracking_id, action, notes? }
 *
 * Permissions:
 *   - read role: handled_internally, mark_picked_up, reship
 *   - admin role: ALL actions including refund
 *
 * Refund pathway re-uses lib/abxtac-refund.ts (Stripe refund + WC order cancel
 * + peptide_dispenses reversal + Healthie receipt). Idempotent.
 */
export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const body = await request.json().catch(() => ({} as any));
    const trackingId: string | undefined = body.tracking_id;
    const action: Action | undefined = body.action;
    const notes: string = (body.notes || '').toString().slice(0, 1000);

    if (!trackingId || !action) {
        return NextResponse.json({ error: 'tracking_id and action required' }, { status: 400 });
    }
    if (!['handled_internally', 'mark_picked_up', 'reship', 'refund'].includes(action)) {
        return NextResponse.json({ error: 'invalid action' }, { status: 400 });
    }
    if (action === 'refund' && user.role !== 'admin') {
        return NextResponse.json({ error: 'Only admin can issue refunds' }, { status: 403 });
    }

    const [tracking] = await query<any>(`
        SELECT t.*, pt.stripe_charge_id, pt.amount, pt.description, pt.patient_id AS pt_patient_id
        FROM peptide_order_tracking t
        JOIN payment_transactions pt ON pt.transaction_id = t.payment_id
        WHERE t.tracking_id = $1
    `, [trackingId]);

    if (!tracking) {
        return NextResponse.json({ error: 'tracking row not found' }, { status: 404 });
    }

    const actor = user.email || user.user_id || 'staff';

    if (action === 'handled_internally') {
        await query(`
            UPDATE peptide_order_tracking
            SET resolution='handled_internally', resolution_notes=$1, resolved_by=$2, resolved_at=NOW()
            WHERE tracking_id=$3
        `, [notes || null, actor, trackingId]);
        return NextResponse.json({ success: true, action, resolved_by: actor });
    }

    if (action === 'mark_picked_up') {
        if (tracking.channel !== 'inhouse') {
            return NextResponse.json({ error: 'mark_picked_up only valid for in-house orders' }, { status: 400 });
        }
        const dispenseIds: string[] = Array.isArray(tracking.dispense_ids) ? tracking.dispense_ids : [];
        if (dispenseIds.length === 0) {
            return NextResponse.json({ error: 'no peptide_dispenses linked to this charge' }, { status: 400 });
        }
        const today = new Date().toISOString().slice(0, 10);
        await query(`
            UPDATE peptide_dispenses
            SET received_date = COALESCE(received_date, $1::date)
            WHERE sale_id = ANY($2::uuid[])
        `, [today, dispenseIds]);
        await query(`
            UPDATE peptide_order_tracking
            SET stage='picked_up',
                received_date = COALESCE(received_date, $1::date),
                resolution='picked_up_marked',
                resolution_notes=$2, resolved_by=$3, resolved_at=NOW()
            WHERE tracking_id=$4
        `, [today, notes || null, actor, trackingId]);
        return NextResponse.json({ success: true, action, dispenses_updated: dispenseIds.length });
    }

    if (action === 'reship') {
        // Lightweight reship: caller must use the existing iPad ship-to-patient
        // workflow to actually create a new WC order. Here we just record the
        // intent and an optional WC order id supplied by the caller (set after
        // they create the new order in the existing workflow).
        const reshipOrderId: number | null = body.reship_wc_order_id ? Number(body.reship_wc_order_id) : null;
        await query(`
            UPDATE peptide_order_tracking
            SET resolution='reshipped',
                reship_wc_order_id = COALESCE($1, reship_wc_order_id),
                resolution_notes=$2, resolved_by=$3, resolved_at=NOW()
            WHERE tracking_id=$4
        `, [reshipOrderId, notes || null, actor, trackingId]);
        return NextResponse.json({
            success: true,
            action,
            reship_wc_order_id: reshipOrderId,
            next_step: reshipOrderId
                ? 'recorded'
                : 'open the iPad ship-to-patient workflow to create the replacement order, then re-call with reship_wc_order_id',
        });
    }

    // refund — admin only (gated above)
    const result = await refundPaymentTransaction({
        transactionId: tracking.payment_id,
        reason: notes || 'Peptide pipeline refund',
        actor,
    });

    if (!result.success) {
        return NextResponse.json({ error: result.error || 'refund failed' }, { status: 500 });
    }

    await query(`
        UPDATE peptide_order_tracking
        SET stage='refunded',
            resolution='refunded',
            resolution_notes=$1, resolved_by=$2, resolved_at=NOW()
        WHERE tracking_id=$3
    `, [notes || null, actor, trackingId]);

    return NextResponse.json({
        success: true,
        action,
        already_refunded: !!result.alreadyRefunded,
        refund_amount: result.refundAmount,
        wc_cancelled: !!result.wcOrderCancelled,
        wc_order_id: result.wcOrderId,
        dispenses_reversed: result.dispensesReversed,
    });
}

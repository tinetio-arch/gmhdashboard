import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ipad/peptide-pipeline
 *
 * Staff-visible peptide pipeline view (read role). Same data as the CEO route,
 * but every row carries a `can_refund` flag (true only for admins) so the
 * iPad UI can hide the refund button for non-admin staff.
 *
 * Resolved rows (resolution IS NOT NULL) are returned in a separate `recently_resolved`
 * bucket so they don't pollute the active queues.
 */
export async function GET(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }
    const isAdmin = user.role === 'admin';
    const days = Math.max(1, Math.min(90, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)));

    const [freshness] = await query<any>(`
        SELECT MAX(last_synced_at) AS last_synced FROM peptide_order_tracking
    `);

    const rows = await query<any>(`
        SELECT t.tracking_id, t.payment_id, t.patient_id, p.full_name AS patient_name,
               p.phone_primary AS phone, p.email,
               t.channel, t.stage,
               t.wc_order_id, t.wc_order_number, t.wc_status,
               t.tracking_number, t.tracking_carrier, t.tracking_url,
               t.shipped_at, t.delivered_at,
               t.dispense_ids, t.education_complete, t.received_date,
               t.stuck_reason, t.age_hours, t.last_synced_at,
               t.resolution, t.resolution_notes, t.resolved_by, t.resolved_at, t.reship_wc_order_id,
               pt.amount::numeric(10,2) AS amount,
               pt.description, pt.stripe_charge_id, pt.created_at
        FROM peptide_order_tracking t
        JOIN payment_transactions pt ON pt.transaction_id = t.payment_id
        LEFT JOIN patients p ON p.patient_id = t.patient_id
        WHERE pt.created_at >= NOW() - ($1 || ' days')::interval
        ORDER BY pt.created_at DESC
    `, [String(days)]);

    const annotated = rows.map(r => ({ ...r, can_refund: isAdmin }));
    const active = annotated.filter(r => !r.resolution);
    const resolved = annotated.filter(r => r.resolution);

    function bucket(arr: any[]) {
        const stuck = arr.filter(r => r.stage === 'stuck');
        const completed = arr.filter(r => r.stage === 'wc_shipped' || r.stage === 'wc_delivered' || r.stage === 'picked_up');
        const refunded = arr.filter(r => r.stage === 'refunded');
        // Split in_progress so staff can see what's actually blocking each row.
        const ready_for_pickup = arr.filter(r => r.stage === 'dispensed');
        const awaiting_education = arr.filter(r => r.stage === 'inhouse_pending');
        const wc_pending = arr.filter(r => r.stage === 'wc_pending');
        return {
            stuck, ready_for_pickup, awaiting_education, wc_pending, completed, refunded,
            summary: {
                total: arr.length,
                stuck: stuck.length,
                ready_for_pickup: ready_for_pickup.length,
                awaiting_education: awaiting_education.length,
                wc_pending: wc_pending.length,
                completed: completed.length,
                refunded: refunded.length,
            },
        };
    }

    const wooActive = active.filter(r => r.channel === 'woo');
    const inhouseActive = active.filter(r => r.channel === 'inhouse');

    // Recent in-house dispenses straight from peptide_dispenses — independent of
    // peptide_order_tracking so it includes every dispense, even ones that were
    // created outside the Stripe flow or before tracking existed.
    const recentDispenses = await query<any>(`
        SELECT d.sale_id, d.patient_name, d.product_id, p.name AS product_name,
               d.quantity, d.amount_charged, d.sale_date, d.order_date, d.received_date,
               d.notes, d.status, d.paid, d.created_at
        FROM peptide_dispenses d
        LEFT JOIN peptide_products p ON p.product_id = d.product_id
        ORDER BY d.created_at DESC
        LIMIT 25
    `);

    return NextResponse.json({
        success: true,
        days,
        is_admin: isAdmin,
        last_synced: freshness?.last_synced || null,
        woo: bucket(wooActive),
        inhouse: bucket(inhouseActive),
        recently_resolved: resolved.slice(0, 25),
        recent_inhouse_dispenses: recentDispenses,
    });
}

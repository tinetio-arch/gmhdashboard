import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ipad/ceo/peptide-pipeline
 *
 * Returns separate tracking summaries for the two peptide fulfillment channels:
 *   - woo:     ABXTac dropship orders (Mobile checkout + iPad ship-order)
 *   - inhouse: clinic dispense (iPad direct charge → peptide_dispenses)
 *
 * Each channel returns { stuck, in_progress, completed } with row detail and
 * a `summary` count map. Reads peptide_order_tracking — no live WC calls here;
 * data is refreshed by /api/cron/peptide-pipeline-sync every 15 minutes.
 */
export async function GET(request: NextRequest) {
    try { var user = await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }
    if (user.role !== 'admin') {
        return NextResponse.json({ error: 'CEO access only' }, { status: 403 });
    }

    const days = Math.max(1, Math.min(90, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)));

    // Cache freshness — surface to UI so we can show "synced 4 min ago".
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
               pt.amount::numeric(10,2) AS amount,
               pt.description, pt.stripe_charge_id, pt.created_at
        FROM peptide_order_tracking t
        JOIN payment_transactions pt ON pt.transaction_id = t.payment_id
        LEFT JOIN patients p ON p.patient_id = t.patient_id
        WHERE pt.created_at >= NOW() - ($1 || ' days')::interval
        ORDER BY pt.created_at DESC
    `, [String(days)]);

    const woo: any[] = [];
    const inhouse: any[] = [];
    for (const r of rows) (r.channel === 'woo' ? woo : inhouse).push(r);

    function bucket(arr: any[]) {
        const stuck = arr.filter(r => r.stage === 'stuck');
        const completed = arr.filter(r => r.stage === 'wc_shipped' || r.stage === 'wc_delivered' || r.stage === 'picked_up');
        const refunded = arr.filter(r => r.stage === 'refunded');
        const in_progress = arr.filter(r =>
            !stuck.includes(r) && !completed.includes(r) && !refunded.includes(r));
        return {
            stuck, in_progress, completed, refunded,
            summary: {
                total: arr.length,
                stuck: stuck.length,
                in_progress: in_progress.length,
                completed: completed.length,
                refunded: refunded.length,
            },
        };
    }

    return NextResponse.json({
        success: true,
        days,
        last_synced: freshness?.last_synced || null,
        woo: bucket(woo),
        inhouse: bucket(inhouse),
    });
}

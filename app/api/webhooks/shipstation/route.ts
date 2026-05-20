import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/shipstation
 *
 * Real carrier-delivery signal for the `woo` peptide channel (ABXTAC dropship →
 * ShipStation → USPS). This is the missing piece behind PHIL-TODO-MASTER #10:
 * before this existed, NOTHING set a real `delivered_at`. The May 19 cleanup
 * NULLed 25 fabricated `delivered_at` rows (root cause behind the Ryan Foster
 * ghost order) and the pipeline cron was hard-coded to leave `delivered_at`
 * NULL "until a real delivery source exists" (see
 * app/api/cron/peptide-pipeline-sync/route.ts ~line 238). THIS is that source.
 *
 * Flow:
 *   1. Verify HMAC signature over the raw body (SHIPSTATION_WEBHOOK_SECRET).
 *   2. Parse the event; only act on a delivery event (event === 'delivered').
 *   3. Dedup by tracking_number — only flip rows where delivered_at IS NULL.
 *   4. UPDATE peptide_order_tracking SET delivered_at, stage='wc_delivered'.
 *
 * ── IMPORTANT TABLE NOTE ─────────────────────────────────────────────────────
 * The ship-sync brief said "UPDATE peptide_dispenses SET delivered_at". That is
 * WRONG: `peptide_dispenses` has no `delivered_at`/`tracking_number` columns.
 * Those columns live on `peptide_order_tracking` (migration
 * 20260428_peptide_order_tracking.sql). `woo` orders never produce a
 * `peptide_dispenses` row (those are in-house pickups only — see SOT module 30).
 * So delivery state belongs on `peptide_order_tracking`, which is what this
 * handler writes. Confirmed with Phil before deploy — see morning report.
 *
 * ── CRON-STOMP HAZARD (must fix before this works) ───────────────────────────
 * `peptide-pipeline-sync` runs an UPSERT every 15 min with
 * `delivered_at = EXCLUDED.delivered_at`, and EXCLUDED.delivered_at is always
 * NULL today. That means any delivered_at this webhook writes is erased on the
 * next cron tick. The companion one-line fix (COALESCE guard) is staged in that
 * route on this same branch. Without it this webhook is a no-op within 15 min.
 *
 * ── SHIPSTATION REALITY (read before configuring) ────────────────────────────
 * ShipStation's *native* v1 webhooks POST only a `resource_url` (you then GET
 * the resource with API-key Basic auth) and do NOT HMAC-sign the payload. To
 * satisfy the brief's HMAC requirement you have two options:
 *   (a) Front ShipStation with a tiny signing relay (Cloudflare Worker / Lambda)
 *       that GETs the resource_url, normalizes to {event, tracking_number,
 *       delivered_at}, and re-POSTs here with an HMAC header. (Recommended.)
 *   (b) Point a carrier/aggregator that DOES sign (EasyPost, AfterShip,
 *       Shippo) at this endpoint instead.
 * Either way this handler verifies HMAC and reads a normalized body. It also
 * defensively handles ShipStation's native SHIP_NOTIFY resource_url shape so a
 * direct hookup degrades gracefully (logged + skipped, never a fabricated
 * delivery).
 *
 * Env vars required:
 *   - SHIPSTATION_WEBHOOK_SECRET : HMAC secret (shared with the signing relay)
 *   - SHIPSTATION_API_KEY        : only needed if you resolve resource_url here
 *
 * Header (configurable): x-shipstation-hmac-sha256 — base64 HMAC-SHA256 of the
 * raw request body using SHIPSTATION_WEBHOOK_SECRET.
 */

const SIGNATURE_HEADER = 'x-shipstation-hmac-sha256';

interface NormalizedDeliveryEvent {
    event: string;                 // 'delivered' | 'shipped' | ...
    tracking_number?: string;
    trackingNumber?: string;
    delivered_at?: string;         // ISO timestamp of the delivery scan
    deliveredAt?: string;
    carrier?: string;
}

function timingSafeEqualStr(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

export async function POST(req: NextRequest) {
    // 1. Verify HMAC signature over the raw body.
    const rawBody = await req.text();
    const signature = req.headers.get(SIGNATURE_HEADER) || '';
    const secret = process.env.SHIPSTATION_WEBHOOK_SECRET;

    if (!secret) {
        console.error('[ShipStation] SHIPSTATION_WEBHOOK_SECRET not configured');
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

    if (!signature || !timingSafeEqualStr(expectedSig, signature)) {
        console.warn('[ShipStation] Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 2. Parse the event.
    let payload: NormalizedDeliveryEvent & { resource_type?: string; resource_url?: string };
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Defensive: native ShipStation SHIP_NOTIFY shape (resource_url, no event).
    // We can't fabricate a delivery from a ship-notify, so log + skip cleanly.
    if (!payload.event && (payload.resource_type || payload.resource_url)) {
        console.warn(
            `[ShipStation] Received native resource webhook (resource_type=${payload.resource_type}); ` +
            'expected a normalized {event, tracking_number} body from the signing relay. Skipping — ' +
            'no delivery fabricated.'
        );
        return NextResponse.json({ success: true, skipped: true, reason: 'native_resource_shape_unsupported' });
    }

    const event = (payload.event || '').toLowerCase();
    const trackingNumber = (payload.tracking_number || payload.trackingNumber || '').trim();

    // 3. Only act on a real delivery event.
    if (event !== 'delivered') {
        return NextResponse.json({ success: true, skipped: true, reason: `ignored_event:${event || 'none'}` });
    }
    if (!trackingNumber) {
        console.warn('[ShipStation] delivered event with no tracking_number — skipping');
        return NextResponse.json({ success: true, skipped: true, reason: 'no_tracking_number' });
    }

    // Delivery timestamp: prefer the carrier scan time from the event, else now().
    const rawDeliveredAt = payload.delivered_at || payload.deliveredAt;
    const deliveredAt = rawDeliveredAt ? new Date(rawDeliveredAt) : new Date();
    if (isNaN(deliveredAt.getTime())) {
        return NextResponse.json({ error: 'Invalid delivered_at timestamp' }, { status: 400 });
    }

    // 4. Dedup by tracking_number — only flip rows not already delivered.
    //    RETURNING lets us distinguish "updated" from "already delivered / unknown tracking".
    try {
        const updated = await query<{ tracking_id: string; payment_id: string }>(
            `UPDATE peptide_order_tracking
                SET delivered_at = $1,
                    stage = 'wc_delivered',
                    updated_at = NOW()
              WHERE tracking_number = $2
                AND channel = 'woo'
                AND delivered_at IS NULL
            RETURNING tracking_id, payment_id`,
            [deliveredAt.toISOString(), trackingNumber]
        );

        if (updated.length === 0) {
            // Either already delivered (idempotent re-fire) or tracking unknown to us.
            const existing = await query<{ tracking_id: string; delivered_at: string | null }>(
                `SELECT tracking_id, delivered_at FROM peptide_order_tracking
                  WHERE tracking_number = $1 AND channel = 'woo' LIMIT 1`,
                [trackingNumber]
            );
            if (existing.length === 0) {
                console.warn(`[ShipStation] delivered event for unknown tracking ${trackingNumber}`);
                return NextResponse.json({ success: true, skipped: true, reason: 'unknown_tracking' });
            }
            return NextResponse.json({ success: true, skipped: true, reason: 'already_delivered' });
        }

        console.log(
            `[ShipStation] Marked ${updated.length} order(s) delivered for tracking ${trackingNumber} ` +
            `(payment_id=${updated.map(u => u.payment_id).join(',')})`
        );
        return NextResponse.json({ success: true, updated: updated.length, tracking_number: trackingNumber });
    } catch (error) {
        console.error('[ShipStation] Failed to record delivery:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

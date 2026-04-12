/**
 * ABXTac WooCommerce Webhook Handler
 *
 * Listens for order events from the ABXTac WooCommerce store.
 * Currently handles order.updated (cancellation/refund triggers Stripe refund).
 *
 * Webhook setup (WooCommerce admin → Settings → Advanced → Webhooks):
 *   Topic: Order updated  (also: Order deleted)
 *   Delivery URL: https://nowoptimal.com/ops/api/abxtac/webhook
 *   Secret: value of env var ABXTAC_WEBHOOK_SECRET
 *   API Version: WP REST API Integration v3
 *
 * Security: HMAC-SHA256 signature validation via x-wc-webhook-signature.
 *
 * Refund pathway:
 *   When a WooCommerce order transitions to 'cancelled' or 'refunded':
 *     1. Look up the _stripe_charge_id meta (PaymentIntent ID) stored at order creation
 *     2. Call refundPaymentTransaction() — idempotent: safe if webhook is redelivered
 *     3. Stripe refund → payment_transactions update → peptide_dispenses reversal → Healthie receipt
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { refundPaymentTransaction } from '@/lib/abxtac-refund';

const WEBHOOK_SECRET = process.env.ABXTAC_WEBHOOK_SECRET || '';

interface WooOrderPayload {
  id: number;
  status: string;
  total: string;
  billing?: { first_name?: string; last_name?: string; email?: string };
  line_items?: Array<{ name: string; sku: string; quantity: number }>;
  meta_data?: Array<{ key: string; value: any }>;
}

function validateSignature(rawBody: string, signature: string): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  // Timing-safe comparison
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getStripeChargeIdFromOrder(order: WooOrderPayload): string | null {
  const meta = order.meta_data?.find(m => m.key === '_stripe_charge_id');
  return meta?.value ? String(meta.value) : null;
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-wc-webhook-signature') || '';
    const topic = request.headers.get('x-wc-webhook-topic') || '';
    const contentType = request.headers.get('content-type') || '';
    const rawBody = await request.text();

    // WooCommerce activation ping: form-encoded `webhook_id=N` with no signature.
    // Ack so WC marks the webhook healthy.
    if (!signature && contentType.includes('application/x-www-form-urlencoded') && rawBody.startsWith('webhook_id=')) {
      return NextResponse.json({ ok: true, ping: true });
    }

    if (!validateSignature(rawBody, signature)) {
      console.error(`[abxtac-webhook] Invalid signature (bodyLen=${rawBody.length})`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let order: WooOrderPayload;
    try {
      order = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    console.log(`[abxtac-webhook] topic=${topic} order=#${order.id} status=${order.status}`);

    // Handle cancellation / refund / deletion
    const isCancellation =
      topic === 'order.deleted' ||
      order.status === 'cancelled' ||
      order.status === 'refunded' ||
      order.status === 'failed';

    if (!isCancellation) {
      // Not a cancellation event — acknowledge and move on.
      // (order.created / order.updated to processing/completed handled by ShipStation and ship-order route directly.)
      return NextResponse.json({ success: true, action: 'acknowledged', order_id: order.id, status: order.status });
    }

    const stripeChargeId = getStripeChargeIdFromOrder(order);

    if (!stripeChargeId) {
      // No charge to refund (e.g. test orders like YPB integration test #101 have no Stripe charge)
      console.log(`[abxtac-webhook] Order #${order.id} cancelled but no _stripe_charge_id meta — nothing to refund`);
      return NextResponse.json({
        success: true,
        action: 'cancelled_no_refund',
        order_id: order.id,
        reason: 'No Stripe charge associated with this order',
      });
    }

    const reason = `WooCommerce order #${order.id} ${order.status || 'cancelled'}`;
    const result = await refundPaymentTransaction({
      stripeChargeId,
      reason,
      actor: 'WooCommerce Webhook',
    });

    if (!result.success) {
      console.error(`[abxtac-webhook] Refund failed for order #${order.id}:`, result.error);
      return NextResponse.json(
        { success: false, order_id: order.id, error: result.error },
        { status: 500 }
      );
    }

    console.log(
      `[abxtac-webhook] Order #${order.id} → refund ${result.alreadyRefunded ? 'ALREADY DONE' : 'processed'} ($${result.refundAmount?.toFixed(2)}), dispenses reversed: ${result.dispensesReversed || 0}`
    );

    return NextResponse.json({
      success: true,
      action: result.alreadyRefunded ? 'already_refunded' : 'refunded',
      order_id: order.id,
      refund_id: result.refundId,
      refund_amount: result.refundAmount,
      dispenses_reversed: result.dispensesReversed,
      healthie_document_id: result.healthieDocumentId,
    });
  } catch (error: any) {
    console.error('[abxtac-webhook] Error:', error);
    return NextResponse.json({ error: error.message || 'Webhook processing failed' }, { status: 500 });
  }
}

// Health check — useful for verifying the webhook is live from WooCommerce admin
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'abxtac-webhook',
    signature_configured: !!WEBHOOK_SECRET,
  });
}

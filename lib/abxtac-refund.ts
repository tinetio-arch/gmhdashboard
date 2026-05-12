/**
 * ABXTac Refund Core Logic
 *
 * Shared refund pathway used by:
 *   - Manual iPad refund (app/api/ipad/billing/refund/route.ts)
 *   - WooCommerce webhook (app/api/abxtac/webhook/route.ts) on order.cancelled/refunded
 *
 * Flow (idempotent):
 *   1. Look up payment_transactions row (by transaction_id OR by stripe_charge_id)
 *   2. If already refunded, return early with existing refund info
 *   3. Issue Stripe refund (handles both pi_ and ch_ IDs)
 *   4. Mark original payment_transactions row as 'refunded' (stripe_refund_id, refunded_at, refund_reason)
 *   5. Insert audit-trail refund row (negative amount, original_transaction_id linkage)
 *   6. Reverse peptide_dispenses (status='Cancelled', paid=false) via stripe_payment_intent_id
 *   7. Upload refund receipt PDF to patient's Healthie chart (best-effort)
 */

import Stripe from 'stripe';
import { query } from '@/lib/db';
import { uploadSimpleReceiptToHealthie } from '@/lib/simpleReceiptUpload';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10' as any,
});

export interface RefundResult {
  success: boolean;
  alreadyRefunded?: boolean;
  refundId?: string;
  refundAmount?: number;
  receiptNumber?: string;
  healthieDocumentId?: string | null;
  dispensesReversed?: number;
  wcOrderCancelled?: boolean;
  wcOrderId?: number | null;
  error?: string;
}

export interface RefundOptions {
  /** payment_transactions.transaction_id (UUID) — preferred lookup */
  transactionId?: string;
  /** Stripe PaymentIntent ID or Charge ID — fallback lookup (used by webhook) */
  stripeChargeId?: string;
  /** Reason for refund (stored in refund_reason) */
  reason?: string;
  /** Actor label for receipt provider name (e.g. staff email, 'WooCommerce Webhook') */
  actor?: string;
}

/**
 * Refund a payment_transactions record.
 *
 * Idempotent: safe to call multiple times for the same transaction — if
 * already refunded, returns { alreadyRefunded: true } without re-charging.
 */
export async function refundPaymentTransaction(opts: RefundOptions): Promise<RefundResult> {
  const { transactionId, stripeChargeId, reason, actor } = opts;

  if (!transactionId && !stripeChargeId) {
    return { success: false, error: 'Must provide transactionId or stripeChargeId' };
  }

  // 1. Look up transaction
  const lookupSql = transactionId
    ? `SELECT pt.*, p.full_name, p.email, p.healthie_client_id, p.client_type_key,
              hc.healthie_client_id as hc_healthie_id
         FROM payment_transactions pt
         JOIN patients p ON pt.patient_id = p.patient_id
         LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
         WHERE pt.transaction_id = $1`
    : `SELECT pt.*, p.full_name, p.email, p.healthie_client_id, p.client_type_key,
              hc.healthie_client_id as hc_healthie_id
         FROM payment_transactions pt
         JOIN patients p ON pt.patient_id = p.patient_id
         LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
         WHERE pt.stripe_charge_id = $1 AND pt.status = 'succeeded'
         ORDER BY pt.created_at DESC LIMIT 1`;

  const [txn] = await query<any>(lookupSql, [transactionId || stripeChargeId]);

  if (!txn) {
    return {
      success: false,
      error: `No payment_transactions row found for ${transactionId ? 'transaction_id' : 'stripe_charge_id'}=${transactionId || stripeChargeId}`,
    };
  }

  // 2. Idempotency check
  if (txn.status === 'refunded') {
    return {
      success: true,
      alreadyRefunded: true,
      refundId: txn.stripe_refund_id || undefined,
      refundAmount: Number(txn.amount),
    };
  }

  if (!txn.stripe_charge_id) {
    if (txn.charged_to === 'company' || txn.stripe_account === 'company') {
      return {
        success: false,
        error: 'Company-paid orders cannot be refunded here (no patient charge to reverse). To cancel, void the WooCommerce order on abxtac.com directly.',
      };
    }
    return {
      success: false,
      error: 'Transaction has no Stripe charge ID — cannot refund (likely a Healthie billing item).',
    };
  }

  // 3. Process Stripe refund
  let refund: Stripe.Refund;
  try {
    if (txn.stripe_charge_id.startsWith('pi_')) {
      refund = await stripe.refunds.create({
        payment_intent: txn.stripe_charge_id,
        reason: 'requested_by_customer',
      });
    } else {
      refund = await stripe.refunds.create({
        charge: txn.stripe_charge_id,
        reason: 'requested_by_customer',
      });
    }
  } catch (stripeErr: any) {
    // If Stripe says already refunded, treat as idempotent success
    if (stripeErr?.code === 'charge_already_refunded') {
      await query(
        `UPDATE payment_transactions SET status='refunded', refunded_at=COALESCE(refunded_at, NOW()), refund_reason=COALESCE(refund_reason, $1) WHERE transaction_id=$2`,
        [reason || 'Already refunded in Stripe', txn.transaction_id]
      );
      return { success: true, alreadyRefunded: true, refundAmount: Number(txn.amount) };
    }
    console.error('[abxtac-refund] Stripe error:', stripeErr.message);
    return { success: false, error: `Stripe refund failed: ${stripeErr.message}` };
  }

  const refundAmount = refund.amount / 100;
  const refundReceiptNumber = `REF-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

  console.log(`[abxtac-refund] Stripe refund ${refund.id} — $${refundAmount.toFixed(2)} for ${txn.full_name}`);

  // 4. Upload refund receipt to Healthie (best-effort, non-blocking)
  let healthieDocumentId: string | null = null;
  const healthieClientId = txn.hc_healthie_id || txn.healthie_client_id;

  if (healthieClientId) {
    try {
      healthieDocumentId = await uploadSimpleReceiptToHealthie({
        healthieClientId,
        receiptNumber: refundReceiptNumber,
        date: new Date(),
        patientName: txn.full_name,
        description: `REFUND: ${txn.description || 'Service refund'}`,
        amount: -refundAmount,
        paymentMethod: 'Refund to card on file',
        clinicName: 'NOW Optimal Health',
        providerName: actor || 'Staff',
        isMensHealth: txn.client_type_key === 'nowmenshealth',
      });
      if (healthieDocumentId) {
        console.log(`[abxtac-refund] Receipt ${refundReceiptNumber} uploaded to Healthie: ${healthieDocumentId}`);
      }
    } catch (receiptErr) {
      console.error('[abxtac-refund] Receipt upload failed (non-blocking):', receiptErr);
    }
  }

  // 5. Update original transaction
  await query(
    `UPDATE payment_transactions
     SET status = 'refunded',
         stripe_refund_id = $1,
         refunded_at = NOW(),
         refund_reason = $2
     WHERE transaction_id = $3`,
    [refund.id, reason || 'Refund', txn.transaction_id]
  );

  // 5b. FIX(2026-04-22): Cancel WooCommerce order so ShipStation doesn't ship a refunded order.
  // Look up WC order ID from the transaction row. For older orders missing the column,
  // fall back to querying WC by _stripe_charge_id metadata.
  let wcCancelled = false;
  let wcOrderId: number | null = txn.woocommerce_order_id || null;
  const wcUrl = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
  const wcKey = process.env.ABXTAC_CONSUMER_KEY;
  const wcSecret = process.env.ABXTAC_CONSUMER_SECRET;

  if (wcKey && wcSecret) {
    try {
      // Fallback: if no stored WC order ID, search WC by Stripe charge ID
      if (!wcOrderId && txn.stripe_charge_id) {
        const searchUrl = `${wcUrl}/wp-json/wc/v3/orders?search=${txn.stripe_charge_id}&per_page=1&consumer_key=${wcKey}&consumer_secret=${wcSecret}`;
        const searchResp = await fetch(searchUrl);
        if (searchResp.ok) {
          const orders = await searchResp.json();
          if (orders.length > 0) {
            wcOrderId = orders[0].id;
            console.log(`[abxtac-refund] Found WC order #${wcOrderId} via Stripe charge ID fallback`);
            // Back-fill the column for future lookups
            await query(
              'UPDATE payment_transactions SET woocommerce_order_id = $1 WHERE transaction_id = $2',
              [wcOrderId, txn.transaction_id]
            ).catch(() => {});
          }
        }
      }

      // Also check pending_peptide_orders table (approval flow orders)
      if (!wcOrderId && txn.stripe_charge_id) {
        const [pendingOrder] = await query<{ woo_order_id: number }>(
          'SELECT woo_order_id FROM pending_peptide_orders WHERE stripe_payment_intent_id = $1 AND woo_order_id IS NOT NULL LIMIT 1',
          [txn.stripe_charge_id]
        );
        if (pendingOrder?.woo_order_id) {
          wcOrderId = pendingOrder.woo_order_id;
          console.log(`[abxtac-refund] Found WC order #${wcOrderId} via pending_peptide_orders`);
        }
      }

      // Cancel the WC order
      if (wcOrderId) {
        const cancelResp = await fetch(
          `${wcUrl}/wp-json/wc/v3/orders/${wcOrderId}?consumer_key=${wcKey}&consumer_secret=${wcSecret}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'cancelled',
              customer_note: `Order cancelled — refund processed. Stripe refund: ${refund.id}`,
            }),
          }
        );
        if (cancelResp.ok) {
          wcCancelled = true;
          console.log(`[abxtac-refund] ✅ WooCommerce order #${wcOrderId} cancelled → ShipStation will auto-cancel`);
        } else {
          const errText = await cancelResp.text().catch(() => '');
          console.error(`[abxtac-refund] ❌ Failed to cancel WC order #${wcOrderId}: ${cancelResp.status} ${errText}`);
        }
      } else {
        console.log(`[abxtac-refund] No WooCommerce order found for charge ${txn.stripe_charge_id} — may be in-clinic dispense (no shipping)`);
      }
    } catch (wcErr: any) {
      console.error('[abxtac-refund] WooCommerce cancellation failed (non-blocking):', wcErr.message);
    }
  }

  // 6. Log audit-trail refund row
  await query(
    `INSERT INTO payment_transactions
     (patient_id, amount, description, stripe_account, stripe_charge_id, stripe_refund_id,
      status, created_at, receipt_number, healthie_document_id, original_transaction_id, refund_reason)
     VALUES ($1, $2, $3, $4, $5, $6, 'refund', NOW(), $7, $8, $9, $10)`,
    [
      txn.patient_id,
      -refundAmount,
      `Refund: ${txn.description || 'Service'}`,
      txn.stripe_account || 'direct',
      txn.stripe_charge_id,
      refund.id,
      refundReceiptNumber,
      healthieDocumentId,
      txn.transaction_id,
      reason || 'Refund',
    ]
  );

  // 7. Reverse peptide_dispenses — mark any dispenses tied to this PaymentIntent as Cancelled
  let dispensesReversed = 0;
  try {
    const result = await query<{ sale_id: string }>(
      `UPDATE peptide_dispenses
       SET status = 'Cancelled',
           paid = false,
           notes = COALESCE(notes, '') || E'\\n[REFUNDED ' || NOW()::text || '] ' || $2
       WHERE stripe_payment_intent_id = $1
         AND status != 'Cancelled'
       RETURNING sale_id`,
      [txn.stripe_charge_id, reason || 'Refund']
    );
    dispensesReversed = result.length;
    if (dispensesReversed > 0) {
      console.log(`[abxtac-refund] Reversed ${dispensesReversed} peptide_dispenses for ${txn.stripe_charge_id}`);
    }
  } catch (dispenseErr) {
    console.error('[abxtac-refund] Peptide dispense reversal failed (non-blocking):', dispenseErr);
  }

  return {
    success: true,
    refundId: refund.id,
    refundAmount,
    receiptNumber: refundReceiptNumber,
    healthieDocumentId,
    dispensesReversed,
    wcOrderCancelled: wcCancelled,
    wcOrderId: wcOrderId,
  };
}

/**
 * iPad — Process Refund + Generate Refund Receipt + Upload to Healthie
 *
 * POST /api/ipad/billing/refund
 * Body: {
 *   transaction_id: string (UUID from payment_transactions),
 *   reason?: string
 * }
 *
 * Flow:
 *   1. Look up original transaction
 *   2. Refund via Stripe
 *   3. Generate refund receipt PDF
 *   4. Upload to patient's Healthie chart
 *   5. Log refund in payment_transactions
 *   6. Update original transaction status
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import Stripe from 'stripe';
import { uploadSimpleReceiptToHealthie } from '@/lib/simpleReceiptUpload';

export const maxDuration = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10' as any,
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { transaction_id, reason } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
    }

    // 1. Look up original transaction
    const [txn] = await query<any>(
      `SELECT pt.*, p.full_name, p.email, p.healthie_client_id, p.client_type_key,
              hc.healthie_client_id as hc_healthie_id
       FROM payment_transactions pt
       JOIN patients p ON pt.patient_id = p.patient_id
       LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id AND hc.is_active = true
       WHERE pt.transaction_id = $1`,
      [transaction_id]
    );

    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (txn.status === 'refunded') {
      return NextResponse.json({ error: 'This transaction has already been refunded' }, { status: 400 });
    }

    if (!txn.stripe_charge_id) {
      return NextResponse.json({ error: 'No Stripe charge ID — cannot refund. This may be a Healthie billing item.' }, { status: 400 });
    }

    // 2. Process Stripe refund
    let refund;
    try {
      // stripe_charge_id may be a PaymentIntent ID (pi_) or Charge ID (ch_)
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
      console.error('[Refund] Stripe error:', stripeErr.message);
      return NextResponse.json({
        error: `Stripe refund failed: ${stripeErr.message}`,
      }, { status: 400 });
    }

    console.log(`[Refund] Stripe refund ${refund.id} — $${(refund.amount / 100).toFixed(2)} for ${txn.full_name}`);

    const refundAmount = refund.amount / 100;
    const refundReceiptNumber = `REF-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    // 3. Upload refund receipt to Healthie
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
          amount: -refundAmount, // Negative to indicate refund
          paymentMethod: `Refund to card on file`,
          clinicName: 'NOW Optimal Health',
          providerName: (user as any).email || 'Staff',
          isMensHealth: txn.client_type_key === 'nowmenshealth',
        });

        if (healthieDocumentId) {
          console.log(`[Refund] Receipt ${refundReceiptNumber} uploaded to Healthie: ${healthieDocumentId}`);
        }
      } catch (receiptErr) {
        console.error('[Refund] Receipt upload failed (non-blocking):', receiptErr);
      }
    }

    // 4. Update original transaction
    await query(
      `UPDATE payment_transactions
       SET status = 'refunded',
           stripe_refund_id = $1,
           refunded_at = NOW(),
           refund_reason = $2
       WHERE transaction_id = $3`,
      [refund.id, reason || 'Staff-initiated refund', transaction_id]
    );

    // 5. Log refund as separate transaction for audit trail
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
        transaction_id,
        reason || 'Staff-initiated refund'
      ]
    );

    console.log(`[Refund] Complete — ${txn.full_name} refunded $${refundAmount.toFixed(2)}`);

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refundAmount,
        status: refund.status,
        receipt_number: refundReceiptNumber,
      },
      healthie_document_id: healthieDocumentId,
      message: `Refunded $${refundAmount.toFixed(2)} to ${txn.full_name}. Receipt uploaded to chart.`,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Refund] Error:', error);
    return NextResponse.json({ error: error.message || 'Refund failed' }, { status: 500 });
  }
}

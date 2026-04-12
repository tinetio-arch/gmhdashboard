/**
 * iPad — Process Refund + Generate Refund Receipt + Upload to Healthie
 *
 * POST /api/ipad/billing/refund
 * Body: {
 *   transaction_id: string (UUID from payment_transactions),
 *   reason?: string
 * }
 *
 * Thin wrapper around lib/abxtac-refund.refundPaymentTransaction() — same logic
 * used by the WooCommerce webhook handler, so manual and automated refunds behave
 * identically (Stripe refund → payment_transactions update → peptide_dispenses
 * reversal → Healthie receipt → audit trail).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { refundPaymentTransaction } from '@/lib/abxtac-refund';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { transaction_id, reason } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
    }

    const result = await refundPaymentTransaction({
      transactionId: transaction_id,
      reason: reason || 'Staff-initiated refund',
      actor: (user as any).email || 'Staff',
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.alreadyRefunded) {
      return NextResponse.json({
        success: true,
        already_refunded: true,
        refund: { id: result.refundId, amount: result.refundAmount },
        message: 'This transaction was already refunded.',
      });
    }

    return NextResponse.json({
      success: true,
      refund: {
        id: result.refundId,
        amount: result.refundAmount,
        receipt_number: result.receiptNumber,
      },
      healthie_document_id: result.healthieDocumentId,
      dispenses_reversed: result.dispensesReversed,
      message: `Refunded $${result.refundAmount?.toFixed(2)}. ${result.dispensesReversed ? `${result.dispensesReversed} dispense(s) marked cancelled. ` : ''}Receipt uploaded to chart.`,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Refund] Error:', error);
    return NextResponse.json({ error: error.message || 'Refund failed' }, { status: 500 });
  }
}

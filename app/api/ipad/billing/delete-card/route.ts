import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import Stripe from 'stripe';

/**
 * DELETE /api/ipad/billing/delete-card
 * Remove a payment method from Direct Stripe
 *
 * Query params:
 * - payment_method_id: The Stripe payment method ID (must start with "pm_")
 */
export async function DELETE(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const { searchParams } = new URL(request.url);
        const paymentMethodId = searchParams.get('payment_method_id');

        if (!paymentMethodId) {
            return NextResponse.json({
                success: false,
                error: 'Missing required parameter: payment_method_id'
            }, { status: 400 });
        }

        // Only allow deleting Direct Stripe cards (payment method IDs start with "pm_")
        if (!paymentMethodId.startsWith('pm_')) {
            return NextResponse.json({
                success: false,
                error: 'Can only delete Direct Stripe payment methods. Healthie cards must be removed via Healthie.'
            }, { status: 400 });
        }

        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            return NextResponse.json({
                success: false,
                error: 'Direct Stripe not configured'
            }, { status: 500 });
        }

        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

        // Detach the payment method from the customer
        const paymentMethod = await stripe.paymentMethods.detach(paymentMethodId);

        console.log(`[Delete Card] Detached payment method ${paymentMethodId} from customer ${paymentMethod.customer}`);

        return NextResponse.json({
            success: true,
            message: `Card ending in ${paymentMethod.card?.last4} removed successfully`
        });

    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        console.error('[/api/ipad/billing/delete-card DELETE]', error);

        // Handle Stripe-specific errors
        if (error.type === 'StripeInvalidRequestError') {
            return NextResponse.json({
                success: false,
                error: error.message || 'Invalid payment method ID'
            }, { status: 400 });
        }

        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to delete payment method'
        }, { status: 500 });
    }
}

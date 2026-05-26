/**
 * POST /api/headless/add-direct-card
 *
 * Attaches a Stripe card token to the patient's Direct Stripe customer
 * so subsequent peptide checkouts (/api/headless/checkout) can charge
 * it. Mirrors what /api/ipad/billing/add-card-dual does for iPad, but:
 *   - takes a Stripe TOKEN (tok_xxx) instead of a PaymentMethod id
 *     (the mobile app currently tokenizes via Stripe's /v1/tokens),
 *   - is locked to the patient's healthie_id (no patient_id required).
 *
 * Idempotent enough for retries — re-attaching an already-attached PM
 * is a no-op, and we set it as the default payment method each time.
 *
 * Auth: x-jarvis-secret header
 *
 * Body: { healthie_id: string, stripe_token: string }
 * Response: { success, stripe_customer_id, payment_method_id, card }
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { query } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-04-10' as any,
});

export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthie_id, stripe_token } = body as {
            healthie_id?: string;
            stripe_token?: string;
        };

        if (!healthie_id || !stripe_token) {
            return NextResponse.json(
                { error: 'healthie_id and stripe_token are required' },
                { status: 400 }
            );
        }

        const [patient] = await query<{
            patient_id: string;
            full_name: string;
            email: string | null;
            stripe_customer_id: string | null;
        }>(
            `SELECT patient_id::text AS patient_id, full_name, email, stripe_customer_id
             FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
            [healthie_id]
        );

        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        let stripeCustomerId = patient.stripe_customer_id;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: patient.email || undefined,
                name: patient.full_name,
                description: `GMH Patient ID: ${patient.patient_id}`,
                metadata: {
                    patient_id: patient.patient_id,
                    healthie_id,
                    source: 'mobile_app_add_card',
                },
            });
            stripeCustomerId = customer.id;

            await query(
                `UPDATE patients SET stripe_customer_id = $1 WHERE patient_id = $2::uuid`,
                [stripeCustomerId, patient.patient_id]
            );

            console.log(`[add-direct-card] Created Stripe customer ${stripeCustomerId} for ${patient.full_name}`);
        }

        const paymentMethod = await stripe.paymentMethods.create({
            type: 'card',
            card: { token: stripe_token },
        });

        await stripe.paymentMethods.attach(paymentMethod.id, {
            customer: stripeCustomerId,
        });

        await stripe.customers.update(stripeCustomerId, {
            invoice_settings: { default_payment_method: paymentMethod.id },
        });

        console.log(`[add-direct-card] Attached ${paymentMethod.id} (${paymentMethod.card?.brand} •${paymentMethod.card?.last4}) to ${stripeCustomerId}`);

        return NextResponse.json({
            success: true,
            stripe_customer_id: stripeCustomerId,
            payment_method_id: paymentMethod.id,
            card: {
                brand: paymentMethod.card?.brand || null,
                last4: paymentMethod.card?.last4 || null,
                exp_month: paymentMethod.card?.exp_month || null,
                exp_year: paymentMethod.card?.exp_year || null,
            },
        });
    } catch (err: any) {
        console.error('[Headless API] add-direct-card error:', err);
        if (err?.type === 'StripeCardError' || err?.type === 'StripeInvalidRequestError') {
            return NextResponse.json({ error: err.message || 'Card error' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

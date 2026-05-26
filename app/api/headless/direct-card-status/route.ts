/**
 * GET /api/headless/direct-card-status?healthie_id=12345
 *
 * Reports whether the patient has a card on file in our Direct Stripe
 * account (the account peptide checkout charges via
 * /api/headless/checkout). The Healthie billing card is a separate
 * customer and is not checked here.
 *
 * Auth: x-jarvis-secret header
 *
 * Response:
 *   { has_card: boolean,
 *     card_count: number,
 *     stripe_customer_id: string | null,
 *     card?: { brand, last4, exp_month, exp_year } }
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { query } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-04-10' as any,
});

export async function GET(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthie_id');
    if (!healthieId) {
        return NextResponse.json({ error: 'healthie_id parameter is required' }, { status: 400 });
    }

    try {
        const [patient] = await query<{ stripe_customer_id: string | null }>(
            `SELECT stripe_customer_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
            [healthieId]
        );

        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        if (!patient.stripe_customer_id) {
            return NextResponse.json({
                has_card: false,
                card_count: 0,
                stripe_customer_id: null,
            });
        }

        const paymentMethods = await stripe.paymentMethods.list({
            customer: patient.stripe_customer_id,
            type: 'card',
        });

        const first = paymentMethods.data[0];
        return NextResponse.json({
            has_card: paymentMethods.data.length > 0,
            card_count: paymentMethods.data.length,
            stripe_customer_id: patient.stripe_customer_id,
            card: first ? {
                brand: first.card?.brand || null,
                last4: first.card?.last4 || null,
                exp_month: first.card?.exp_month || null,
                exp_year: first.card?.exp_year || null,
            } : undefined,
        });
    } catch (err: any) {
        console.error('[Headless API] direct-card-status error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

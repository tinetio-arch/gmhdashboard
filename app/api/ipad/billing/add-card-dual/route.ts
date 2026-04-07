import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

/**
 * POST /api/ipad/billing/add-card-dual
 * Add a payment method to Direct Stripe (and attempt Healthie)
 *
 * NOTE: Healthie uses their own Stripe Connect account, so we can only
 * save cards to Direct Stripe via this API. Healthie cards must be added
 * via Healthie's billing page.
 *
 * Body:
 * {
 *   patient_id: string;
 *   healthie_id: string;
 *   payment_method_id: string;  // From Stripe Elements
 *   card_details: { brand, last4, exp_month, exp_year }
 * }
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const body = await request.json();
        const { patient_id, healthie_id, payment_method_id, card_details } = body;

        if (!patient_id || !healthie_id || !payment_method_id) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: patient_id, healthie_id, payment_method_id'
            }, { status: 400 });
        }

        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey || stripeSecretKey === 'sk_live_PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD') {
            return NextResponse.json({
                success: false,
                error: 'Direct Stripe not configured'
            }, { status: 500 });
        }

        const Stripe = require('stripe');
        const stripe = new Stripe(stripeSecretKey);

        // FIX(2026-04-07): Use shared resolver — handles UUID/Healthie ID and auto-creates if needed
        const resolvedPatientId = await resolvePatientId(patient_id) || patient_id;

        // Get patient info
        const patientRows = await query<{
            full_name: string;
            email: string;
            stripe_customer_id: string | null;
        }>(
            `SELECT full_name, email, stripe_customer_id
             FROM patients
             WHERE patient_id = $1::uuid
             LIMIT 1`,
            [resolvedPatientId]
        );

        if (patientRows.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Patient not found'
            }, { status: 404 });
        }

        const patient = patientRows[0];

        console.log(`[Dual Card Save] Starting for patient ${patient_id} (${patient.full_name})`);

        // ==================== STEP 1: Save to Direct Stripe ====================

        let stripeCustomerId = patient.stripe_customer_id;

        if (!stripeCustomerId) {
            // Create new Stripe customer
            const customer = await stripe.customers.create({
                email: patient.email || undefined,
                name: patient.full_name,
                description: `GMH Patient ID: ${resolvedPatientId}`,
                metadata: {
                    patient_id: resolvedPatientId,
                    healthie_id: healthie_id,
                    source: 'GMH iPad App - Dual Card Save'
                }
            });
            stripeCustomerId = customer.id;

            // Save to database
            await query(
                `UPDATE patients SET stripe_customer_id = $1 WHERE patient_id = $2::uuid`,
                [stripeCustomerId, resolvedPatientId]
            );

            console.log(`[Dual Card Save] Created Stripe customer: ${stripeCustomerId}`);
        }

        // Attach payment method to Direct Stripe customer
        await stripe.paymentMethods.attach(payment_method_id, {
            customer: stripeCustomerId,
        });

        // Set as default payment method
        await stripe.customers.update(stripeCustomerId, {
            invoice_settings: {
                default_payment_method: payment_method_id,
            },
        });

        console.log(`[Dual Card Save] ✅ Attached payment method ${payment_method_id} to Direct Stripe customer ${stripeCustomerId}`);

        // ==================== STEP 2: Healthie ====================

        // Healthie uses their own Stripe Connect account. We cannot directly
        // save cards to Healthie's Stripe - patients must add cards via
        // Healthie's billing page which uses their Stripe Connect setup.

        console.log(`[Dual Card Save] ⚠️ Healthie card must be added separately via Healthie billing page`);

        return NextResponse.json({
            success: true,
            direct_stripe: {
                saved: true,
                customer_id: stripeCustomerId,
                payment_method_id: payment_method_id,
                card: card_details
            },
            healthie_stripe: {
                saved: false,
                reason: 'Healthie uses separate Stripe Connect account - cannot clone cards',
                instructions: 'Patient must add card at Healthie billing page',
                url: `https://app.gethealthie.com/patients/${healthie_id}/billing`
            },
            message: `Card saved to Direct Stripe! Card brand: ${card_details?.brand} ending in ${card_details?.last4}`,
            healthie_note: `To use this card in Healthie, patient needs to add it at: https://app.gethealthie.com/patients/${healthie_id}/billing`
        });

    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/billing/add-card-dual POST]', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to add card'
        }, { status: 500 });
    }
}

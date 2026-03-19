import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { createHealthieClient } from '@/lib/healthie';

/**
 * POST /api/ipad/billing/charge
 * Charge a patient using either Healthie's Stripe or direct Stripe integration
 *
 * Body:
 * {
 *   patient_id: string;
 *   amount: number;
 *   description: string;
 *   stripe_account: "healthie" | "direct";
 * }
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const body = await request.json();
        const { patient_id, amount, description, stripe_account } = body;

        // Validate inputs
        if (!patient_id || !amount || !stripe_account) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: patient_id, amount, stripe_account'
            }, { status: 400 });
        }

        if (amount <= 0) {
            return NextResponse.json({
                success: false,
                error: 'Amount must be greater than 0'
            }, { status: 400 });
        }

        if (!['healthie', 'direct'].includes(stripe_account)) {
            return NextResponse.json({
                success: false,
                error: 'stripe_account must be "healthie" or "direct"'
            }, { status: 400 });
        }

        // FIX(2026-03-19): Resolve patient_id — may be UUID or Healthie numeric ID
        let resolvedPatientId = patient_id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patient_id);
        if (!isUuid) {
            const [resolved] = await query<{ patient_id: string }>(
                `SELECT p.patient_id FROM patients p
                 LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id AND hc.is_active = true
                 WHERE hc.healthie_client_id = $1 OR p.healthie_client_id = $1
                 LIMIT 1`,
                [patient_id]
            );
            if (!resolved) {
                return NextResponse.json({ success: false, error: 'Patient not found for ID: ' + patient_id }, { status: 404 });
            }
            resolvedPatientId = resolved.patient_id;
        }

        // Get patient info
        const patientRows = await query<{
            full_name: string;
            email: string;
        }>(
            `SELECT full_name, email FROM patients WHERE patient_id = $1::uuid LIMIT 1`,
            [resolvedPatientId]
        );

        if (patientRows.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Patient not found'
            }, { status: 404 });
        }

        const patient = patientRows[0];

        // Route to appropriate Stripe account
        if (stripe_account === 'healthie') {
            return await chargeViaHealthie(resolvedPatientId, patient.full_name, amount, description);
        } else {
            return await chargeViaDirectStripe(resolvedPatientId, patient.full_name, patient.email, amount, description);
        }

    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/billing/charge POST]', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process charge'
        }, { status: 500 });
    }
}

/**
 * Charge via Healthie's Stripe (uses saved payment methods in Healthie)
 */
async function chargeViaHealthie(
    patientId: string,
    patientName: string,
    amount: number,
    description: string
) {
    const healthieClient = createHealthieClient();
    if (!healthieClient) {
        return NextResponse.json({
            success: false,
            error: 'Healthie client not configured'
        }, { status: 500 });
    }

    // Get Healthie client ID
    const clientMapping = await query<{ healthie_client_id: string }>(
        `SELECT healthie_client_id
         FROM healthie_clients
         WHERE patient_id = $1 AND is_active = TRUE
         LIMIT 1`,
        [patientId]
    );

    if (clientMapping.length === 0) {
        return NextResponse.json({
            success: false,
            error: 'Patient not linked to Healthie yet'
        }, { status: 400 });
    }

    const healthieClientId = clientMapping[0].healthie_client_id;

    // Check if patient has payment method on file
    const hasPaymentMethod = await healthieClient.hasPaymentMethod(healthieClientId);
    if (!hasPaymentMethod) {
        return NextResponse.json({
            success: false,
            error: 'Patient does not have a payment method on file in Healthie. Please add a card first.'
        }, { status: 400 });
    }

    try {
        console.log(`[chargeViaHealthie] Attempting to charge ${patientName} (Healthie ID: ${healthieClientId}) $${amount} - ${description}`);

        // Create billing item (charges immediately)
        const billingItem = await healthieClient.createBillingItem({
            client_id: healthieClientId,
            amount,
            description,
        });

        console.log(`[chargeViaHealthie] SUCCESS - Billing item created: ${billingItem.id}, state: ${billingItem.state}`);

        // Log the transaction
        await query(
            `INSERT INTO payment_transactions (
                patient_id, amount, description, stripe_account,
                healthie_billing_item_id, status, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW())`,
            [patientId, amount, description, 'healthie', billingItem.id, billingItem.state]
        );

        return NextResponse.json({
            success: true,
            stripe_account: 'healthie',
            patient_name: patientName,
            amount,
            charge_id: billingItem.id,
            status: billingItem.state,
            message: `Successfully charged ${patientName} $${amount.toFixed(2)} via Healthie Stripe`
        });

    } catch (error: any) {
        console.error('[chargeViaHealthie] FAILED - Error details:', {
            message: error.message,
            stack: error.stack,
            healthieClientId,
            amount,
            description
        });

        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to charge via Healthie',
            details: `Healthie Client ID: ${healthieClientId}, Amount: $${amount}`
        }, { status: 500 });
    }
}

/**
 * Charge via direct Stripe integration (MindGravity account)
 */
async function chargeViaDirectStripe(
    patientId: string,
    patientName: string,
    patientEmail: string,
    amount: number,
    description: string
) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey || stripeSecretKey === 'sk_live_PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD') {
        return NextResponse.json({
            success: false,
            error: 'Direct Stripe integration not configured yet. Please add STRIPE_SECRET_KEY to .env.local'
        }, { status: 500 });
    }

    try {
        const Stripe = require('stripe');
        const stripe = new Stripe(stripeSecretKey);

        // 1. Get or create Stripe customer
        const patientRows = await query<{ stripe_customer_id: string | null }>(
            `SELECT stripe_customer_id FROM patients WHERE patient_id = $1::uuid LIMIT 1`,
            [patientId]
        );

        let stripeCustomerId = patientRows[0]?.stripe_customer_id;

        if (!stripeCustomerId) {
            // Create new Stripe customer
            const customer = await stripe.customers.create({
                email: patientEmail || undefined,
                name: patientName,
                description: `GMH Patient ID: ${patientId}`,
                metadata: {
                    patient_id: patientId,
                    source: 'GMH iPad App'
                }
            });

            stripeCustomerId = customer.id;

            // Save to database
            await query(
                `UPDATE patients SET stripe_customer_id = $1 WHERE patient_id = $2::uuid`,
                [stripeCustomerId, patientId]
            );

            console.log(`[Direct Stripe] Created customer ${stripeCustomerId} for patient ${patientId}`);
        }

        // 2. Get payment methods for this customer
        const paymentMethods = await stripe.paymentMethods.list({
            customer: stripeCustomerId,
            type: 'card',
            limit: 10
        });

        if (paymentMethods.data.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Patient does not have a payment method on file in Direct Stripe. Please add a card first.',
                note: 'Cards in Healthie are separate from Direct Stripe. You need to add a card specifically for Direct Stripe.'
            }, { status: 400 });
        }

        // 3. Use the default payment method (first one in list)
        const paymentMethod = paymentMethods.data[0];

        // 4. Create payment intent and charge immediately
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert dollars to cents
            currency: 'usd',
            customer: stripeCustomerId,
            payment_method: paymentMethod.id,
            confirm: true, // Immediately confirm and charge
            description,
            metadata: {
                patient_id: patientId,
                patient_name: patientName,
                source: 'GMH iPad App'
            },
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            }
        });

        // 5. Log transaction to database
        await query(
            `INSERT INTO payment_transactions (
                patient_id, amount, description, stripe_account,
                stripe_charge_id, stripe_customer_id, status, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW())`,
            [
                patientId,
                amount,
                description,
                'direct',
                paymentIntent.id,
                stripeCustomerId,
                paymentIntent.status
            ]
        );

        console.log(`[Direct Stripe] Charged ${amount} to customer ${stripeCustomerId}, payment intent: ${paymentIntent.id}, status: ${paymentIntent.status}`);

        return NextResponse.json({
            success: true,
            stripe_account: 'direct',
            patient_name: patientName,
            amount,
            charge_id: paymentIntent.id,
            status: paymentIntent.status,
            message: `Successfully charged ${patientName} $${amount.toFixed(2)} via Direct Stripe (MindGravity)`,
            payment_method: {
                brand: paymentMethod.card?.brand,
                last4: paymentMethod.card?.last4
            }
        });

    } catch (error: any) {
        console.error('[chargeViaDirectStripe] Error:', error);

        // Log failed transaction
        await query(
            `INSERT INTO payment_transactions (
                patient_id, amount, description, stripe_account,
                status, error_message, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW())`,
            [patientId, amount, description, 'direct', 'failed', error.message]
        );

        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to charge via Direct Stripe',
            details: error.type || 'Unknown error'
        }, { status: 500 });
    }
}

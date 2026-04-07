import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { createHealthieClient } from '@/lib/healthie';
import { uploadSimpleReceiptToHealthie } from '@/lib/simpleReceiptUpload';
import { v4 as uuidv4 } from 'uuid';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

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
        const { patient_id, amount, description, stripe_account, product_id, items } = body;
        // items: optional array of { product_id, name, amount, quantity } for multi-product cart checkout

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

        // FIX(2026-04-07): Use shared resolver — handles UUID/Healthie ID and auto-creates if needed
        const resolvedPatientId = await resolvePatientId(patient_id);
        if (!resolvedPatientId) {
            return NextResponse.json({ success: false, error: 'Patient not found for ID: ' + patient_id }, { status: 404 });
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

        // FIX(2026-04-01): ALL iPad charges show "NOWOptimal Service" on Stripe receipts
        // for compliance and brand consistency. Internal logs keep the original descriptions.
        const internalDescription = description; // preserved for DB logging (CEO dashboard, internal tracking)
        const stripeDescription = "NOWOptimal Service"; // standardized for ALL iPad charges

        console.log(`[Billing] iPad charge — Receipt shows "NOWOptimal Service" (internal: ${description})`);

        // Check if this is a peptide charge for internal tracking
        let isPeptideCharge = false;
        const productIdsToCheck: string[] = [];
        if (product_id) productIdsToCheck.push(product_id);
        if (items && Array.isArray(items)) {
            items.forEach((item: any) => { if (item.product_id) productIdsToCheck.push(item.product_id); });
        }

        if (productIdsToCheck.length > 0) {
            try {
                const peptideCheck = await query<{ product_id: string }>(
                    `SELECT product_id FROM peptide_products WHERE product_id = ANY($1) LIMIT 1`,
                    [productIdsToCheck]
                );
                if (peptideCheck.length > 0) {
                    isPeptideCharge = true;
                    console.log(`[Billing] Peptide product detected in charge`);
                }
            } catch (err) {
                console.warn('[Billing] Peptide check failed:', err);
            }
        }

        // Route to appropriate Stripe account
        if (stripe_account === 'healthie') {
            return await chargeViaHealthie(resolvedPatientId, patient.full_name, amount, stripeDescription, internalDescription);
        } else {
            return await chargeViaDirectStripe(resolvedPatientId, patient.full_name, patient.email, amount, stripeDescription, product_id, items, internalDescription);
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
    description: string,
    internalDescription?: string  // Original description for internal tracking
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

        // Generate receipt with FIXED simple system
        const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        let healthieDocumentId: string | null = null;

        // FIXED: Now uses actual charge data and simple single-page receipt
        try {
            // Determine if this is a men's health service
            // (You can expand this logic based on actual service types)
            const isMensHealth = internalDescription?.toLowerCase().includes('men') ||
                                 internalDescription?.toLowerCase().includes('testosterone') ||
                                 internalDescription?.toLowerCase().includes('trt');

            healthieDocumentId = await uploadSimpleReceiptToHealthie({
                healthieClientId,
                receiptNumber,
                date: new Date(),
                patientName,
                description: internalDescription || description,  // ACTUAL service description
                amount,
                paymentMethod: 'Credit Card (Healthie)',
                clinicName: 'NOW Optimal Health',
                providerName: 'NOW Optimal Staff',
                isMensHealth
            });

            if (healthieDocumentId) {
                console.log(`[Billing] Receipt ${receiptNumber} uploaded to Healthie document ${healthieDocumentId} for ${patientName}`);
            }
        } catch (receiptError) {
            console.error('[Billing] Failed to upload receipt:', receiptError);
            // Don't fail the charge if receipt upload fails
        }

        // Log the transaction with receipt info
        await query(
            `INSERT INTO payment_transactions (
                patient_id, amount, description, stripe_account,
                healthie_billing_item_id, status, created_at,
                receipt_number, healthie_document_id
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), $7, $8)`,
            [patientId, amount, internalDescription || description, 'healthie', billingItem.id, billingItem.state, receiptNumber, healthieDocumentId]
        );

        return NextResponse.json({
            success: true,
            stripe_account: 'healthie',
            patient_name: patientName,
            amount,
            charge_id: billingItem.id,
            status: billingItem.state,
            receipt_number: receiptNumber,
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
    description: string,
    product_id?: string,
    items?: Array<{ product_id: string; name: string; amount: number; quantity?: number }>,
    internalDescription?: string  // FIX(2026-04-01): Original description for DB logging (pre-sanitization)
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

        // 5. Log transaction to database (use original internal description, not sanitized Stripe one)
        await query(
            `INSERT INTO payment_transactions (
                patient_id, amount, description, stripe_account,
                stripe_charge_id, stripe_customer_id, status, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW())`,
            [
                patientId,
                amount,
                internalDescription || description,
                'direct',
                paymentIntent.id,
                stripeCustomerId,
                paymentIntent.status
            ]
        );

        console.log(`[Direct Stripe] Charged ${amount} to customer ${stripeCustomerId}, payment intent: ${paymentIntent.id}, status: ${paymentIntent.status}`);

        // === AUTO-CREATE PEPTIDE DISPENSES ===
        let dispenseId = null;
        const dispenseIds: number[] = [];

        // Build list of products to create dispenses for
        const productsToDispense: Array<{ product_id: string; name: string; amount: number; quantity: number }> = [];

        if (items && items.length > 0) {
            // Multi-item cart checkout
            for (const item of items) {
                if (item.product_id) {
                    productsToDispense.push({
                        product_id: item.product_id,
                        name: item.name,
                        amount: item.amount,
                        quantity: item.quantity || 1
                    });
                }
            }
        } else if (product_id) {
            // Single item (backwards compatible)
            productsToDispense.push({ product_id, name: description, amount, quantity: 1 });
        }

        for (const item of productsToDispense) {
            try {
                const productCheck = await query<{ product_id: string; name: string }>(
                    'SELECT product_id, name FROM peptide_products WHERE product_id = $1 AND active = true',
                    [item.product_id]
                );

                if (productCheck.length > 0) {
                    const product = productCheck[0];
                    const qty = item.quantity || 1;
                    for (let i = 0; i < qty; i++) {
                        const dispenseResult = await query<{ sale_id: number }>(
                            `INSERT INTO peptide_dispenses
                                (product_id, quantity, patient_name, sale_date, status, education_complete,
                                 notes, paid, stripe_payment_intent_id, amount_charged)
                             VALUES ($1, 1, $2, CURRENT_DATE, 'Paid', true, $3, true, $4, $5)
                             RETURNING sale_id`,
                            [
                                item.product_id,
                                patientName || 'Unknown',
                                `Auto-created from iPad billing. Charge: ${paymentIntent.id || 'N/A'}`,
                                paymentIntent.id || null,
                                item.amount
                            ]
                        );
                        const sid = dispenseResult[0]?.sale_id || null;
                        if (sid) dispenseIds.push(sid);
                        console.log(`[billing/charge] Auto-created peptide dispense #${sid} for ${product.name}`);
                    }
                }
            } catch (dispenseError: any) {
                console.error('[billing/charge] Failed to auto-create dispense:', dispenseError.message);
            }
        }

        // For backwards compatibility, set dispenseId to the first one
        dispenseId = dispenseIds.length > 0 ? dispenseIds[0] : null;

        // Generate receipt with FIXED simple system
        const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        let healthieDocumentId: string | null = null;

        // FIXED: Now uses actual charge data and simple single-page receipt
        try {
            // Get Healthie client ID for receipt upload
            const [clientMapping] = await query<{ healthie_client_id: string }>(
                `SELECT healthie_client_id FROM healthie_clients
                 WHERE patient_id = $1 AND is_active = TRUE LIMIT 1`,
                [patientId]
            );

            if (clientMapping?.healthie_client_id) {
                // Build consolidated description from items or single product
                let receiptDescription = internalDescription || description;
                if (items && items.length > 0) {
                    // For multiple items, list them
                    receiptDescription = items.map(item =>
                        `${item.name}${item.quantity > 1 ? ` (x${item.quantity})` : ''}`
                    ).join(', ');
                }

                // Determine if this is a men's health service
                const isMensHealth = receiptDescription.toLowerCase().includes('men') ||
                                     receiptDescription.toLowerCase().includes('testosterone') ||
                                     receiptDescription.toLowerCase().includes('trt');

                healthieDocumentId = await uploadSimpleReceiptToHealthie({
                    healthieClientId: clientMapping.healthie_client_id,
                    receiptNumber,
                    date: new Date(),
                    patientName,
                    description: receiptDescription,  // ACTUAL service/products
                    amount,
                    paymentMethod: `${paymentMethod.card?.brand || 'Card'} ending ${paymentMethod.card?.last4 || '****'}`,
                    clinicName: 'NOW Optimal Health',
                    providerName: 'NOW Optimal Staff',
                    isMensHealth
                });

                if (healthieDocumentId) {
                    console.log(`[Billing] Receipt ${receiptNumber} uploaded to Healthie for ${patientName} - Service: "${receiptDescription}"`);
                }
            }
        } catch (receiptError) {
            console.error('[Billing] Failed to upload receipt:', receiptError);
            // Don't fail the charge if receipt upload fails
        }

        return NextResponse.json({
            success: true,
            stripe_account: 'direct',
            patient_name: patientName,
            amount,
            charge_id: paymentIntent.id,
            status: paymentIntent.status,
            receipt_number: receiptNumber,
            healthie_document_id: healthieDocumentId,
            message: `Successfully charged ${patientName} $${amount.toFixed(2)} via Direct Stripe (MindGravity)`,
            payment_method: {
                brand: paymentMethod.card?.brand,
                last4: paymentMethod.card?.last4
            },
            dispense_id: dispenseId,
            dispense_ids: dispenseIds
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

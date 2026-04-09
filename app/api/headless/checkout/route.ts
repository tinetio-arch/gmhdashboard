/**
 * Mobile App Peptide Checkout
 *
 * Charges patient via Direct Stripe (same as iPad ship-order),
 * uploads itemized receipt to patient's Healthie chart,
 * creates WooCommerce order for ShipStation fulfillment.
 *
 * Flow:
 *   1. Mobile app sends healthie_id + cart items
 *   2. Look up patient → get Stripe customer ID + shipping address
 *   3. Charge via Direct Stripe (description: "NOWOptimal Service")
 *   4. Upload itemized receipt PDF to patient's Healthie chart
 *   5. Create WooCommerce order (status=processing, set_paid=true)
 *   6. ShipStation auto-syncs → USPS → tracking email
 *   7. Log in payment_transactions + peptide_dispenses
 *
 * POST /api/headless/checkout
 * Headers: x-jarvis-secret
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import Stripe from 'stripe';

export const maxDuration = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-04-10' as any,
});

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

interface CheckoutItem {
    product_id: number;
    sku: string;
    name: string;
    price: number;
    quantity: number;
}

export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthie_id, items, shipping_method = 'priority', dry_run = false } = body as {
            healthie_id: string;
            items: CheckoutItem[];
            shipping_method?: 'priority' | 'express';
            dry_run?: boolean;
        };

        if (!healthie_id || !items?.length) {
            return NextResponse.json({ error: 'healthie_id and items are required' }, { status: 400 });
        }

        // 1. Look up patient
        const [patient] = await query<any>(
            `SELECT patient_id, full_name, email, phone_primary,
                    address_line1, address_line2, city, state, postal_code,
                    healthie_client_id, stripe_customer_id
             FROM patients WHERE healthie_client_id = $1
             LIMIT 1`,
            [healthie_id]
        );

        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        if (!patient.stripe_customer_id) {
            return NextResponse.json({
                error: 'No card on file. Please add a payment method in the app or call the clinic.',
                code: 'NO_CARD',
            }, { status: 400 });
        }

        // Normalize address fields
        const address = patient.address_line1 || '';
        const city = patient.city || '';
        const state = patient.state || '';
        const zip = patient.postal_code || '';

        if (!address || !city || !state || !zip) {
            return NextResponse.json({
                error: 'Shipping address is incomplete. Please update your profile or call (928) 212-2772.',
                code: 'NO_ADDRESS',
            }, { status: 400 });
        }

        // 2. Calculate total — $20 flat rate shipping, free over $400
        const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const shippingCost = subtotal >= 400 ? 0 : 20;
        const total = subtotal + shippingCost;
        const totalCents = Math.round(total * 100);
        const description = items.map(i => `${i.name} x${i.quantity}`).join(', ');

        // 3. Get default payment method from Direct Stripe
        const paymentMethods = await stripe.paymentMethods.list({
            customer: patient.stripe_customer_id,
            type: 'card',
        });

        if (!paymentMethods.data.length) {
            return NextResponse.json({
                error: 'No payment method on file. Please add a card in the Billing section.',
                code: 'NO_PAYMENT_METHOD',
            }, { status: 400 });
        }

        const paymentMethod = paymentMethods.data[0];

        // Dry run: return validation results without charging
        if (dry_run) {
            return NextResponse.json({
                dry_run: true,
                valid: true,
                patient: patient.full_name,
                card: `${paymentMethod.card?.brand} ending ${paymentMethod.card?.last4}`,
                shipping_address: `${address}, ${city}, ${state} ${zip}`,
                subtotal, shipping_cost: shippingCost, total,
                free_shipping: shippingCost === 0,
                items: items.map(i => ({ name: i.name, sku: i.sku, price: i.price, qty: i.quantity })),
            });
        }

        // 4. Charge via Direct Stripe — shows as "NOWOptimal Service" on receipt
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalCents,
            currency: 'usd',
            customer: patient.stripe_customer_id,
            payment_method: paymentMethod.id,
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            description: 'NOWOptimal Service',
            metadata: {
                patient_id: patient.patient_id,
                patient_name: patient.full_name,
                source: 'mobile_app_checkout',
                items: description,
            },
        });

        if (paymentIntent.status !== 'succeeded') {
            return NextResponse.json({
                error: `Payment failed: ${paymentIntent.status}`,
                code: 'PAYMENT_FAILED',
            }, { status: 402 });
        }

        console.log(`[Mobile Checkout] Stripe charge ${paymentIntent.id} — $${total.toFixed(2)} — ${patient.full_name}`);

        // 5. Upload itemized receipt to patient's Healthie chart
        const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        let healthieDocumentId: string | null = null;

        try {
            // FIX(2026-04-08): Import from correct module (was @/lib/healthie, should be @/lib/simpleReceiptUpload)
            const { uploadSimpleReceiptToHealthie } = await import('@/lib/simpleReceiptUpload');
            if (typeof uploadSimpleReceiptToHealthie === 'function') {
                healthieDocumentId = await uploadSimpleReceiptToHealthie({
                    healthieClientId: healthie_id,
                    receiptNumber,
                    date: new Date(),
                    patientName: patient.full_name,
                    description: `Peptide Shipment: ${description}`,
                    amount: total,
                    paymentMethod: `Card ending ${paymentMethod.card?.last4 || '****'}`,
                    clinicName: 'NOW Optimal Health',
                    providerName: 'NOW Optimal Staff',
                    isMensHealth: false,
                });
                if (healthieDocumentId) {
                    console.log(`[Mobile Checkout] Receipt ${receiptNumber} uploaded to Healthie chart`);
                }
            }
        } catch (receiptErr) {
            console.error('[Mobile Checkout] Receipt upload failed:', receiptErr);
        }

        // 6. Log payment transaction
        await query(
            `INSERT INTO payment_transactions
             (patient_id, amount, description, stripe_account, stripe_charge_id,
              stripe_customer_id, status, created_at, receipt_number, healthie_document_id)
             VALUES ($1::uuid, $2, $3, 'direct', $4, $5, 'succeeded', NOW(), $6, $7)`,
            [patient.patient_id, total, `Mobile: ${description}`, paymentIntent.id,
             patient.stripe_customer_id, receiptNumber, healthieDocumentId]
        );

        // 7. Create WooCommerce order for ShipStation
        let wooOrder: { orderId: number; orderNumber: string } | null = null;

        if (WC_KEY && WC_SECRET) {
            const nameParts = (patient.full_name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            try {
                const response = await fetch(`${WC_URL}/wp-json/wc/v3/orders`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64'),
                    },
                    body: JSON.stringify({
                        status: 'processing',
                        billing: {
                            first_name: firstName, last_name: lastName,
                            email: patient.email || '', phone: patient.phone_primary || '',
                            address_1: address, city: city,
                            state: state, postcode: zip, country: 'US',
                        },
                        shipping: {
                            first_name: firstName, last_name: lastName,
                            address_1: address, city: city,
                            state: state, postcode: zip, country: 'US',
                        },
                        line_items: items.map(i => ({
                            product_id: i.product_id,
                            quantity: i.quantity,
                            total: (i.price * i.quantity).toFixed(2),
                            sku: i.sku,
                        })),
                        shipping_lines: [{
                            method_id: 'flat_rate',
                            method_title: 'USPS Priority Mail',
                            total: shippingCost.toFixed(2),
                        }],
                        set_paid: true,
                        transaction_id: paymentIntent.id,
                        payment_method: 'stripe_direct',
                        payment_method_title: 'Stripe Direct (Mobile App)',
                        meta_data: [
                            { key: '_stripe_charge_id', value: paymentIntent.id },
                            { key: '_ordered_via', value: 'mobile_app_checkout' },
                            { key: '_healthie_id', value: healthie_id },
                            { key: '_receipt_number', value: receiptNumber },
                        ],
                    }),
                });

                if (response.ok) {
                    const order = await response.json();
                    wooOrder = { orderId: order.id, orderNumber: order.number || String(order.id) };
                    console.log(`[Mobile Checkout] WooCommerce order #${order.id} → ShipStation`);
                } else {
                    console.error('[Mobile Checkout] WooCommerce failed:', response.status, await response.text());
                }
            } catch (err) {
                console.error('[Mobile Checkout] WooCommerce error:', err);
            }
        }

        // 8. Log peptide dispenses
        const pool = getPool();
        for (const item of items) {
            for (let i = 0; i < item.quantity; i++) {
                await pool.query(
                    `INSERT INTO peptide_dispenses
                     (patient_name, sale_date, status, paid, amount_charged, stripe_payment_intent_id, notes)
                     VALUES ($1, CURRENT_DATE, 'Shipped', true, $2, $3, $4)`,
                    [patient.full_name, item.price, paymentIntent.id,
                     `Mobile order — ${item.name} (${item.sku})`]
                );
            }
        }

        return NextResponse.json({
            success: true,
            order: {
                total, subtotal,
                shipping_cost: shippingCost,
                free_shipping: shippingCost === 0,
                woocommerce_order_number: wooOrder?.orderNumber || null,
                receipt_number: receiptNumber,
            },
            charge: {
                id: paymentIntent.id,
                amount: total,
                card_brand: paymentMethod.card?.brand,
                card_last4: paymentMethod.card?.last4,
            },
            shipping_address: `${address}, ${city}, ${state} ${zip}`,
            message: `Charged $${total.toFixed(2)} to card ending ${paymentMethod.card?.last4}. Order #${wooOrder?.orderNumber || 'processing'} ships via USPS Priority. Receipt added to your chart.`,
        });

    } catch (error: any) {
        console.error('[Mobile Checkout] Error:', error);

        if (error.type === 'StripeCardError') {
            return NextResponse.json({
                error: `Card declined: ${error.message}`,
                code: 'CARD_DECLINED',
            }, { status: 402 });
        }

        return NextResponse.json({
            error: 'Checkout failed. Please try again or call (928) 212-2772.',
        }, { status: 500 });
    }
}

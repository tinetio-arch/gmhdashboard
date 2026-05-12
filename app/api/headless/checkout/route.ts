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
import { getPeptideDiscountForPatient, getRetailPricesBySku, applyDiscount } from '@/lib/peptideDiscount';
import { SUPPLY_KIT_SKU } from '@/lib/peptideCategories';
import { getPatientAccessStatus } from '@/lib/appAccessControl';
import Stripe from 'stripe';
import { reconcilePatientPayments } from '@/lib/payment-reconcile';

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

        // FIX(2026-04-22): Pre-compute idempotency key early so we can check for replays
        // BEFORE charging Stripe. The key is based on patient + cart hash + hour window.
        const crypto = require('crypto');
        const cartHash = crypto.createHash('md5')
            .update(items.map((i: CheckoutItem) => `${i.sku}:${i.quantity}`).sort().join(','))
            .digest('hex').slice(0, 8);
        const idempotencyKey = `mobile-${healthie_id}-${cartHash}-${new Date().toISOString().slice(0, 13)}`;

        // Idempotency replay guard — if this exact checkout already succeeded, return the prior result
        const [priorTxn] = await query<any>(
            `SELECT transaction_id, amount, stripe_charge_id, receipt_number, healthie_document_id
             FROM payment_transactions WHERE idempotency_key = $1 AND status = 'succeeded' LIMIT 1`,
            [idempotencyKey]
        );
        if (priorTxn) {
            console.log(`[Mobile Checkout] Idempotency replay: returning prior transaction ${priorTxn.transaction_id}`);
            return NextResponse.json({
                success: true,
                replayed: true,
                charge: { id: priorTxn.stripe_charge_id, amount: parseFloat(priorTxn.amount), status: 'succeeded' },
                receipt_number: priorTxn.receipt_number,
                message: 'This order was already processed.',
            });
        }

        // 1. Look up patient (include client_type_key for discount resolution)
        const [patient] = await query<any>(
            `SELECT patient_id, full_name, email, phone_primary,
                    address_line1, address_line2, city, state, postal_code,
                    healthie_client_id, stripe_customer_id,
                    client_type_key
             FROM patients WHERE healthie_client_id = $1
             LIMIT 1`,
            [healthie_id]
        );

        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        // FIX(2026-04-22): Block checkout for deactivated/revoked patients
        const accessCheck = await getPatientAccessStatus(patient.patient_id);
        if (accessCheck.status === 'revoked' || accessCheck.status === 'suspended') {
            return NextResponse.json({ error: 'Your account access has been restricted. Please contact the clinic.' }, { status: 403 });
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

        // 2. SERVER-SIDE price re-validation + discount (never trust client-sent price)
        //    Phase 3b hardening — the client can spoof item.price; we re-compute from DB.
        const skus = items.map(i => i.sku).filter(Boolean);
        const retailMap = await getRetailPricesBySku(skus);
        const unknownSkus = skus.filter(s => retailMap.get(s) == null);
        if (unknownSkus.length) {
            return NextResponse.json({
                error: `Unknown SKUs: ${unknownSkus.join(', ')}. Cart may be outdated — reload and try again.`,
                code: 'UNKNOWN_SKU',
            }, { status: 400 });
        }

        const discount = await getPeptideDiscountForPatient({
            healthie_client_id: patient.healthie_client_id,
            email: patient.email,
            client_type_key: patient.client_type_key
        });

        // Re-price every line from the DB retail, apply member discount.
        const pricedItems = items.map(i => {
            const retail = retailMap.get(i.sku) as number; // non-null checked above
            const unitPrice = applyDiscount(retail, discount.discountPct);
            return {
                ...i,
                retail_price: retail,
                unit_price: unitPrice, // authoritative price charged
            };
        });

        const subtotal = pricedItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
        const shippingCost = subtotal >= 400 ? 0 : 20;
        const total = Math.round((subtotal + shippingCost) * 100) / 100;
        const totalCents = Math.round(total * 100);
        const description = pricedItems.map(i => `${i.name} x${i.quantity}`).join(', ');

        // Audit: log discrepancy if client-sent price differs from server price (indicates stale app or tampering)
        for (const [idx, i] of pricedItems.entries()) {
            if (typeof items[idx].price === 'number' && Math.abs(items[idx].price - i.unit_price) > 0.01) {
                console.warn(`[Mobile Checkout] Price mismatch SKU ${i.sku}: client=${items[idx].price} server=${i.unit_price} (${discount.reason})`);
            }
        }

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
                discount: {
                    tier: discount.tier,
                    pct: discount.discountPct,
                    reason: discount.reason,
                },
                items: pricedItems.map(i => ({
                    name: i.name, sku: i.sku, qty: i.quantity,
                    retail_price: i.retail_price,
                    unit_price: i.unit_price,
                    savings_per_unit: Math.round((i.retail_price - i.unit_price) * 100) / 100,
                })),
            });
        }

        // 3b. Check if any items require staff approval (GLP/weight-management)
        // Weight-management SKUs that require staff approval before patient-app orders process.
        // This list matches the WC category assignment in scripts/wc-categorize-peptides.js.
        const WEIGHT_MANAGEMENT_SKUS = new Set([
            'YPB.200','YPB.201','YPB.202',  // GLP-1 Semaglutide
            'YPB.203','YPB.204','YPB.205','YPB.206','YPB.207','YPB.208',  // GLP-2 Tirzepatide
            'YPB.209','YPB.210','YPB.234','YPB.235','YPB.236','YPB.287',  // GLP-3 Retatrutide
            'YPB.239','YPB.240','YPB.241',  // Cagrilintide blends
            'YPB.242','YPB.247',  // 5-amino-1mq
            'YPB.243',  // SLU-PP-332
            'YPB.248',  // AOD9604
            'YPB.269',  // Mazdutide
            'YPB.278',  // Survodutide
        ]);
        const needsApproval = pricedItems.some(i => WEIGHT_MANAGEMENT_SKUS.has(i.sku));

        // If approval needed, save to pending_peptide_orders instead of charging
        if (needsApproval) {
            const [pendingOrder] = await query<{ id: string }>(
                `INSERT INTO pending_peptide_orders
                 (patient_id, healthie_client_id, patient_name, patient_email,
                  items, subtotal, shipping_cost, total,
                  discount_tier, discount_pct, shipping_address,
                  stripe_customer_id, stripe_payment_method_id)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 RETURNING id`,
                [
                    patient.patient_id, healthie_id, patient.full_name, patient.email,
                    JSON.stringify(pricedItems.map(i => ({
                        sku: i.sku, name: i.name, quantity: i.quantity,
                        unit_price: i.unit_price, retail_price: i.retail_price,
                    }))),
                    subtotal, shippingCost, total,
                    discount.tier, discount.discountPct,
                    JSON.stringify({ address_line1: address, city, state, postal_code: zip }),
                    patient.stripe_customer_id, paymentMethod.id,
                ]
            );

            console.log(`[Mobile Checkout] GLP order held for approval — pending_id=${pendingOrder.id} — ${patient.full_name} — $${total.toFixed(2)}`);

            return NextResponse.json({
                success: true,
                pending: true,
                pending_order_id: pendingOrder.id,
                message: 'Your order is being reviewed by our clinical team. You\'ll receive a notification once approved. This usually takes less than 24 hours.',
                order: {
                    total, subtotal,
                    shipping_cost: shippingCost,
                    free_shipping: shippingCost === 0,
                    woocommerce_order_number: null,
                    receipt_number: null,
                },
                charge: null,
                shipping_address: `${address}, ${city}, ${state} ${zip}`,
            });
        }

        // 4. Charge via Direct Stripe — shows as "NOWOptimal Service" on receipt
        // idempotencyKey computed at top of function (before replay guard)
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
        }, { idempotencyKey });

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
        // FIX(2026-04-22): Include idempotency_key + ON CONFLICT to prevent duplicate transaction rows
        // if the mobile app retries. Also enables the recovery endpoint to find this transaction.
        await query(
            `INSERT INTO payment_transactions
             (patient_id, amount, description, stripe_account, stripe_charge_id,
              stripe_customer_id, status, created_at, receipt_number, healthie_document_id, idempotency_key)
             VALUES ($1::uuid, $2, $3, 'direct', $4, $5, 'succeeded', NOW(), $6, $7, $8)
             ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
            [patient.patient_id, total, `Mobile: ${description}`, paymentIntent.id,
             patient.stripe_customer_id, receiptNumber, healthieDocumentId, idempotencyKey]
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
                        line_items: pricedItems.map(i => ({
                            product_id: i.product_id,
                            quantity: i.quantity,
                            total: (i.unit_price * i.quantity).toFixed(2),
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
                            { key: 'is_vat_exempt', value: 'no' },
                        ],
                    }),
                });

                if (response.ok) {
                    const order = await response.json();
                    wooOrder = { orderId: order.id, orderNumber: order.number || String(order.id) };
                    console.log(`[Mobile Checkout] WooCommerce order #${order.id} → ShipStation`);

                    // Trigger WC order confirmation emails (API-created orders don't auto-send)
                    try {
                        await fetch(
                            `${WC_URL}/wp-json/wc/v3/orders/${order.id}/notes?consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    note: `Order placed via NOW Optimal mobile app. Stripe charge: ${paymentIntent.id}`,
                                    customer_note: true,
                                }),
                            }
                        );
                    } catch { /* non-critical */ }
                } else {
                    console.error('[Mobile Checkout] WooCommerce failed:', response.status, await response.text());
                }
            } catch (err) {
                console.error('[Mobile Checkout] WooCommerce error:', err);
            }
        }

        // FIX(2026-04-28): Mobile checkout succeeded — clear any stale Unpaid alerts
        // for this patient on the iPad CEO panel. Non-blocking.
        try {
            const recon = await reconcilePatientPayments(patient.patient_id, { actorEmail: 'mobile:checkout' });
            if (recon.resolvedTransactions || recon.resolvedIssues) {
                console.log(`[Mobile Checkout] Auto-resolved ${recon.resolvedTransactions} txn(s) + ${recon.resolvedIssues} issue(s) for ${patient.full_name}`);
            }
        } catch (reconErr: any) {
            console.error('[Mobile Checkout] Auto-reconcile failed (non-blocking):', reconErr.message);
        }

        // FIX(2026-04-22): Store WC order ID in payment_transactions so refunds can cancel it.
        if (wooOrder?.orderId) {
            await query(
                `UPDATE payment_transactions SET woocommerce_order_id = $1
                 WHERE stripe_charge_id = $2 AND woocommerce_order_id IS NULL`,
                [wooOrder.orderId, paymentIntent.id]
            ).catch((err: any) => console.error('[Mobile Checkout] Failed to store WC order ID:', err.message));
        }

        // 8. Log peptide dispenses (use server-computed unit_price, not client-sent)
        const pool = getPool();
        for (const item of pricedItems) {
            for (let i = 0; i < item.quantity; i++) {
                await pool.query(
                    `INSERT INTO peptide_dispenses
                     (patient_name, sale_date, status, paid, amount_charged, stripe_payment_intent_id, notes)
                     VALUES ($1, CURRENT_DATE, 'Shipped', true, $2, $3, $4)`,
                    [patient.full_name, item.unit_price, paymentIntent.id,
                     `Mobile order — ${item.name} (${item.sku}) — ${discount.tier} tier (${Math.round(discount.discountPct*100)}% off)`]
                );
            }
        }

        // 9. If cart contains Supply Kit, create staff task for assembly
        if (pricedItems.some(i => i.sku === SUPPLY_KIT_SKU)) {
            try {
                await query(
                    `INSERT INTO staff_tasks (title, description, priority, assigned_to, assigned_to_name, created_by, created_by_name)
                     VALUES ($1, $2, 'high', 'all', 'All Staff', 'system', 'Auto (Mobile Checkout)')`,
                    [
                        `Assemble Supply Kit for ${patient.full_name}`,
                        `Ship to: ${address}, ${city}, ${state} ${zip}\nOrder: ${wooOrder?.orderNumber || 'pending'}\nStripe: ${paymentIntent.id}`,
                    ]
                );
                console.log(`[Mobile Checkout] Staff task created for Supply Kit — ${patient.full_name}`);
            } catch (taskErr) {
                console.error('[Mobile Checkout] Supply Kit task creation failed:', taskErr);
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

/**
 * iPad Ship-to-Patient API
 *
 * Charges the patient's Direct Stripe card, creates a WooCommerce order
 * in the ABX TAC store (for ShipStation fulfillment), and logs the dispense.
 *
 * Flow:
 *   1. iPad staff selects patient + products
 *   2. This endpoint charges Direct Stripe (2.9% fee, not high-risk)
 *   3. Creates WooCommerce order with patient's shipping address
 *   4. ShipStation auto-syncs the order and ships it
 *   5. Logs peptide dispense in GMH Dashboard
 *
 * POST /api/ipad/billing/ship-order
 * Body: {
 *   patient_id: string (UUID),
 *   items: Array<{ sku: string, name: string, price: number, quantity: number }>,
 *   shipping_method?: 'priority' | 'express'  (default: priority)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import Stripe from 'stripe';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

export const maxDuration = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10' as any,
});

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

interface ShipOrderItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

/**
 * Create a WooCommerce order via REST API
 */
async function createWooCommerceOrder(
  patient: { firstName: string; lastName: string; email: string; phone: string; address: string; city: string; state: string; zip: string },
  items: ShipOrderItem[],
  shippingMethod: string,
  stripeChargeId: string,
): Promise<{ orderId: number; orderNumber: string } | null> {
  if (!WC_KEY || !WC_SECRET) {
    console.warn('[Ship Order] WooCommerce credentials not configured — skipping order creation');
    return null;
  }

  const lineItems = items.map(item => ({
    name: item.name,
    quantity: item.quantity,
    total: (item.price * item.quantity).toFixed(2),
    sku: item.sku,
  }));

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingCost = subtotal >= 400 ? 0 : 20;

  const orderPayload = {
    status: 'processing',
    billing: {
      first_name: patient.firstName,
      last_name: patient.lastName,
      email: patient.email,
      phone: patient.phone,
      address_1: patient.address,
      city: patient.city,
      state: patient.state,
      postcode: patient.zip,
      country: 'US',
    },
    shipping: {
      first_name: patient.firstName,
      last_name: patient.lastName,
      address_1: patient.address,
      city: patient.city,
      state: patient.state,
      postcode: patient.zip,
      country: 'US',
    },
    line_items: lineItems,
    shipping_lines: [{
      method_id: 'flat_rate',
      method_title: 'USPS Priority Mail',
      total: shippingCost.toFixed(2),
    }],
    set_paid: true,
    transaction_id: stripeChargeId,
    payment_method: 'stripe_direct',
    payment_method_title: 'Stripe (Provider Billing)',
    meta_data: [
      { key: '_stripe_charge_id', value: stripeChargeId },
      { key: '_ordered_via', value: 'ipad_ship_to_patient' },
    ],
  };

  try {
    // FIX(2026-04-08): Single headers object — was duplicated causing fragile override
    const response = await fetch(`${WC_URL}/wp-json/wc/v3/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64'),
      },
      body: JSON.stringify(orderPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Ship Order] WooCommerce order creation failed:', response.status, errText);
      return null;
    }

    const order = await response.json();
    console.log(`[Ship Order] WooCommerce order created: #${order.id} (${order.number})`);
    return { orderId: order.id, orderNumber: order.number || String(order.id) };
  } catch (err) {
    console.error('[Ship Order] WooCommerce API error:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { patient_id, items, shipping_method = 'priority' } = body as {
      patient_id: string;
      items: ShipOrderItem[];
      shipping_method?: 'priority' | 'express';
    };

    if (!patient_id || !items?.length) {
      return NextResponse.json({ error: 'patient_id and items are required' }, { status: 400 });
    }

    // FIX(2026-04-07): Resolve patient_id — may be UUID or Healthie numeric ID
    const resolvedId = await resolvePatientId(patient_id);
    if (!resolvedId) {
      return NextResponse.json({ error: 'Patient not found for ID: ' + patient_id }, { status: 404 });
    }

    // Step 1: Get patient details
    // FIX(2026-04-08): Correct column names — address_line1, postal_code (not address, zip)
    const [patient] = await query<any>(
      `SELECT patient_id, full_name, email, phone_primary,
              address_line1, address_line2, city, state, postal_code,
              stripe_customer_id, client_type_key, healthie_client_id
       FROM patients WHERE patient_id = $1`,
      [resolvedId]
    );

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    if (!patient.stripe_customer_id) {
      return NextResponse.json({
        error: 'Patient has no card on file. Add a card via the Billing tab first.'
      }, { status: 400 });
    }

    // Allow override shipping address from request body (staff can edit on iPad)
    const shipAddress = body.shipping_address || null;
    const shippingAddr = shipAddress?.address || patient.address_line1;
    const shippingCity = shipAddress?.city || patient.city;
    const shippingState = shipAddress?.state || patient.state;
    const shippingZip = shipAddress?.zip || patient.postal_code;

    if (!shippingAddr || !shippingCity || !shippingState || !shippingZip) {
      return NextResponse.json({
        error: 'Patient shipping address is incomplete. Update demographics or provide a shipping address.'
      }, { status: 400 });
    }

    // Step 2: Calculate total — $20 flat rate shipping, free over $400
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shippingCost = subtotal >= 400 ? 0 : 20;
    const total = subtotal + shippingCost;
    const totalCents = Math.round(total * 100);

    // Step 3: Get default payment method
    const paymentMethods = await stripe.paymentMethods.list({
      customer: patient.stripe_customer_id,
      type: 'card',
    });

    if (!paymentMethods.data.length) {
      return NextResponse.json({ error: 'No payment method on file' }, { status: 400 });
    }

    const paymentMethod = paymentMethods.data[0];

    // Step 4: Charge via Direct Stripe
    const description = items.map(i => `${i.name} x${i.quantity}`).join(', ');

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      customer: patient.stripe_customer_id,
      payment_method: paymentMethod.id,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'NOWOptimal Service', // Sanitized for Stripe receipt
      metadata: {
        patient_id: resolvedId,
        patient_name: patient.full_name,
        source: 'ipad_ship_to_patient',
        items: description,
      },
    });

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({
        error: `Payment failed: ${paymentIntent.status}`,
        charge_id: paymentIntent.id,
      }, { status: 402 });
    }

    console.log(`[Ship Order] Stripe charge succeeded: ${paymentIntent.id} for $${total.toFixed(2)}`);

    // Step 5: Upload itemized receipt to patient's Healthie chart
    const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    let healthieDocumentId: string | null = null;

    if (patient.healthie_client_id || resolvedId) {
      try {
        const { uploadSimpleReceiptToHealthie } = await import('@/lib/simpleReceiptUpload');
        // Look up Healthie client ID
        const [hc] = await query<{ healthie_client_id: string }>(
          'SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1',
          [resolvedId]
        );
        const healthieClientId = hc?.healthie_client_id;
        if (healthieClientId) {
          healthieDocumentId = await uploadSimpleReceiptToHealthie({
            healthieClientId,
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
            console.log(`[Ship Order] Receipt ${receiptNumber} uploaded to Healthie chart`);
          }
        }
      } catch (receiptErr) {
        console.error('[Ship Order] Receipt upload failed (non-blocking):', receiptErr);
      }
    }

    // Step 5b: Log payment transaction
    await query(
      `INSERT INTO payment_transactions
       (patient_id, amount, description, stripe_account, stripe_charge_id, stripe_customer_id, status, created_at, receipt_number, healthie_document_id)
       VALUES ($1, $2, $3, 'direct', $4, $5, 'succeeded', NOW(), $6, $7)`,
      [resolvedId, total, `Ship-to-patient: ${description}`, paymentIntent.id, patient.stripe_customer_id, receiptNumber, healthieDocumentId]
    );

    // Step 6: Create WooCommerce order (for ShipStation pickup)
    const nameParts = (patient.full_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const wooOrder = await createWooCommerceOrder(
      {
        firstName,
        lastName,
        email: patient.email || '',
        phone: patient.phone_primary || '',
        address: shippingAddr,
        city: shippingCity,
        state: shippingState,
        zip: shippingZip,
      },
      items,
      shipping_method,
      paymentIntent.id,
    );

    // Step 7: Create peptide dispenses
    const dispenseIds: number[] = [];
    const pool = getPool();
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        const result = await pool.query(
          `INSERT INTO peptide_dispenses
           (patient_name, sale_date, status, paid, amount_charged, stripe_payment_intent_id, notes)
           VALUES ($1, CURRENT_DATE, 'Shipped', true, $2, $3, $4)
           RETURNING dispense_id`,
          [patient.full_name, item.price, paymentIntent.id, `Shipped via ABX TAC - ${item.name} (${item.sku})`]
        );
        if (result.rows[0]) {
          dispenseIds.push(result.rows[0].dispense_id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      charge: {
        id: paymentIntent.id,
        amount: total,
        status: 'succeeded',
        card: {
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
        },
      },
      woocommerce_order: wooOrder ? {
        id: wooOrder.orderId,
        number: wooOrder.orderNumber,
      } : null,
      shipping: {
        method: shipping_method,
        cost: shippingCost,
        free: shippingCost === 0,
        address: `${shippingAddr}, ${shippingCity}, ${shippingState} ${shippingZip}`,
      },
      dispense_ids: dispenseIds,
      message: `Charged $${total.toFixed(2)} via Stripe. ${wooOrder ? `WooCommerce order #${wooOrder.orderNumber} created for ShipStation.` : 'WooCommerce order pending (credentials not configured).'}`,
    });

  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Ship Order] Error:', error);

    if (error.type === 'StripeCardError') {
      return NextResponse.json({
        error: `Card declined: ${error.message}`,
      }, { status: 402 });
    }

    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

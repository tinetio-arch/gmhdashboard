/**
 * iPad Company-Paid Order API
 *
 * Creates a WooCommerce order on abxtac.com for the patient WITHOUT charging
 * a card. ABX TAC (drop-ship vendor) invoices the company separately on
 * wholesale/net-terms. The patient sees no price — WP-side filter on abxtac.com
 * suppresses customer order emails when `_suppress_wc_customer_emails: yes` is
 * set on the order. ShipStation still sends shipping/tracking notifications.
 *
 * Side effects:
 *   1. Creates a WooCommerce order (ships to patient's home address).
 *   2. Generates an itemized PDF receipt and uploads to the patient's Healthie
 *      chart with `share_with_rel: false` — staff/CEO can see it, patient cannot.
 *   3. Logs a payment_transactions row with charged_to='company',
 *      stripe_account='company', stripe_charge_id=NULL. This row is what makes
 *      the receipt show up in the CEO dashboard "Recent Receipts" list.
 *   4. Logs peptide dispenses with `[COMPANY-PAID]` notes prefix.
 *
 * POST /api/ipad/billing/company-order
 * Body: {
 *   patient_id: string (UUID),
 *   items: Array<{ sku: string, name: string, price: number, quantity: number }>,
 *   shipping_method?: 'priority' | 'express',
 *   shipping_address?: { address, city, state, zip },
 *   idempotency_key?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';
import { SUPPLY_KIT_SKU } from '@/lib/peptideCategories';

export const maxDuration = 30;

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

interface CompanyOrderItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

async function createWooCommerceCompanyOrder(
  patient: { firstName: string; lastName: string; email: string; phone: string; address: string; city: string; state: string; zip: string },
  items: CompanyOrderItem[],
): Promise<{ orderId: number; orderNumber: string } | null> {
  if (!WC_KEY || !WC_SECRET) {
    console.warn('[Company Order] WooCommerce credentials not configured — cannot create order');
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
    payment_method: 'company_account',
    payment_method_title: 'Provider Account (Wholesale)',
    meta_data: [
      { key: '_ordered_via', value: 'ipad_company_paid' },
      { key: '_suppress_wc_customer_emails', value: 'yes' },
      { key: '_company_paid', value: 'yes' },
    ],
  };

  try {
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
      console.error('[Company Order] WooCommerce order creation failed:', response.status, errText);
      return null;
    }

    const order = await response.json();
    console.log(`[Company Order] WooCommerce order created: #${order.id} (${order.number})`);
    return { orderId: order.id, orderNumber: order.number || String(order.id) };
  } catch (err) {
    console.error('[Company Order] WooCommerce API error:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'admin');
    const body = await request.json();
    const { patient_id, items, shipping_method = 'priority', idempotency_key } = body as {
      patient_id: string;
      items: CompanyOrderItem[];
      shipping_method?: 'priority' | 'express';
      idempotency_key?: string;
    };

    if (!patient_id || !items?.length) {
      return NextResponse.json({ error: 'patient_id and items are required' }, { status: 400 });
    }

    if (idempotency_key) {
      const [prior] = await query<any>(
        `SELECT transaction_id, amount, woocommerce_order_id, status, receipt_number, healthie_document_id
         FROM payment_transactions WHERE idempotency_key = $1 LIMIT 1`,
        [idempotency_key]
      );
      if (prior && prior.status === 'succeeded') {
        console.log(`[Company Order] Idempotency replay: returning prior transaction ${prior.transaction_id} for key ${idempotency_key}`);
        return NextResponse.json({
          success: true,
          replayed: true,
          woocommerce_order: prior.woocommerce_order_id ? { id: prior.woocommerce_order_id, number: String(prior.woocommerce_order_id) } : null,
          shipping: null,
          dispense_ids: [],
          message: 'This order was already processed (idempotent replay).',
        });
      }
    }

    const resolvedId = await resolvePatientId(patient_id);
    if (!resolvedId) {
      return NextResponse.json({ error: 'Patient not found for ID: ' + patient_id }, { status: 404 });
    }

    const [patient] = await query<any>(
      `SELECT patient_id, full_name, email, phone_primary,
              address_line1, address_line2, city, state, postal_code,
              healthie_client_id
       FROM patients WHERE patient_id = $1`,
      [resolvedId]
    );

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

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

    // Use the prices the iPad already calculated via /api/ipad/billing/woo-products
    // (which applies admin / at-cost / tier logic uniformly across the iPad app).
    // The company-purchased module is not a separate pricing system.
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shippingCost = subtotal >= 400 ? 0 : 20;
    const total = subtotal + shippingCost;
    const description = items.map(i => `${i.name} x${i.quantity}`).join(', ');

    // Create the WooCommerce order first — that's the only externally-visible action.
    // If it fails, we abort before writing the payment_transactions row so we don't
    // leave a phantom receipt with no corresponding shipment.
    const nameParts = (patient.full_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const wooOrder = await createWooCommerceCompanyOrder(
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
    );

    if (!wooOrder) {
      return NextResponse.json({
        error: 'Failed to create WooCommerce order. Order was NOT placed and patient was NOT notified. Check ABX TAC credentials and try again.',
      }, { status: 502 });
    }

    // Upload internal-only receipt (full price detail; not shared with patient)
    const receiptNumber = `CMP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    let healthieDocumentId: string | null = null;

    try {
      const { uploadSimpleReceiptToHealthie } = await import('@/lib/simpleReceiptUpload');
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
          description: `Peptide Order (Company-Paid): ${description}`,
          amount: total,
          paymentMethod: 'Provider Account (no patient charge)',
          clinicName: 'NOW Optimal Health',
          providerName: 'NOW Optimal Staff',
          isMensHealth: false,
          internalOnly: true,
        });
        if (healthieDocumentId) {
          console.log(`[Company Order] Internal receipt ${receiptNumber} uploaded to Healthie chart (not visible to patient)`);
        }
      } else {
        console.warn(`[Company Order] No Healthie client for patient ${resolvedId} — skipping chart receipt`);
      }
    } catch (receiptErr) {
      console.error('[Company Order] Receipt upload failed (non-blocking):', receiptErr);
    }

    // Record the transaction so it surfaces in CEO Recent Receipts.
    // No Stripe fields populated — this is informational only.
    await query(
      `INSERT INTO payment_transactions
       (patient_id, amount, description, stripe_account, charged_to,
        status, created_at, receipt_number, healthie_document_id,
        woocommerce_order_id, idempotency_key)
       VALUES ($1, $2, $3, 'company', 'company', 'succeeded', NOW(), $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        resolvedId,
        total,
        `[COMPANY-PAID] ${description}`,
        receiptNumber,
        healthieDocumentId,
        wooOrder.orderId,
        idempotency_key || null,
      ]
    );

    // Clear the patient's billing cart so the items don't linger after the order is placed
    try {
      await query(
        'DELETE FROM patient_billing_cart WHERE patient_id = $1 OR patient_id = $2',
        [resolvedId, patient_id]
      );
    } catch (cartClearErr) {
      console.error('[Company Order] Failed to clear billing cart (non-blocking):', cartClearErr);
    }

    // Log clinical dispense records — same as patient ship-order flow
    const dispenseIds: string[] = [];
    const pool = getPool();
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        const result = await pool.query<{ sale_id: string }>(
          `INSERT INTO peptide_dispenses
           (patient_name, sale_date, status, paid, amount_charged, notes)
           VALUES ($1, CURRENT_DATE, 'Shipped', true, $2, $3)
           RETURNING sale_id`,
          [
            patient.full_name,
            item.price,
            `[COMPANY-PAID] Shipped via ABX TAC - ${item.name} (${item.sku}) - WC order #${wooOrder.orderNumber}`,
          ]
        );
        if (result.rows[0]) dispenseIds.push(result.rows[0].sale_id);
      }
    }

    // Supply Kit assembly task — same logic as patient ship-order
    if (items.some(i => i.sku === SUPPLY_KIT_SKU)) {
      try {
        const addr = patient.address_line1 ? `${patient.address_line1}, ${patient.city}, ${patient.state} ${patient.postal_code}` : 'See patient chart';
        await query(
          `INSERT INTO staff_tasks (title, description, priority, assigned_to, assigned_to_name, created_by, created_by_name)
           VALUES ($1, $2, 'high', 'all', 'All Staff', $3, $4)`,
          [
            `Assemble Supply Kit for ${patient.full_name}`,
            `Ship to: ${addr}\nOrder: ${wooOrder.orderNumber} (Company-Paid)`,
            (user as any).email || 'staff',
            (user as any).display_name || 'iPad Staff',
          ]
        );
      } catch (taskErr) {
        console.error('[Company Order] Supply Kit task creation failed:', taskErr);
      }
    }

    return NextResponse.json({
      success: true,
      company_paid: true,
      woocommerce_order: { id: wooOrder.orderId, number: wooOrder.orderNumber },
      shipping: {
        method: shipping_method,
        cost: shippingCost,
        free: shippingCost === 0,
        address: `${shippingAddr}, ${shippingCity}, ${shippingState} ${shippingZip}`,
      },
      receipt: {
        number: receiptNumber,
        healthie_document_id: healthieDocumentId,
        amount: total,
        internal_only: true,
      },
      dispense_ids: dispenseIds,
      message: `Company-paid order #${wooOrder.orderNumber} placed for $${total.toFixed(2)}. Patient was NOT charged. ABX TAC will invoice separately.`,
    });

  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error?.status === 403 || error?.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin role required for company-paid orders' }, { status: 403 });
    }
    console.error('[Company Order] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

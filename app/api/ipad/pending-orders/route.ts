/**
 * Pending Peptide Orders — Staff Approval API
 *
 * Patient-app orders containing weight-management (GLP) products
 * are held for staff approval before charging.
 *
 * GET  — List pending orders (staff-authenticated, read role)
 * POST — Resolve a pending order with partial approval (staff-authenticated, write role)
 *
 * Partial approval: staff selects which items to approve/deny individually.
 * Only approved items are charged + shipped. Denied items are excluded.
 * Patient is notified of both approved and denied items.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import { sendPushMessages, loadTokensForPatient } from '@/lib/expoPush';
import { SUPPLY_KIT_SKU } from '@/lib/peptideCategories';
import { autoAddPeptideToStackBySku } from '@/lib/stackAutoAdd';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10' as any,
});

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

interface PendingItem {
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  retail_price?: number;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');
    const status = request.nextUrl.searchParams.get('status') || 'pending';

    const orders = await query<any>(
      `SELECT * FROM pending_peptide_orders
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [status]
    );

    return NextResponse.json({ success: true, orders });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Pending Orders] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

/**
 * POST — Resolve a pending order
 *
 * Body options:
 *   { order_id, action: 'deny', denial_reason? }           — deny entire order
 *   { order_id, action: 'approve' }                        — approve entire order
 *   { order_id, action: 'resolve', approved_skus: [...], denial_reason? }
 *       — partial: approved_skus are charged+shipped, everything else denied
 */
export async function POST(request: NextRequest) {
  let claimedOrderId: string | null = null;
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { order_id, action, approved_skus, denial_reason } = body as {
      order_id: string;
      action: 'approve' | 'deny' | 'resolve';
      approved_skus?: string[];
      denial_reason?: string;
    };

    if (!order_id || !action) {
      return NextResponse.json({ error: 'order_id and action required' }, { status: 400 });
    }

    const staffEmail = (user as any).email || 'staff';

    // === DENY ALL ===
    if (action === 'deny') {
      const [denied] = await query<any>(
        `UPDATE pending_peptide_orders
         SET status = 'denied', denial_reason = $1, approved_by = $2, resolved_at = NOW()
         WHERE id = $3 AND status = 'pending'
         RETURNING *`,
        [denial_reason || 'Staff denied', staffEmail, order_id]
      );

      if (!denied) {
        return NextResponse.json({ error: 'Order not found or already resolved' }, { status: 404 });
      }

      await sendPatientNotification(denied.healthie_client_id, order_id,
        'Order Update',
        'Your peptide order was not approved. Please call (928) 212-2772 for details.',
        'pending_order_denied'
      );

      console.log(`[Pending Orders] DENIED order ${order_id} by ${staffEmail}: ${denial_reason || 'no reason'}`);
      return NextResponse.json({ success: true, status: 'denied' });
    }

    // === APPROVE ALL or PARTIAL RESOLVE ===

    // Atomic claim: pending → processing
    const [order] = await query<any>(
      `UPDATE pending_peptide_orders
       SET status = 'processing', approved_by = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [staffEmail, order_id]
    );

    if (!order) {
      return NextResponse.json({ error: 'Order not found or already resolved' }, { status: 404 });
    }
    claimedOrderId = order_id;

    const allItems = (order.items || []) as PendingItem[];

    // Determine which items are approved vs denied
    let approvedItems: PendingItem[];
    let deniedItems: PendingItem[];

    if (action === 'resolve' && Array.isArray(approved_skus)) {
      // Partial approval: only items in approved_skus list
      const approvedSet = new Set(approved_skus);
      approvedItems = allItems.filter(i => approvedSet.has(i.sku));
      deniedItems = allItems.filter(i => !approvedSet.has(i.sku));
    } else {
      // Full approval (action === 'approve')
      approvedItems = allItems;
      deniedItems = [];
    }

    // Edge case: everything was denied via resolve (all unchecked)
    if (approvedItems.length === 0) {
      await query(
        `UPDATE pending_peptide_orders
         SET status = 'denied', denial_reason = $1, approved_by = $2, resolved_at = NOW()
         WHERE id = $3`,
        [denial_reason || 'All items denied by staff', staffEmail, order_id]
      );
      claimedOrderId = null;

      await sendPatientNotification(order.healthie_client_id, order_id,
        'Order Update',
        'Your peptide order was not approved. Please call (928) 212-2772 for details.',
        'pending_order_denied'
      );

      console.log(`[Pending Orders] ALL ITEMS DENIED for order ${order_id} by ${staffEmail}`);
      return NextResponse.json({ success: true, status: 'denied' });
    }

    // Validate Stripe
    if (!order.stripe_customer_id) {
      await rollbackToPending(order_id);
      return NextResponse.json({ error: 'No Stripe customer ID on order' }, { status: 400 });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: order.stripe_customer_id,
      type: 'card',
    });

    if (!paymentMethods.data.length) {
      await rollbackToPending(order_id);
      return NextResponse.json({ error: 'Patient has no card on file' }, { status: 400 });
    }

    const paymentMethod = order.stripe_payment_method_id
      ? paymentMethods.data.find(pm => pm.id === order.stripe_payment_method_id) || paymentMethods.data[0]
      : paymentMethods.data[0];

    // Recalculate totals based on approved items only
    const approvedSubtotal = approvedItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    const shippingCost = approvedSubtotal >= 400 ? 0 : 20;
    const approvedTotal = Math.round((approvedSubtotal + shippingCost) * 100) / 100;
    const totalCents = Math.round(approvedTotal * 100);
    const approvedDesc = approvedItems.map(i => `${i.name} x${i.quantity}`).join(', ');
    const deniedDesc = deniedItems.map(i => `${i.name} x${i.quantity}`).join(', ');

    // Charge Stripe (approved items only)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      customer: order.stripe_customer_id,
      payment_method: paymentMethod.id,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'NOWOptimal Service',
      metadata: {
        patient_id: order.patient_id,
        patient_name: order.patient_name,
        source: 'pending_order_approved',
        pending_order_id: order_id,
        items: approvedDesc,
        denied_items: deniedDesc || 'none',
      },
    });

    if (paymentIntent.status !== 'succeeded') {
      await rollbackToPending(order_id);
      return NextResponse.json({
        error: `Payment failed: ${paymentIntent.status}`,
        code: 'PAYMENT_FAILED',
      }, { status: 402 });
    }

    console.log(`[Pending Orders] Stripe charge ${paymentIntent.id} — $${approvedTotal.toFixed(2)} — ${order.patient_name}`);

    // Upload receipt to Healthie (approved items only)
    const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    let healthieDocumentId: string | null = null;

    if (order.healthie_client_id) {
      try {
        const { uploadSimpleReceiptToHealthie } = await import('@/lib/simpleReceiptUpload');
        if (typeof uploadSimpleReceiptToHealthie === 'function') {
          healthieDocumentId = await uploadSimpleReceiptToHealthie({
            healthieClientId: order.healthie_client_id,
            receiptNumber,
            date: new Date(),
            patientName: order.patient_name,
            description: `Peptide Shipment: ${approvedDesc}`,
            amount: approvedTotal,
            paymentMethod: `Card ending ${paymentMethod.card?.last4 || '****'}`,
            clinicName: 'NOW Optimal Health',
            providerName: 'NOW Optimal Staff',
            isMensHealth: false,
          });
        }
      } catch (receiptErr) {
        console.error('[Pending Orders] Receipt upload failed:', receiptErr);
      }
    }

    // Log payment transaction
    await query(
      `INSERT INTO payment_transactions
       (patient_id, amount, description, stripe_account, stripe_charge_id,
        stripe_customer_id, status, created_at, receipt_number, healthie_document_id)
       VALUES ($1::uuid, $2, $3, 'direct', $4, $5, 'succeeded', NOW(), $6, $7)`,
      [order.patient_id, approvedTotal, `Approved: ${approvedDesc}${deniedItems.length > 0 ? ` | Denied: ${deniedDesc}` : ''}`,
       paymentIntent.id, order.stripe_customer_id, receiptNumber, healthieDocumentId]
    );

    // Create WooCommerce order for ShipStation (approved items only)
    let wooOrderId: number | null = null;
    if (WC_KEY && WC_SECRET) {
      const shippingAddr = order.shipping_address || {};
      const nameParts = (order.patient_name || '').split(' ');
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
              email: order.patient_email || '',
              address_1: shippingAddr.address_line1 || '', city: shippingAddr.city || '',
              state: shippingAddr.state || '', postcode: shippingAddr.postal_code || '', country: 'US',
            },
            shipping: {
              first_name: firstName, last_name: lastName,
              address_1: shippingAddr.address_line1 || '', city: shippingAddr.city || '',
              state: shippingAddr.state || '', postcode: shippingAddr.postal_code || '', country: 'US',
            },
            line_items: approvedItems.map(i => ({
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
            payment_method_title: 'Stripe Direct (Approved Pending Order)',
            meta_data: [
              { key: '_stripe_charge_id', value: paymentIntent.id },
              { key: '_ordered_via', value: 'pending_order_approved' },
              { key: '_healthie_id', value: order.healthie_client_id || '' },
              { key: '_receipt_number', value: receiptNumber },
            ],
          }),
        });

        if (response.ok) {
          const wcOrder = await response.json();
          wooOrderId = wcOrder.id;
          console.log(`[Pending Orders] WooCommerce order #${wcOrder.id} created`);
        } else {
          console.error('[Pending Orders] WC order failed:', response.status);
        }
      } catch (wcErr) {
        console.error('[Pending Orders] WC order error:', wcErr);
      }
    }

    // FIX(2026-04-22): Store WC order ID in payment_transactions so refunds can cancel it.
    if (wooOrderId) {
        await query(
            `UPDATE payment_transactions SET woocommerce_order_id = $1
             WHERE stripe_charge_id = $2 AND woocommerce_order_id IS NULL`,
            [wooOrderId, paymentIntent.id]
        ).catch((err: any) => console.error('[Pending Orders] Failed to store WC order ID:', err.message));
    }

    // Log peptide dispenses (approved items only)
    const pool = getPool();
    for (const item of approvedItems) {
      for (let i = 0; i < item.quantity; i++) {
        await pool.query(
          `INSERT INTO peptide_dispenses
           (patient_name, sale_date, status, paid, amount_charged, stripe_payment_intent_id, notes, channel)
           VALUES ($1, CURRENT_DATE, 'Shipped', true, $2, $3, $4, 'woo')`,
          [order.patient_name, item.unit_price, paymentIntent.id,
           `Approved pending order — ${item.name} (${item.sku}) — ${order.discount_tier || 'retail'} tier`]
        );
      }

      // Auto-add the approved peptide to the patient's Stack at handbook
      // lowest dose so it's visible + usable immediately on approval.
      // Idempotent — won't double-add if the patient already has it.
      // Non-blocking: a Stack write failure must not unwind the approval.
      try {
        const r = await autoAddPeptideToStackBySku({
          patient_id: order.patient_id,
          sku: item.sku,
          source_order_id: paymentIntent.id,
          triggered_by_user_id: null,
          triggered_by_name: `auto-add-on-approval (${staffEmail || 'staff'})`
        });
        if (r) {
          console.log(`[Pending Orders] Stack ${r.created ? 'created' : r.reactivated ? 'reactivated' : 'reused'} for ${item.sku} → ${r.stack_id} (${r.status})`);
        }
      } catch (stackErr: any) {
        console.error('[Pending Orders] autoAddPeptideToStack failed (non-blocking):', stackErr?.message);
      }
    }

    // Supply Kit task (if in approved items)
    // FIX(2026-05-26): Include peptides ordered so staff pack the right amount of supplies (needles/syringes/swabs).
    if (approvedItems.some(i => i.sku === SUPPLY_KIT_SKU)) {
      try {
        const shippingAddr = order.shipping_address || {};
        const addr = [shippingAddr.address_line1, shippingAddr.city, shippingAddr.state, shippingAddr.postal_code].filter(Boolean).join(', ');
        const otherItems = approvedItems.filter(i => i.sku !== SUPPLY_KIT_SKU);
        const itemsList = otherItems.length
          ? '\n\nPeptides in this order:\n' + otherItems.map(i => `  • ${i.sku} — ${i.name} ×${i.quantity}`).join('\n')
          : '\n\nSupply Kit only — no other items.';
        await query(
          `INSERT INTO staff_tasks (title, description, priority, assigned_to, assigned_to_name, created_by, created_by_name)
           VALUES ($1, $2, 'high', 'all', 'All Staff', $3, $4)`,
          [
            `Assemble Supply Kit for ${order.patient_name}`,
            `Ship to: ${addr || 'See patient chart'}\nWC Order: ${wooOrderId || 'pending'}\nStripe: ${paymentIntent.id}${itemsList}`,
            staffEmail,
            'iPad Staff (Approved Pending)',
          ]
        );
      } catch (taskErr) {
        console.error('[Pending Orders] Supply Kit task creation failed:', taskErr);
      }
    }

    // Update pending order record
    // Full approval: leave items array as-is (no redundant copy)
    // Partial approval: store approved/denied/original split for audit trail
    const resolvedStatus = deniedItems.length > 0 ? 'partial' : 'approved';
    const updatedItems = deniedItems.length > 0
      ? JSON.stringify({ approved: approvedItems, denied: deniedItems, original: allItems })
      : undefined; // leave items column unchanged for full approvals

    const updateSql = deniedItems.length > 0
      ? `UPDATE pending_peptide_orders
         SET status = $1, approved_by = $2, stripe_payment_intent_id = $3,
             woo_order_id = $4, receipt_number = $5, resolved_at = NOW(),
             items = $6, denial_reason = $7
         WHERE id = $8`
      : `UPDATE pending_peptide_orders
         SET status = $1, approved_by = $2, stripe_payment_intent_id = $3,
             woo_order_id = $4, receipt_number = $5, resolved_at = NOW()
         WHERE id = $6`;

    const updateParams = deniedItems.length > 0
      ? [resolvedStatus, staffEmail, paymentIntent.id, wooOrderId, receiptNumber,
         updatedItems, `Denied: ${deniedDesc}. ${denial_reason || ''}`.trim(), order_id]
      : [resolvedStatus, staffEmail, paymentIntent.id, wooOrderId, receiptNumber, order_id];

    await query(updateSql, updateParams);
    claimedOrderId = null; // Resolved — no rollback needed

    // Push notification to patient
    if (order.healthie_client_id) {
      let pushTitle: string;
      let pushBody: string;

      if (deniedItems.length === 0) {
        pushTitle = 'Order Approved!';
        pushBody = `Your peptide order has been approved! Card charged $${approvedTotal.toFixed(2)}. Shipping soon.`;
      } else {
        pushTitle = 'Order Partially Approved';
        const approvedNames = approvedItems.map(i => i.name).join(', ');
        const deniedNames = deniedItems.map(i => i.name).join(', ');
        pushBody = `Approved & shipping: ${approvedNames}. Not approved: ${deniedNames}. Charged $${approvedTotal.toFixed(2)}. Call (928) 212-2772 with questions.`;
      }

      await sendPatientNotification(order.healthie_client_id, order_id, pushTitle, pushBody,
        deniedItems.length > 0 ? 'pending_order_partial' : 'pending_order_approved'
      );
    }

    console.log(`[Pending Orders] ${resolvedStatus.toUpperCase()} order ${order_id} by ${staffEmail} — $${approvedTotal.toFixed(2)} (${approvedItems.length} approved, ${deniedItems.length} denied)`);

    return NextResponse.json({
      success: true,
      status: resolvedStatus,
      approved_items: approvedItems.map(i => i.name),
      denied_items: deniedItems.map(i => i.name),
      charge: {
        id: paymentIntent.id,
        amount: approvedTotal,
        card_last4: paymentMethod.card?.last4,
      },
      woo_order_id: wooOrderId,
      receipt_number: receiptNumber,
    });

  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (claimedOrderId) {
      try {
        await query(
          `UPDATE pending_peptide_orders SET status = 'pending', approved_by = NULL WHERE id = $1 AND status = 'processing'`,
          [claimedOrderId]
        );
      } catch { /* best effort rollback */ }
    }

    if (error?.type === 'StripeCardError') {
      return NextResponse.json({ error: `Card declined: ${error.message}`, code: 'CARD_DECLINED' }, { status: 402 });
    }
    console.error('[Pending Orders] POST error:', error);
    return NextResponse.json({ error: 'Failed to process order' }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

async function rollbackToPending(orderId: string) {
  await query(`UPDATE pending_peptide_orders SET status = 'pending', approved_by = NULL WHERE id = $1`, [orderId]);
}

async function sendPatientNotification(
  healthieClientId: string | null, orderId: string,
  title: string, body: string, type: string
) {
  if (!healthieClientId) return;
  try {
    const tokens = await loadTokensForPatient(healthieClientId, 'billing');
    if (tokens.length > 0) {
      await sendPushMessages(tokens.map(t => ({
        target: { expoToken: t.expo_token, healthieClientId },
        category: 'billing' as const,
        dedupeKey: `pending-${type}-${orderId}`,
        title,
        body,
        data: { type, orderId },
      })));
    }
  } catch (pushErr) {
    console.error('[Pending Orders] Push notification error:', pushErr);
  }
}

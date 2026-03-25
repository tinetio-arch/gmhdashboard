/**
 * ABXTac WooCommerce Webhook Handler
 *
 * Processes webhooks from WooCommerce for order events.
 * Follows YourPeptideBrand integration requirements.
 *
 * Webhook events handled:
 * - order.created: New order placed
 * - order.updated: Order status changed
 * - order.deleted: Order cancelled
 *
 * CRITICAL: All products must have YPB.### SKU format
 * CRITICAL: Only USPS shipping methods allowed
 */

import { NextRequest, NextResponse } from 'next/server';
import { getABXTacClient, type WooOrder } from '@/lib/abxtac-woo';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

// Webhook secret for signature validation
const WEBHOOK_SECRET = process.env.ABXTAC_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    // Get webhook signature from headers
    const signature = request.headers.get('x-wc-webhook-signature');
    if (!signature) {
      console.error('Missing webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Get raw body for signature validation
    const body = await request.text();

    // Validate webhook signature
    const abxtac = getABXTacClient();
    if (!abxtac.validateWebhookSignature(body, signature, WEBHOOK_SECRET)) {
      console.error('Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse webhook data
    const data = JSON.parse(body);
    const topic = request.headers.get('x-wc-webhook-topic');

    console.log(`Processing ABXTac webhook: ${topic}`);

    // Initialize Supabase client
    const cookieStore = cookies();
    const supabase = await createClient(cookieStore);

    // Process based on webhook topic
    switch (topic) {
      case 'order.created':
        await handleOrderCreated(data as WooOrder, supabase);
        break;

      case 'order.updated':
        await handleOrderUpdated(data as WooOrder, supabase);
        break;

      case 'order.deleted':
        await handleOrderDeleted(data as WooOrder, supabase);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Handle new order creation
 */
async function handleOrderCreated(order: WooOrder, supabase: any) {
  console.log(`New ABXTac order #${order.id} created`);

  // Validate order SKUs
  const abxtac = getABXTacClient();
  const skuValidation = abxtac.validateOrderSKUs(order);

  if (!skuValidation.valid) {
    console.error(`Order #${order.id} has invalid SKUs:`, skuValidation.errors);

    // Add note to order about SKU issues
    await abxtac.updateOrderStatus(
      order.id,
      'on-hold',
      'Order on hold: Invalid product SKUs. ' + skuValidation.errors.join(', ')
    );

    // Store issue in database
    await supabase.from('abxtac_order_issues').insert({
      order_id: order.id,
      issue_type: 'invalid_sku',
      issue_details: skuValidation.errors,
      created_at: new Date().toISOString()
    });

    return;
  }

  // Validate shipping method
  const shippingValidation = abxtac.validateShipping(order);

  if (!shippingValidation.valid) {
    console.error(`Order #${order.id} has invalid shipping:`, shippingValidation.error);

    // Add note to order about shipping issue
    await abxtac.updateOrderStatus(
      order.id,
      'on-hold',
      'Order on hold: ' + shippingValidation.error
    );

    // Store issue in database
    await supabase.from('abxtac_order_issues').insert({
      order_id: order.id,
      issue_type: 'invalid_shipping',
      issue_details: shippingValidation.error,
      created_at: new Date().toISOString()
    });

    return;
  }

  // Verify customer age (18+ requirement)
  const ageVerified = await abxtac.verifyCustomerAge(order.customer_id);

  if (!ageVerified) {
    console.log(`Order #${order.id} requires age verification`);

    // Put order on hold for age verification
    await abxtac.updateOrderStatus(
      order.id,
      'on-hold',
      'Age verification required. Please verify you are 18+ years old.'
    );

    // Store in database for follow-up
    await supabase.from('abxtac_orders').insert({
      order_id: order.id,
      customer_id: order.customer_id,
      customer_email: order.billing.email,
      status: 'pending_age_verification',
      total: order.total,
      items: order.line_items.map(item => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price: item.price
      })),
      shipping_method: order.shipping_lines[0]?.method_id,
      created_at: order.date_created,
      updated_at: new Date().toISOString()
    });

    return;
  }

  // Store valid order in database for fulfillment
  await supabase.from('abxtac_orders').insert({
    order_id: order.id,
    customer_id: order.customer_id,
    customer_email: order.billing.email,
    status: 'ready_for_fulfillment',
    total: order.total,
    items: order.line_items.map(item => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      price: item.price
    })),
    shipping_address: {
      name: `${order.shipping.first_name} ${order.shipping.last_name}`,
      address_1: order.shipping.address_1,
      address_2: order.shipping.address_2,
      city: order.shipping.city,
      state: order.shipping.state,
      postcode: order.shipping.postcode,
      country: order.shipping.country
    },
    shipping_method: order.shipping_lines[0]?.method_id,
    created_at: order.date_created,
    updated_at: new Date().toISOString()
  });

  console.log(`Order #${order.id} ready for fulfillment`);
}

/**
 * Handle order status updates
 */
async function handleOrderUpdated(order: WooOrder, supabase: any) {
  console.log(`ABXTac order #${order.id} updated to status: ${order.status}`);

  // Update order status in database
  const { error } = await supabase
    .from('abxtac_orders')
    .update({
      status: mapWooStatusToInternal(order.status),
      updated_at: new Date().toISOString()
    })
    .eq('order_id', order.id);

  if (error) {
    console.error(`Failed to update order #${order.id} in database:`, error);
  }

  // Handle specific status changes
  switch (order.status) {
    case 'processing':
      // Order is paid and ready for fulfillment
      await handleReadyForFulfillment(order, supabase);
      break;

    case 'completed':
      // Order has been shipped
      await handleOrderShipped(order, supabase);
      break;

    case 'refunded':
    case 'cancelled':
      // Order cancelled or refunded
      await handleOrderCancelled(order, supabase);
      break;
  }
}

/**
 * Handle order deletion
 */
async function handleOrderDeleted(order: WooOrder, supabase: any) {
  console.log(`ABXTac order #${order.id} deleted`);

  // Mark order as cancelled in database
  await supabase
    .from('abxtac_orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('order_id', order.id);
}

/**
 * Process order ready for fulfillment
 */
async function handleReadyForFulfillment(order: WooOrder, supabase: any) {
  // Check inventory levels for all items
  const inventoryCheck = await checkInventory(order.line_items, supabase);

  if (!inventoryCheck.available) {
    // Put order on hold due to inventory
    const abxtac = getABXTacClient();
    await abxtac.updateOrderStatus(
      order.id,
      'on-hold',
      `Inventory shortage: ${inventoryCheck.unavailableItems.join(', ')}`
    );

    // Store issue
    await supabase.from('abxtac_order_issues').insert({
      order_id: order.id,
      issue_type: 'inventory_shortage',
      issue_details: inventoryCheck.unavailableItems,
      created_at: new Date().toISOString()
    });

    return;
  }

  // Update order status to ready for shipment
  await supabase
    .from('abxtac_orders')
    .update({
      status: 'ready_to_ship',
      updated_at: new Date().toISOString()
    })
    .eq('order_id', order.id);

  // TODO: Trigger shipping label creation via USPS
  // This would integrate with a USPS API client similar to the existing UPS client
  console.log(`Order #${order.id} ready to ship via USPS`);
}

/**
 * Handle order shipped
 */
async function handleOrderShipped(order: WooOrder, supabase: any) {
  // Extract tracking information from meta data
  const trackingNumber = order.meta_data?.find(m => m.key === '_tracking_number')?.value;
  const trackingCarrier = order.meta_data?.find(m => m.key === '_tracking_carrier')?.value;
  const dateShipped = order.meta_data?.find(m => m.key === '_date_shipped')?.value;

  if (trackingNumber) {
    // Update order with tracking info
    await supabase
      .from('abxtac_orders')
      .update({
        status: 'shipped',
        tracking_number: trackingNumber,
        tracking_carrier: trackingCarrier,
        shipped_date: dateShipped,
        updated_at: new Date().toISOString()
      })
      .eq('order_id', order.id);

    console.log(`Order #${order.id} shipped with tracking: ${trackingNumber}`);
  }
}

/**
 * Handle order cancellation
 */
async function handleOrderCancelled(order: WooOrder, supabase: any) {
  // Return inventory to stock
  for (const item of order.line_items) {
    await supabase.rpc('increment_abxtac_stock', {
      p_sku: item.sku,
      p_quantity: item.quantity
    });
  }

  console.log(`Order #${order.id} cancelled, inventory returned`);
}

/**
 * Check inventory availability
 */
async function checkInventory(
  items: WooOrder['line_items'],
  supabase: any
): Promise<{ available: boolean; unavailableItems: string[] }> {
  const unavailableItems: string[] = [];

  for (const item of items) {
    const { data: inventory } = await supabase
      .from('abxtac_inventory')
      .select('quantity_available')
      .eq('sku', item.sku)
      .single();

    if (!inventory || inventory.quantity_available < item.quantity) {
      unavailableItems.push(`${item.name} (${item.sku})`);
    }
  }

  return {
    available: unavailableItems.length === 0,
    unavailableItems
  };
}

/**
 * Map WooCommerce status to internal status
 */
function mapWooStatusToInternal(wooStatus: WooOrder['status']): string {
  const statusMap: Record<WooOrder['status'], string> = {
    'pending': 'pending_payment',
    'processing': 'ready_for_fulfillment',
    'on-hold': 'on_hold',
    'completed': 'shipped',
    'cancelled': 'cancelled',
    'refunded': 'refunded',
    'failed': 'failed'
  };

  return statusMap[wooStatus] || wooStatus;
}
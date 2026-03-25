/**
 * ABXTac Order Fulfillment Automation
 *
 * Processes WooCommerce orders for fulfillment following YourPeptideBrand requirements:
 * - Validates SKU format (YPB.###)
 * - Creates USPS shipping labels only
 * - Updates order tracking information
 * - Manages inventory levels
 *
 * CRITICAL: Only USPS shipping methods are allowed per YPB requirements
 */

import { getABXTacClient, type WooOrder } from './abxtac-woo';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

// USPS service codes mapped from WooCommerce shipping methods
const USPS_SERVICE_MAP: Record<string, string> = {
  'usps_first_class': 'First-Class Mail',
  'usps_priority': 'Priority Mail',
  'usps_priority_express': 'Priority Mail Express',
  'flat_rate': 'Priority Mail', // Default flat rate to Priority
};

// ABXTac warehouse address
const ABXTAC_WAREHOUSE = {
  name: 'ABXTac Fulfillment',
  company: 'ABXTac Research',
  address1: process.env.ABXTAC_WAREHOUSE_ADDRESS1 || '',
  address2: process.env.ABXTAC_WAREHOUSE_ADDRESS2 || '',
  city: process.env.ABXTAC_WAREHOUSE_CITY || 'Prescott',
  state: process.env.ABXTAC_WAREHOUSE_STATE || 'AZ',
  postal: process.env.ABXTAC_WAREHOUSE_POSTAL || '86301',
  country: 'US',
  phone: process.env.ABXTAC_WAREHOUSE_PHONE || ''
};

export interface FulfillmentResult {
  success: boolean;
  orderId: number;
  trackingNumber?: string;
  labelUrl?: string;
  error?: string;
}

export interface BatchFulfillmentResult {
  processed: number;
  successful: number;
  failed: number;
  results: FulfillmentResult[];
}

/**
 * Process a single order for fulfillment
 */
export async function fulfillOrder(orderId: number): Promise<FulfillmentResult> {
  try {
    const abxtac = getABXTacClient();

    // Get order details
    const order = await abxtac.getOrder(orderId);

    // Validate order is ready for fulfillment
    if (order.status !== 'processing') {
      return {
        success: false,
        orderId,
        error: `Order is not in processing status (current: ${order.status})`
      };
    }

    // Validate SKUs
    const skuValidation = abxtac.validateOrderSKUs(order);
    if (!skuValidation.valid) {
      return {
        success: false,
        orderId,
        error: `Invalid SKUs: ${skuValidation.errors.join(', ')}`
      };
    }

    // Validate shipping
    const shippingValidation = abxtac.validateShipping(order);
    if (!shippingValidation.valid) {
      return {
        success: false,
        orderId,
        error: shippingValidation.error
      };
    }

    // Verify customer age
    const ageVerified = await abxtac.verifyCustomerAge(order.customer_id);
    if (!ageVerified) {
      // Put order on hold
      await abxtac.updateOrderStatus(
        orderId,
        'on-hold',
        'Age verification required (18+ only)'
      );

      return {
        success: false,
        orderId,
        error: 'Customer age verification required'
      };
    }

    // Check inventory
    const inventoryCheck = await checkAndReserveInventory(order);
    if (!inventoryCheck.success) {
      return {
        success: false,
        orderId,
        error: `Inventory shortage: ${inventoryCheck.unavailableItems?.join(', ')}`
      };
    }

    // Create USPS shipping label
    const shippingResult = await createUSPSLabel(order);
    if (!shippingResult.success) {
      // Release reserved inventory on shipping failure
      await releaseInventory(order);

      return {
        success: false,
        orderId,
        error: `Shipping label creation failed: ${shippingResult.error}`
      };
    }

    // Update order with tracking information
    await abxtac.addTrackingInfo(
      orderId,
      shippingResult.trackingNumber!,
      'USPS'
    );

    // Commit inventory changes
    await commitInventory(order);

    // Log fulfillment in database
    const cookieStore = cookies();
    const supabase = await createClient(cookieStore);

    await supabase.from('abxtac_fulfillments').insert({
      order_id: orderId,
      tracking_number: shippingResult.trackingNumber,
      label_url: shippingResult.labelUrl,
      carrier: 'USPS',
      service: order.shipping_lines[0]?.method_id,
      shipped_date: new Date().toISOString(),
      status: 'shipped'
    });

    return {
      success: true,
      orderId,
      trackingNumber: shippingResult.trackingNumber,
      labelUrl: shippingResult.labelUrl
    };
  } catch (error: any) {
    console.error(`Fulfillment failed for order #${orderId}:`, error);
    return {
      success: false,
      orderId,
      error: error.message
    };
  }
}

/**
 * Process multiple orders in batch
 */
export async function batchFulfillOrders(
  orderIds?: number[]
): Promise<BatchFulfillmentResult> {
  const abxtac = getABXTacClient();

  // Get orders to process
  let orders: WooOrder[];
  if (orderIds && orderIds.length > 0) {
    // Process specific orders
    orders = await Promise.all(orderIds.map(id => abxtac.getOrder(id)));
  } else {
    // Process all processing orders
    orders = await abxtac.getProcessingOrders();
  }

  const results: FulfillmentResult[] = [];
  let successful = 0;
  let failed = 0;

  // Process orders sequentially to avoid rate limits
  for (const order of orders) {
    const result = await fulfillOrder(order.id);
    results.push(result);

    if (result.success) {
      successful++;
      console.log(`✓ Order #${order.id} fulfilled successfully`);
    } else {
      failed++;
      console.error(`✗ Order #${order.id} failed: ${result.error}`);
    }

    // Add small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return {
    processed: orders.length,
    successful,
    failed,
    results
  };
}

/**
 * Check and reserve inventory for order
 */
async function checkAndReserveInventory(order: WooOrder): Promise<{
  success: boolean;
  unavailableItems?: string[];
}> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);
  const unavailableItems: string[] = [];

  // Start transaction
  for (const item of order.line_items) {
    // Check current stock
    const { data: inventory, error } = await supabase
      .from('abxtac_inventory')
      .select('*')
      .eq('sku', item.sku)
      .single();

    if (error || !inventory) {
      // Create inventory record if doesn't exist
      await supabase.from('abxtac_inventory').insert({
        sku: item.sku,
        product_name: item.name,
        quantity_available: 0,
        quantity_reserved: 0,
        reorder_point: 10,
        updated_at: new Date().toISOString()
      });

      unavailableItems.push(`${item.name} (${item.sku}) - not in stock`);
      continue;
    }

    // Check if enough stock available
    const availableQty = inventory.quantity_available - inventory.quantity_reserved;
    if (availableQty < item.quantity) {
      unavailableItems.push(
        `${item.name} (${item.sku}) - need ${item.quantity}, available: ${availableQty}`
      );
      continue;
    }

    // Reserve inventory
    await supabase
      .from('abxtac_inventory')
      .update({
        quantity_reserved: inventory.quantity_reserved + item.quantity,
        updated_at: new Date().toISOString()
      })
      .eq('sku', item.sku);
  }

  if (unavailableItems.length > 0) {
    // Release any reserved inventory on failure
    await releaseInventory(order);
    return { success: false, unavailableItems };
  }

  return { success: true };
}

/**
 * Release reserved inventory (on fulfillment failure)
 */
async function releaseInventory(order: WooOrder): Promise<void> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  for (const item of order.line_items) {
    await supabase.rpc('decrement_abxtac_reserved', {
      p_sku: item.sku,
      p_quantity: item.quantity
    });
  }
}

/**
 * Commit inventory changes (on successful fulfillment)
 */
async function commitInventory(order: WooOrder): Promise<void> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  for (const item of order.line_items) {
    // Decrease available and reserved quantities
    await supabase.rpc('commit_abxtac_inventory', {
      p_sku: item.sku,
      p_quantity: item.quantity
    });

    // Check if reorder needed
    const { data: inventory } = await supabase
      .from('abxtac_inventory')
      .select('quantity_available, reorder_point')
      .eq('sku', item.sku)
      .single();

    if (inventory && inventory.quantity_available <= inventory.reorder_point) {
      // Create reorder alert
      await supabase.from('abxtac_reorder_alerts').insert({
        sku: item.sku,
        current_stock: inventory.quantity_available,
        reorder_point: inventory.reorder_point,
        created_at: new Date().toISOString()
      });
    }
  }
}

/**
 * Create USPS shipping label
 * NOTE: This is a placeholder for USPS integration
 * In production, this would integrate with USPS Web Tools API or a service like EasyPost
 */
async function createUSPSLabel(order: WooOrder): Promise<{
  success: boolean;
  trackingNumber?: string;
  labelUrl?: string;
  error?: string;
}> {
  try {
    // Determine USPS service level
    const shippingMethod = order.shipping_lines[0]?.method_id || 'usps_priority';
    const serviceLevel = USPS_SERVICE_MAP[shippingMethod] || 'Priority Mail';

    // Calculate package weight (1 oz per item as standard)
    const totalWeight = order.line_items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    // Package dimensions for peptide vials (standard small box)
    const packageInfo = {
      weight: totalWeight, // ounces
      length: 6,
      width: 4,
      height: 3
    };

    // Shipping addresses
    const shipFrom = ABXTAC_WAREHOUSE;
    const shipTo = {
      name: `${order.shipping.first_name} ${order.shipping.last_name}`,
      company: order.shipping.company || '',
      address1: order.shipping.address_1,
      address2: order.shipping.address_2 || '',
      city: order.shipping.city,
      state: order.shipping.state,
      postal: order.shipping.postcode,
      country: order.shipping.country || 'US',
      phone: order.billing.phone
    };

    // TODO: Integrate with actual USPS API or shipping service
    // For now, generate mock tracking number
    const mockTrackingNumber = `9400100000000000${order.id}`;
    const mockLabelUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${mockTrackingNumber}`;

    console.log(`Creating USPS ${serviceLevel} label for order #${order.id}`);
    console.log(`From: ${shipFrom.city}, ${shipFrom.state}`);
    console.log(`To: ${shipTo.city}, ${shipTo.state}`);
    console.log(`Weight: ${totalWeight} oz`);

    // In production, this would make actual API call to USPS or shipping service
    // const uspsClient = new USPSClient(process.env.USPS_USER_ID);
    // const label = await uspsClient.createLabel({
    //   service: serviceLevel,
    //   shipFrom,
    //   shipTo,
    //   package: packageInfo
    // });

    return {
      success: true,
      trackingNumber: mockTrackingNumber,
      labelUrl: mockLabelUrl
    };
  } catch (error: any) {
    console.error('USPS label creation failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get fulfillment queue status
 */
export async function getFulfillmentQueueStatus(): Promise<{
  readyToShip: number;
  awaitingVerification: number;
  onHold: number;
  inventoryIssues: number;
}> {
  const abxtac = getABXTacClient();
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  // Get orders from WooCommerce
  const processingOrders = await abxtac.getOrders('processing');
  const onHoldOrders = await abxtac.getOrders('on-hold');

  // Get issue counts from database
  const { data: issues } = await supabase
    .from('abxtac_order_issues')
    .select('issue_type')
    .eq('resolved', false);

  const inventoryIssues = issues?.filter(i => i.issue_type === 'inventory_shortage').length || 0;
  const ageVerificationIssues = issues?.filter(i => i.issue_type === 'age_verification').length || 0;

  return {
    readyToShip: processingOrders.length,
    awaitingVerification: ageVerificationIssues,
    onHold: onHoldOrders.length,
    inventoryIssues
  };
}

/**
 * Retry failed fulfillment
 */
export async function retryFulfillment(orderId: number): Promise<FulfillmentResult> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  // Clear any previous issues
  await supabase
    .from('abxtac_order_issues')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('order_id', orderId);

  // Retry fulfillment
  return fulfillOrder(orderId);
}

/**
 * Generate YPB bundle mapping request
 */
export async function requestBundleMapping(
  bundleName: string,
  products: Array<{ sku: string; name: string; quantity: number }>
): Promise<string> {
  const abxtac = getABXTacClient();
  const emailContent = abxtac.generateBundleMappingRequest(bundleName, products);

  // Log the request
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  await supabase.from('abxtac_bundle_requests').insert({
    bundle_name: bundleName,
    products,
    request_status: 'pending',
    requested_at: new Date().toISOString()
  });

  return emailContent;
}
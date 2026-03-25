/**
 * ABXTac Inventory Management System
 *
 * Synchronizes inventory between WooCommerce and GMH Dashboard.
 * Handles stock levels, reorder alerts, and expiration tracking.
 *
 * CRITICAL: All products must follow YPB.### SKU format
 * CRITICAL: Peptides require temperature-controlled storage
 */

import { getABXTacClient, YPB_PRODUCT_CATALOG, type WooProduct } from './abxtac-woo';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export interface InventoryItem {
  sku: string;
  product_name: string;
  quantity_available: number;
  quantity_reserved: number;
  quantity_incoming: number;
  reorder_point: number;
  reorder_quantity: number;
  unit_cost: number;
  expiration_date?: string;
  batch_number?: string;
  storage_location?: string;
  temperature_requirements?: string;
  last_synced?: string;
}

export interface InventoryAlert {
  type: 'low_stock' | 'expiring_soon' | 'expired' | 'temperature_deviation';
  sku: string;
  product_name: string;
  current_value: number | string;
  threshold_value: number | string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface InventorySyncResult {
  success: boolean;
  itemsSynced: number;
  itemsFailed: number;
  errors: string[];
  alerts: InventoryAlert[];
}

/**
 * Sync inventory from WooCommerce to Dashboard
 */
export async function syncInventoryFromWooCommerce(): Promise<InventorySyncResult> {
  const abxtac = getABXTacClient();
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  const errors: string[] = [];
  const alerts: InventoryAlert[] = [];
  let itemsSynced = 0;
  let itemsFailed = 0;

  try {
    // Get all products from WooCommerce
    const products = await abxtac.getProducts(200);

    for (const product of products) {
      try {
        // Validate SKU format
        if (!product.sku || !product.sku.match(/^YPB\.\d{3}$/)) {
          errors.push(`Invalid SKU format for ${product.name}: ${product.sku}`);
          itemsFailed++;
          continue;
        }

        // Check if product exists in our database
        const { data: existing, error: fetchError } = await supabase
          .from('abxtac_inventory')
          .select('*')
          .eq('sku', product.sku)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          // PGRST116 = no rows found
          errors.push(`Database error for SKU ${product.sku}: ${fetchError.message}`);
          itemsFailed++;
          continue;
        }

        // Prepare inventory data
        const inventoryData = {
          sku: product.sku,
          product_name: product.name,
          quantity_available: product.stock_quantity || 0,
          quantity_reserved: existing?.quantity_reserved || 0,
          quantity_incoming: existing?.quantity_incoming || 0,
          reorder_point: existing?.reorder_point || getDefaultReorderPoint(product.sku),
          reorder_quantity: existing?.reorder_quantity || getDefaultReorderQuantity(product.sku),
          unit_cost: parseFloat(product.regular_price) * 0.3, // Estimated cost at 30% of retail
          temperature_requirements: getPeptideStorageRequirements(product.sku),
          last_synced: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Upsert inventory record
        const { error: upsertError } = await supabase
          .from('abxtac_inventory')
          .upsert(inventoryData, { onConflict: 'sku' });

        if (upsertError) {
          errors.push(`Failed to update ${product.sku}: ${upsertError.message}`);
          itemsFailed++;
          continue;
        }

        // Check for low stock alert
        const effectiveStock = inventoryData.quantity_available - inventoryData.quantity_reserved;
        if (effectiveStock <= inventoryData.reorder_point) {
          alerts.push({
            type: 'low_stock',
            sku: product.sku,
            product_name: product.name,
            current_value: effectiveStock,
            threshold_value: inventoryData.reorder_point,
            severity: effectiveStock <= 0 ? 'critical' : 'high',
            message: `${product.name} has ${effectiveStock} units available (reorder at ${inventoryData.reorder_point})`
          });
        }

        // Update WooCommerce stock status if needed
        const stockStatus = effectiveStock > 0 ? 'instock' : 'outofstock';
        if (product.stock_status !== stockStatus) {
          await abxtac.updateProductStock(product.id, effectiveStock);
        }

        itemsSynced++;
      } catch (itemError: any) {
        errors.push(`Failed to sync ${product.name}: ${itemError.message}`);
        itemsFailed++;
      }
    }

    // Check for expiring products
    const expiringAlerts = await checkExpiringInventory();
    alerts.push(...expiringAlerts);

    return {
      success: itemsFailed === 0,
      itemsSynced,
      itemsFailed,
      errors,
      alerts
    };
  } catch (error: any) {
    console.error('Inventory sync failed:', error);
    return {
      success: false,
      itemsSynced: 0,
      itemsFailed: 0,
      errors: [error.message],
      alerts: []
    };
  }
}

/**
 * Sync inventory from Dashboard to WooCommerce
 */
export async function syncInventoryToWooCommerce(): Promise<InventorySyncResult> {
  const abxtac = getABXTacClient();
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  const errors: string[] = [];
  let itemsSynced = 0;
  let itemsFailed = 0;

  try {
    // Get inventory from Dashboard
    const { data: inventory, error } = await supabase
      .from('abxtac_inventory')
      .select('*')
      .order('sku');

    if (error) {
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }

    // Get all WooCommerce products for mapping
    const products = await abxtac.getProducts(200);
    const productMap = new Map(products.map(p => [p.sku, p]));

    for (const item of inventory || []) {
      try {
        const product = productMap.get(item.sku);
        if (!product) {
          errors.push(`Product not found in WooCommerce: ${item.sku}`);
          itemsFailed++;
          continue;
        }

        // Calculate effective stock
        const effectiveStock = item.quantity_available - item.quantity_reserved;

        // Update WooCommerce stock
        await abxtac.updateProductStock(product.id, effectiveStock);

        // Update last sync time
        await supabase
          .from('abxtac_inventory')
          .update({ last_synced: new Date().toISOString() })
          .eq('sku', item.sku);

        itemsSynced++;
      } catch (itemError: any) {
        errors.push(`Failed to sync ${item.sku}: ${itemError.message}`);
        itemsFailed++;
      }
    }

    return {
      success: itemsFailed === 0,
      itemsSynced,
      itemsFailed,
      errors,
      alerts: []
    };
  } catch (error: any) {
    console.error('Inventory sync to WooCommerce failed:', error);
    return {
      success: false,
      itemsSynced: 0,
      itemsFailed: 0,
      errors: [error.message],
      alerts: []
    };
  }
}

/**
 * Check for expiring inventory
 */
async function checkExpiringInventory(): Promise<InventoryAlert[]> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);
  const alerts: InventoryAlert[] = [];

  // Get inventory with expiration dates
  const { data: inventory } = await supabase
    .from('abxtac_inventory')
    .select('*')
    .not('expiration_date', 'is', null)
    .order('expiration_date');

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  for (const item of inventory || []) {
    const expirationDate = new Date(item.expiration_date);

    if (expirationDate <= now) {
      // Expired
      alerts.push({
        type: 'expired',
        sku: item.sku,
        product_name: item.product_name,
        current_value: item.expiration_date,
        threshold_value: now.toISOString(),
        severity: 'critical',
        message: `${item.product_name} (Batch: ${item.batch_number}) has expired on ${expirationDate.toLocaleDateString()}`
      });
    } else if (expirationDate <= thirtyDaysFromNow) {
      // Expiring within 30 days
      alerts.push({
        type: 'expiring_soon',
        sku: item.sku,
        product_name: item.product_name,
        current_value: item.expiration_date,
        threshold_value: thirtyDaysFromNow.toISOString(),
        severity: 'high',
        message: `${item.product_name} (Batch: ${item.batch_number}) expires in ${Math.ceil((expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))} days`
      });
    } else if (expirationDate <= sixtyDaysFromNow) {
      // Expiring within 60 days
      alerts.push({
        type: 'expiring_soon',
        sku: item.sku,
        product_name: item.product_name,
        current_value: item.expiration_date,
        threshold_value: sixtyDaysFromNow.toISOString(),
        severity: 'medium',
        message: `${item.product_name} (Batch: ${item.batch_number}) expires in ${Math.ceil((expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))} days`
      });
    }
  }

  return alerts;
}

/**
 * Add new inventory batch
 */
export async function addInventoryBatch(
  sku: string,
  quantity: number,
  batchNumber: string,
  expirationDate: string,
  unitCost?: number
): Promise<{ success: boolean; error?: string }> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  try {
    // Get current inventory
    const { data: current, error: fetchError } = await supabase
      .from('abxtac_inventory')
      .select('*')
      .eq('sku', sku)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    // Update inventory quantities
    const newQuantity = (current?.quantity_available || 0) + quantity;
    const newIncoming = Math.max(0, (current?.quantity_incoming || 0) - quantity);

    const { error: updateError } = await supabase
      .from('abxtac_inventory')
      .upsert({
        sku,
        quantity_available: newQuantity,
        quantity_incoming: newIncoming,
        batch_number: batchNumber,
        expiration_date: expirationDate,
        unit_cost: unitCost || current?.unit_cost,
        updated_at: new Date().toISOString()
      }, { onConflict: 'sku' });

    if (updateError) {
      throw updateError;
    }

    // Log batch receipt
    await supabase.from('abxtac_inventory_batches').insert({
      sku,
      batch_number: batchNumber,
      quantity,
      expiration_date: expirationDate,
      unit_cost: unitCost,
      received_date: new Date().toISOString(),
      status: 'received'
    });

    // Sync to WooCommerce
    const abxtac = getABXTacClient();
    const products = await abxtac.getProducts();
    const product = products.find(p => p.sku === sku);

    if (product) {
      await abxtac.updateProductStock(product.id, newQuantity);
    }

    return { success: true };
  } catch (error: any) {
    console.error(`Failed to add inventory batch for ${sku}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Create reorder for low stock items
 */
export async function createReorderList(): Promise<{
  items: Array<{
    sku: string;
    name: string;
    currentStock: number;
    reorderQuantity: number;
    estimatedCost: number;
  }>;
  totalCost: number;
}> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  const { data: lowStock } = await supabase
    .from('abxtac_inventory')
    .select('*')
    .lte('quantity_available', 'reorder_point')
    .order('quantity_available');

  const items = (lowStock || []).map(item => ({
    sku: item.sku,
    name: item.product_name,
    currentStock: item.quantity_available - item.quantity_reserved,
    reorderQuantity: item.reorder_quantity,
    estimatedCost: item.reorder_quantity * item.unit_cost
  }));

  const totalCost = items.reduce((sum, item) => sum + item.estimatedCost, 0);

  return { items, totalCost };
}

/**
 * Get default reorder point based on SKU
 */
function getDefaultReorderPoint(sku: string): number {
  // Higher volume products need higher reorder points
  const highVolumeSkus = ['YPB.213', 'YPB.214', 'YPB.203', 'YPB.204']; // BPC-157, TB-500, GLP-2
  const mediumVolumeSkus = ['YPB.216', 'YPB.217', 'YPB.218']; // CJC-1295, AOD-9604

  if (highVolumeSkus.includes(sku)) {
    return 20; // Reorder when 20 units remaining
  } else if (mediumVolumeSkus.includes(sku)) {
    return 10; // Reorder when 10 units remaining
  } else {
    return 5; // Reorder when 5 units remaining
  }
}

/**
 * Get default reorder quantity based on SKU
 */
function getDefaultReorderQuantity(sku: string): number {
  // Order quantities based on expected volume
  const highVolumeSkus = ['YPB.213', 'YPB.214', 'YPB.203', 'YPB.204'];
  const mediumVolumeSkus = ['YPB.216', 'YPB.217', 'YPB.218'];

  if (highVolumeSkus.includes(sku)) {
    return 100; // Order 100 units
  } else if (mediumVolumeSkus.includes(sku)) {
    return 50; // Order 50 units
  } else {
    return 25; // Order 25 units
  }
}

/**
 * Get peptide storage requirements
 */
function getPeptideStorageRequirements(sku: string): string {
  // Most peptides require refrigeration or freezing
  const refrigeratedPeptides = ['YPB.203', 'YPB.204', 'YPB.205']; // GLP-2 variants
  const frozenPeptides = ['YPB.212', 'YPB.213', 'YPB.214', 'YPB.215']; // BPC-157, TB-500

  if (refrigeratedPeptides.includes(sku)) {
    return '2-8°C (Refrigerated)';
  } else if (frozenPeptides.includes(sku)) {
    return '-20°C (Frozen)';
  } else {
    return '2-8°C (Refrigerated)'; // Default for all peptides
  }
}

/**
 * Perform inventory audit
 */
export async function performInventoryAudit(): Promise<{
  totalItems: number;
  totalValue: number;
  expiringItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  issues: string[];
}> {
  const cookieStore = cookies();
  const supabase = await createClient(cookieStore);

  const { data: inventory } = await supabase
    .from('abxtac_inventory')
    .select('*');

  let totalValue = 0;
  let expiringItems = 0;
  let lowStockItems = 0;
  let outOfStockItems = 0;
  const issues: string[] = [];

  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  for (const item of inventory || []) {
    const effectiveStock = item.quantity_available - item.quantity_reserved;
    const value = effectiveStock * item.unit_cost;
    totalValue += value;

    if (effectiveStock <= 0) {
      outOfStockItems++;
      issues.push(`${item.product_name} is out of stock`);
    } else if (effectiveStock <= item.reorder_point) {
      lowStockItems++;
    }

    if (item.expiration_date) {
      const expirationDate = new Date(item.expiration_date);
      if (expirationDate <= thirtyDaysFromNow) {
        expiringItems++;
        if (expirationDate <= new Date()) {
          issues.push(`${item.product_name} (Batch: ${item.batch_number}) has expired`);
        }
      }
    }

    // Check for missing data
    if (!item.batch_number && item.quantity_available > 0) {
      issues.push(`${item.product_name} missing batch number`);
    }
    if (!item.expiration_date && item.quantity_available > 0) {
      issues.push(`${item.product_name} missing expiration date`);
    }
  }

  return {
    totalItems: inventory?.length || 0,
    totalValue,
    expiringItems,
    lowStockItems,
    outOfStockItems,
    issues
  };
}
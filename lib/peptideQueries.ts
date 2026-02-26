/**
 * Peptide Inventory Queries
 * 
 * Replicates Excel formulas exactly:
 * - Total Ordered = SUMIF(Peptide Orders for this peptide)
 * - Total Dispensed = SUMIFS(Peptide Therapy WHERE peptide=X AND status="Paid" AND education_complete=TRUE)
 * - Current Stock = Total Ordered - Total Dispensed
 * - Re-Order Alert = IF(Stock <= Threshold, "Reorder", "OK")
 */

import { query } from './db';

export interface PeptideProduct {
  product_id: string;
  name: string;
  healthie_product_id: string | null;
  reorder_point: number;
  category: string;
  sku?: string;
  supplier: string | null;
  unit_cost: number | null;
  sell_price: number | null;
  label_directions: string | null;
  active: boolean;
  total_ordered: number;
  total_dispensed: number;
  current_stock: number;
  status: 'OK' | 'Reorder';
  created_at: Date;
}

export interface PeptideOrder {
  order_id: string;
  product_id: string;
  peptide_name: string;
  quantity: number;
  order_date: string;
  po_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface PeptideDispense {
  dispense_id: string;
  product_id: string;
  peptide_name: string;
  quantity: number;
  patient_name: string;
  order_date: string | null;
  received_date: string | null;
  status: string;
  education_complete: boolean;
  notes: string | null;
  label_directions: string | null;
  patient_dob: string | null;
  created_at: Date;
}

export interface PeptideInventorySummary {
  total_products: number;
  total_stock: number;
  low_stock_count: number;
  total_orders: number;
  total_dispensed: number;
  pending_dispenses: number;
}

/**
 * Fetch all peptides with calculated inventory
 * Replicates Excel formula logic exactly:
 * - Total Ordered = SUMIF('Peptide Orders'!$A:$A, peptide, $B:$B)
 * - Total Dispensed = SUMIFS('Peptide Therapy'!$H, B=peptide, C="Paid", F=TRUE)
 * - Current Stock = Ordered - Dispensed
 * - Status = IF(Stock <= Threshold, "Reorder", "OK")
 */
export async function fetchPeptideInventory(includeInactive = false): Promise<PeptideProduct[]> {
  const rows = await query<{
    product_id: string;
    name: string;
    healthie_product_id: string | null;
    reorder_point: string;
    category: string;
    sku: string | null;
    supplier: string | null;
    label_directions: string | null;
    active: boolean;
    unit_cost: string | null;
    sell_price: string | null;
    total_ordered: string;
    total_dispensed: string;
    current_stock: string;
    status: string;
    created_at: Date;
  }>(`
    SELECT 
      p.product_id,
      p.name,
      p.healthie_product_id,
      p.reorder_point,
      p.category,
      p.sku,
      p.supplier,
      p.unit_cost,
      p.sell_price,
      p.label_directions,
      p.active,
      COALESCE(SUM(o.quantity), 0) as total_ordered,
      COALESCE(
        (SELECT SUM(d.quantity) 
         FROM peptide_dispenses d 
         WHERE d.product_id = p.product_id 
           AND d.status = 'Paid' 
           AND d.education_complete = true),
        0
      ) as total_dispensed,
      COALESCE(SUM(o.quantity), 0) - COALESCE(
        (SELECT SUM(d.quantity) 
         FROM peptide_dispenses d 
         WHERE d.product_id = p.product_id 
           AND d.status = 'Paid' 
           AND d.education_complete = true),
        0
      ) as current_stock,
      CASE 
        WHEN COALESCE(SUM(o.quantity), 0) - COALESCE(
          (SELECT SUM(d.quantity) 
           FROM peptide_dispenses d 
           WHERE d.product_id = p.product_id 
             AND d.status = 'Paid' 
             AND d.education_complete = true),
          0
        ) <= p.reorder_point THEN 'Reorder'
        ELSE 'OK'
      END as status,
      p.created_at
    FROM peptide_products p
    LEFT JOIN peptide_orders o ON o.product_id = p.product_id
    GROUP BY p.product_id, p.name, p.healthie_product_id, p.reorder_point, p.category, 
             p.sku, p.supplier, p.unit_cost, p.sell_price, p.label_directions, p.active, p.created_at
    ORDER BY p.active DESC, p.name
  `, []);

  return rows.map(row => ({
    product_id: row.product_id,
    name: row.name,
    healthie_product_id: row.healthie_product_id,
    reorder_point: Number(row.reorder_point),
    category: row.category,
    sku: row.sku || undefined,
    supplier: row.supplier,
    label_directions: row.label_directions,
    active: row.active !== false,
    unit_cost: row.unit_cost ? Number(row.unit_cost) : null,
    sell_price: row.sell_price ? Number(row.sell_price) : null,
    total_ordered: Number(row.total_ordered),
    total_dispensed: Number(row.total_dispensed),
    current_stock: Number(row.current_stock),
    status: row.status as 'OK' | 'Reorder',
    created_at: row.created_at,
  })).filter(p => includeInactive || p.active);
}

/**
 * Fetch inventory summary for dashboard cards
 */
export async function fetchPeptideInventorySummary(): Promise<PeptideInventorySummary> {
  const [row] = await query<{
    total_products: string;
    total_stock: string;
    low_stock_count: string;
    total_orders: string;
    total_dispensed: string;
    pending_dispenses: string;
  }>(`
    WITH inventory_calc AS (
      SELECT 
        p.product_id,
        p.reorder_point,
        COALESCE(SUM(o.quantity), 0) - COALESCE(
          (SELECT SUM(d.quantity) 
           FROM peptide_dispenses d 
           WHERE d.product_id = p.product_id 
             AND d.status = 'Paid' 
             AND d.education_complete = true),
          0
        ) as stock
      FROM peptide_products p
      LEFT JOIN peptide_orders o ON o.product_id = p.product_id
      GROUP BY p.product_id, p.reorder_point
    )
    SELECT 
      (SELECT COUNT(*) FROM peptide_products) as total_products,
      (SELECT COALESCE(SUM(stock), 0) FROM inventory_calc) as total_stock,
      (SELECT COUNT(*) FROM inventory_calc WHERE stock <= reorder_point) as low_stock_count,
      (SELECT COUNT(*) FROM peptide_orders) as total_orders,
      (SELECT COUNT(*) FROM peptide_dispenses WHERE status = 'Paid' AND education_complete = true) as total_dispensed,
      (SELECT COUNT(*) FROM peptide_dispenses WHERE status = 'Pending' OR education_complete = false) as pending_dispenses
  `);

  return {
    total_products: Number(row?.total_products ?? 0),
    total_stock: Number(row?.total_stock ?? 0),
    low_stock_count: Number(row?.low_stock_count ?? 0),
    total_orders: Number(row?.total_orders ?? 0),
    total_dispensed: Number(row?.total_dispensed ?? 0),
    pending_dispenses: Number(row?.pending_dispenses ?? 0),
  };
}

/**
 * Fetch order history (incoming shipments)
 */
export async function fetchPeptideOrders(limit = 100): Promise<PeptideOrder[]> {
  return query<PeptideOrder>(`
    SELECT 
      o.order_id,
      o.product_id,
      p.name as peptide_name,
      o.quantity,
      o.order_date::text,
      o.po_number,
      o.notes,
      o.created_by,
      o.created_at
    FROM peptide_orders o
    JOIN peptide_products p ON p.product_id = o.product_id
    ORDER BY o.order_date DESC, o.created_at DESC
    LIMIT $1
  `, [limit]);
}

/**
 * Fetch patient dispense history
 */
export async function fetchPeptideDispenses(limit = 100): Promise<PeptideDispense[]> {
  return query<PeptideDispense>(`
    SELECT 
      d.sale_id as dispense_id,
      d.product_id,
      p.name as peptide_name,
      d.quantity,
      d.patient_name,
      d.order_date::text,
      d.received_date::text,
      d.status,
      d.education_complete,
      d.notes,
      p.label_directions,
      COALESCE(d.patient_dob, pt.dob::text) as patient_dob,
      d.created_at
    FROM peptide_dispenses d
    JOIN peptide_products p ON p.product_id = d.product_id
    LEFT JOIN patients pt ON pt.full_name ILIKE d.patient_name
    ORDER BY d.created_at DESC
    LIMIT $1
  `, [limit]);
}

/**
 * Record incoming shipment (order)
 */
export async function createPeptideOrder(data: {
  product_id: string;
  quantity: number;
  order_date: string;
  po_number?: string;
  notes?: string;
  created_by?: string;
}): Promise<PeptideOrder> {
  const [order] = await query<PeptideOrder>(`
    INSERT INTO peptide_orders (product_id, quantity, order_date, po_number, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING 
      order_id,
      product_id,
      (SELECT name FROM peptide_products WHERE product_id = $1) as peptide_name,
      quantity,
      order_date::text,
      po_number,
      notes,
      created_by,
      created_at
  `, [data.product_id, data.quantity, data.order_date, data.po_number, data.notes, data.created_by]);

  return order;
}

/**
 * Record patient dispense (deducts from inventory when status=Paid AND education_complete=true)
 */
export async function createPeptideDispense(data: {
  product_id: string;
  quantity?: number;
  patient_name: string;
  patient_dob?: string;
  order_date?: string;
  received_date?: string;
  status: 'Paid' | 'Pending';
  education_complete: boolean;
  notes?: string;
}): Promise<PeptideDispense> {
  const [dispense] = await query<PeptideDispense>(`
    INSERT INTO peptide_dispenses (
      product_id, quantity, patient_name, patient_dob, sale_date, order_date, received_date, 
      status, education_complete, notes, paid
    )
    VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, $10)
    RETURNING 
      sale_id as dispense_id,
      product_id,
      (SELECT name FROM peptide_products WHERE product_id = $1) as peptide_name,
      quantity,
      patient_name,
      patient_dob,
      order_date::text,
      received_date::text,
      status,
      education_complete,
      notes,
      created_at
  `, [
    data.product_id,
    data.quantity ?? 1,
    data.patient_name,
    data.patient_dob || null,
    data.order_date || null,
    data.received_date || null,
    data.status,
    data.education_complete,
    data.notes,
    data.status === 'Paid',
  ]);

  return dispense;
}

/**
 * Update dispense status (mark as paid, education complete, etc.)
 */
export async function updatePeptideDispense(
  dispenseId: string,
  data: {
    status?: 'Paid' | 'Pending';
    education_complete?: boolean;
    order_date?: string | null;
    received_date?: string | null;
    notes?: string;
  }
): Promise<void> {
  const updates: string[] = [];
  const params: (string | boolean | null)[] = [dispenseId];
  let paramIndex = 2;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    params.push(data.status);
    paramIndex++;
    updates.push(`paid = $${paramIndex}`);
    params.push(data.status === 'Paid');
    paramIndex++;
  }
  if (data.education_complete !== undefined) {
    updates.push(`education_complete = $${paramIndex}`);
    params.push(data.education_complete);
    paramIndex++;
  }
  if (data.order_date !== undefined) {
    updates.push(`order_date = $${paramIndex}`);
    params.push(data.order_date);
    paramIndex++;
  }
  if (data.received_date !== undefined) {
    updates.push(`received_date = $${paramIndex}`);
    params.push(data.received_date);
    paramIndex++;
  }
  if (data.notes !== undefined) {
    updates.push(`notes = $${paramIndex}`);
    params.push(data.notes);
    paramIndex++;
  }

  if (updates.length === 0) return;

  await query(
    `UPDATE peptide_dispenses SET ${updates.join(', ')} WHERE sale_id = $1`,
    params
  );
}

/**
 * Find peptide product by Healthie product ID
 */
export async function findPeptideByHealthieId(healthieProductId: string): Promise<{ product_id: string; name: string } | null> {
  const [product] = await query<{ product_id: string; name: string }>(`
    SELECT product_id, name 
    FROM peptide_products 
    WHERE healthie_product_id = $1
  `, [healthieProductId]);

  return product || null;
}

/**
 * Get all peptide product options for dropdowns
 */
export async function fetchPeptideProductOptions(): Promise<{ value: string; label: string }[]> {
  const products = await query<{ product_id: string; name: string }>(`
    SELECT product_id, name FROM peptide_products ORDER BY name
  `);

  return products.map(p => ({ value: p.product_id, label: p.name }));
}

/**
 * Check if peptide is in stock
 */
export async function checkPeptideStock(productId: string): Promise<{ in_stock: boolean; quantity: number }> {
  const [result] = await query<{ current_stock: string }>(`
    SELECT 
      COALESCE(SUM(o.quantity), 0) - COALESCE(
        (SELECT SUM(d.quantity) 
         FROM peptide_dispenses d 
         WHERE d.product_id = $1 
           AND d.status = 'Paid' 
           AND d.education_complete = true),
        0
      ) as current_stock
    FROM peptide_products p
    LEFT JOIN peptide_orders o ON o.product_id = p.product_id
    WHERE p.product_id = $1
    GROUP BY p.product_id
  `, [productId]);

  const stock = Number(result?.current_stock ?? 0);
  return { in_stock: stock > 0, quantity: stock };
}

/**
 * Delete a peptide dispense record
 * Inventory automatically adjusts since stock is computed from live SUMs
 */
export async function deletePeptideDispense(dispenseId: string): Promise<{ deleted: boolean; peptide_name: string; patient_name: string }> {
  const [result] = await query<{ peptide_name: string; patient_name: string }>(`
    DELETE FROM peptide_dispenses 
    WHERE sale_id = $1
    RETURNING 
      (SELECT name FROM peptide_products WHERE product_id = peptide_dispenses.product_id) as peptide_name,
      patient_name
  `, [dispenseId]);

  if (!result) {
    throw new Error(`Dispense ${dispenseId} not found`);
  }

  return { deleted: true, peptide_name: result.peptide_name, patient_name: result.patient_name };
}

/**
 * Create a new peptide product in inventory
 */
export async function createPeptideProduct(data: {
  name: string;
  category: string;
  sku?: string;
  reorder_point?: number;
  supplier?: string;
  unit_cost?: number;
  sell_price?: number;
  label_directions?: string;
  healthie_product_id?: string;
}): Promise<PeptideProduct> {
  const [product] = await query<{
    product_id: string;
    name: string;
    healthie_product_id: string | null;
    reorder_point: string;
    category: string;
    supplier: string | null;
    unit_cost: string | null;
    sell_price: string | null;
    created_at: Date;
  }>(`
    INSERT INTO peptide_products (name, category, sku, reorder_point, supplier, unit_cost, sell_price, label_directions, healthie_product_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING product_id, name, healthie_product_id, sku, reorder_point, category, supplier, unit_cost, sell_price, label_directions, created_at
  `, [
    data.name,
    data.category,
    data.sku || null,
    data.reorder_point ?? 5,
    data.supplier || null,
    data.unit_cost || null,
    data.sell_price || null,
    data.label_directions || null,
    data.healthie_product_id || null,
  ]);

  return {
    product_id: product.product_id,
    name: product.name,
    healthie_product_id: product.healthie_product_id,
    reorder_point: Number(product.reorder_point),
    category: product.category,
    sku: product.sku || undefined,
    supplier: product.supplier,
    unit_cost: product.unit_cost ? Number(product.unit_cost) : null,
    sell_price: product.sell_price ? Number(product.sell_price) : null,
    label_directions: product.label_directions || null,
    active: true,
    total_ordered: 0,
    total_dispensed: 0,
    current_stock: 0,
    status: 'Reorder' as const,
    created_at: product.created_at,
  };
}

/**
 * Deactivate a peptide product (soft delete - preserves history)
 */
export async function deactivatePeptideProduct(productId: string): Promise<{ name: string }> {
  const [result] = await query<{ name: string }>(
    `UPDATE peptide_products SET active = false WHERE product_id = $1 RETURNING name`,
    [productId]
  );
  if (!result) throw new Error('Product not found');
  return { name: result.name };
}

/**
 * Reactivate a peptide product
 */
export async function reactivatePeptideProduct(productId: string): Promise<{ name: string }> {
  const [result] = await query<{ name: string }>(
    `UPDATE peptide_products SET active = true WHERE product_id = $1 RETURNING name`,
    [productId]
  );
  if (!result) throw new Error('Product not found');
  return { name: result.name };
}

/**
 * Update peptide product fields
 */
export async function updatePeptideProduct(
  productId: string,
  data: {
    name?: string;
    category?: string;
    sku?: string | null;
    reorder_point?: number;
    supplier?: string | null;
    unit_cost?: number | null;
    sell_price?: number | null;
    label_directions?: string | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(data.name); }
  if (data.category !== undefined) { sets.push(`category = $${idx++}`); vals.push(data.category); }
  if (data.sku !== undefined) { sets.push(`sku = $${idx++}`); vals.push(data.sku); }
  if (data.reorder_point !== undefined) { sets.push(`reorder_point = $${idx++}`); vals.push(data.reorder_point); }
  if (data.supplier !== undefined) { sets.push(`supplier = $${idx++}`); vals.push(data.supplier); }
  if (data.unit_cost !== undefined) { sets.push(`unit_cost = $${idx++}`); vals.push(data.unit_cost); }
  if (data.sell_price !== undefined) { sets.push(`sell_price = $${idx++}`); vals.push(data.sell_price); }
  if (data.label_directions !== undefined) { sets.push(`label_directions = $${idx++}`); vals.push(data.label_directions); }

  if (sets.length === 0) return;

  vals.push(productId);
  await query(`UPDATE peptide_products SET ${sets.join(', ')} WHERE product_id = $${idx}`, vals);
}
// ==================== PEPTIDE SALES (STUB - FEATURE NOT YET IMPLEMENTED) ====================

export interface PeptideSale {
  sale_id: string;
  product_id: string;
  quantity: number;
  sale_date: string;
  patient_name: string | null;
  healthie_client_id: string | null;
  healthie_billing_item_id: string | null;
  paid: boolean;
  notes: string | null;
  created_at: Date;
}

/**
 * Fetch peptide sales history (stub - returns empty array until feature implemented)
 */
export async function fetchPeptideSales(): Promise<PeptideSale[]> {
  // TODO: Implement when peptide_sales table is created
  console.log('Warning: fetchPeptideSales is not yet implemented');
  return [];
}

/**
 * Create peptide sale record (stub - throws until feature implemented)
 */
export async function createPeptideSale(data: {
  product_id: string;
  quantity?: number;
  sale_date: string;
  patient_name?: string;
  healthie_client_id?: string;
  healthie_billing_item_id?: string;
  paid?: boolean;
  notes?: string;
}): Promise<PeptideSale> {
  // TODO: Implement when peptide_sales table is created
  throw new Error('createPeptideSale is not yet implemented - peptide_sales table needs to be created');
}

/**
 * Fetch peptide financial metrics (Revenue & Top Sellers)
 */
export interface PeptideFinancials {
  revenue_today: number;
  revenue_7d: number;
  revenue_30d: number;
  top_sellers: Array<{ name: string; quantity: number; revenue: number }>;
}

export async function fetchPeptideFinancials(): Promise<PeptideFinancials> {
  const [result] = await query<{
    revenue_today: string;
    revenue_7d: string;
    revenue_30d: string;
    top_sellers: Array<{ name: string; quantity: number; revenue: number }>;
  }>(`
    WITH financial_stats AS (
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(d.sale_date, (d.created_at AT TIME ZONE 'America/Phoenix')::date) = (NOW() AT TIME ZONE 'America/Phoenix')::date
          THEN d.quantity * COALESCE(p.sell_price, 0) ELSE 0 END), 0) as revenue_today,
        COALESCE(SUM(CASE WHEN COALESCE(d.sale_date, (d.created_at AT TIME ZONE 'America/Phoenix')::date) >= (NOW() AT TIME ZONE 'America/Phoenix')::date - 7 THEN d.quantity * COALESCE(p.sell_price, 0) ELSE 0 END), 0) as revenue_7d,
        COALESCE(SUM(CASE WHEN COALESCE(d.sale_date, (d.created_at AT TIME ZONE 'America/Phoenix')::date) >= (NOW() AT TIME ZONE 'America/Phoenix')::date - 30 THEN d.quantity * COALESCE(p.sell_price, 0) ELSE 0 END), 0) as revenue_30d
      FROM peptide_dispenses d
      JOIN peptide_products p ON d.product_id = p.product_id
      WHERE d.status = 'Paid'
    ),
    top_products AS (
      SELECT 
        p.name, 
        SUM(d.quantity)::int as quantity,
        COALESCE(SUM(d.quantity * COALESCE(p.sell_price, 0)), 0) as revenue
      FROM peptide_dispenses d
      JOIN peptide_products p ON d.product_id = p.product_id
      WHERE d.status = 'Paid' AND COALESCE(d.sale_date, (d.created_at AT TIME ZONE 'America/Phoenix')::date) >= (NOW() AT TIME ZONE 'America/Phoenix')::date - 30
      GROUP BY p.name
      ORDER BY revenue DESC
      LIMIT 5
    )
    SELECT
      (SELECT revenue_today FROM financial_stats) as revenue_today,
      (SELECT revenue_7d FROM financial_stats) as revenue_7d,
      (SELECT revenue_30d FROM financial_stats) as revenue_30d,
      (SELECT COALESCE(json_agg(tp), '[]'::json) FROM top_products tp) as top_sellers
  `);

  return {
    revenue_today: Number(result?.revenue_today || 0),
    revenue_7d: Number(result?.revenue_7d || 0),
    revenue_30d: Number(result?.revenue_30d || 0),
    top_sellers: result?.top_sellers || []
  };
}

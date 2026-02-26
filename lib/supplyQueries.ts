/**
 * Supply PAR System — Database Queries
 * Separate from DEA inventory (lib/inventoryQueries.ts)
 */
import { query } from './db';

/* ─── Types ─── */

export interface SupplyLocation {
    id: string;
    name: string;
    address: string | null;
    active: boolean;
}

export interface SupplyItem {
    id: number;
    name: string;
    category: string;
    unit: string;
    par_level: number | null;
    reorder_qty: number | null;
    notes: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
    // Joined from supply_counts
    qty_on_hand: number;
    location: string;
    counted_at: string | null;
    counted_by: string | null;
    // Computed
    status: 'ok' | 'low' | 'reorder' | 'out';
}

export interface SupplyCountEntry {
    item_id: number;
    qty: number;
    location?: string;
}

export interface SupplyUseEntry {
    item_id: number;
    qty_used: number;
    location?: string;
    healthie_patient_id?: string;
    healthie_patient_name?: string;
    notes?: string;
}

export interface SupplyHistoryRow {
    id: number;
    item_id: number;
    item_name: string;
    category: string;
    location: string;
    qty_before: number | null;
    qty_after: number;
    change_type: string;
    notes: string | null;
    healthie_patient_id: string | null;
    healthie_patient_name: string | null;
    recorded_by: string | null;
    recorded_at: string;
}

/* ─── Queries ─── */

function computeStatus(qty: number, par: number | null): SupplyItem['status'] {
    if (qty <= 0) return 'out';
    if (par == null) return 'ok';
    if (qty <= par * 0.5) return 'reorder';
    if (qty <= par) return 'low';
    return 'ok';
}

export async function fetchSupplyLocations(): Promise<SupplyLocation[]> {
    return query<SupplyLocation>(
        `SELECT * FROM supply_locations WHERE active = true ORDER BY id DESC`
    );
}

export async function fetchSupplyItems(location: string = 'mens_health', category?: string): Promise<SupplyItem[]> {
    const sql = `
    SELECT si.*, 
           COALESCE(sc.qty_on_hand, 0) AS qty_on_hand,
           COALESCE(sc.location, $1) AS location,
           sc.counted_at, sc.counted_by
    FROM supply_items si
    LEFT JOIN supply_counts sc ON sc.item_id = si.id AND sc.location = $1
    WHERE si.active = true
    ${category ? 'AND si.category = $2' : ''}
    ORDER BY si.category, si.name
  `;
    const params = category ? [location, category] : [location];
    const rows = await query<any>(sql, params);

    return rows.map(r => ({
        ...r,
        qty_on_hand: Number(r.qty_on_hand ?? 0),
        status: computeStatus(Number(r.qty_on_hand ?? 0), r.par_level),
    }));
}

export async function fetchSupplyCategories(): Promise<string[]> {
    const rows = await query<{ category: string }>(
        `SELECT DISTINCT category FROM supply_items WHERE active = true ORDER BY category`
    );
    return rows.map(r => r.category);
}

export async function fetchSupplyAlerts(location: string = 'mens_health'): Promise<SupplyItem[]> {
    const items = await fetchSupplyItems(location);
    return items.filter(i => i.status === 'reorder' || i.status === 'out');
}

export async function recordSupplyCount(
    itemId: number,
    qty: number,
    location: string = 'mens_health',
    recordedBy?: string,
    notes?: string
): Promise<void> {
    // Get current qty
    const current = await query<{ qty_on_hand: number }>(
        `SELECT qty_on_hand FROM supply_counts WHERE item_id = $1 AND location = $2`,
        [itemId, location]
    );
    const qtyBefore = current.length > 0 ? Number(current[0].qty_on_hand) : 0;

    // Upsert count
    await query(
        `INSERT INTO supply_counts (item_id, qty_on_hand, location, counted_at, counted_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (item_id, location) DO UPDATE SET
       qty_on_hand = $2, counted_at = NOW(), counted_by = $4`,
        [itemId, qty, location, recordedBy]
    );

    // History
    await query(
        `INSERT INTO supply_count_history (item_id, location, qty_before, qty_after, change_type, notes, recorded_by)
     VALUES ($1, $2, $3, $4, 'count', $5, $6)`,
        [itemId, location, qtyBefore, qty, notes, recordedBy]
    );
}

export async function bulkRecordCounts(
    entries: SupplyCountEntry[],
    recordedBy?: string
): Promise<void> {
    for (const entry of entries) {
        await recordSupplyCount(entry.item_id, entry.qty, entry.location ?? 'mens_health', recordedBy);
    }
}

export async function recordSupplyUse(
    entry: SupplyUseEntry,
    recordedBy?: string
): Promise<void> {
    const location = entry.location ?? 'mens_health';

    // Get current qty
    const current = await query<{ qty_on_hand: number }>(
        `SELECT qty_on_hand FROM supply_counts WHERE item_id = $1 AND location = $2`,
        [entry.item_id, location]
    );
    const qtyBefore = current.length > 0 ? Number(current[0].qty_on_hand) : 0;
    const qtyAfter = Math.max(0, qtyBefore - entry.qty_used);

    // Update count
    await query(
        `INSERT INTO supply_counts (item_id, qty_on_hand, location, counted_at, counted_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (item_id, location) DO UPDATE SET
       qty_on_hand = $2, counted_at = NOW(), counted_by = $4`,
        [entry.item_id, qtyAfter, location, recordedBy]
    );

    // History with patient association
    await query(
        `INSERT INTO supply_count_history 
     (item_id, location, qty_before, qty_after, change_type, notes, healthie_patient_id, healthie_patient_name, recorded_by)
     VALUES ($1, $2, $3, $4, 'use', $5, $6, $7, $8)`,
        [entry.item_id, location, qtyBefore, qtyAfter, entry.notes,
        entry.healthie_patient_id, entry.healthie_patient_name, recordedBy]
    );
}

export async function fetchSupplyHistory(
    itemId?: number,
    limit: number = 50
): Promise<SupplyHistoryRow[]> {
    const sql = `
    SELECT h.*, si.name AS item_name, si.category
    FROM supply_count_history h
    JOIN supply_items si ON si.id = h.item_id
    ${itemId ? 'WHERE h.item_id = $1' : ''}
    ORDER BY h.recorded_at DESC
    LIMIT ${itemId ? '$2' : '$1'}
  `;
    const params = itemId ? [itemId, limit] : [limit];
    return query<SupplyHistoryRow>(sql, params);
}

export async function createSupplyItem(
    name: string,
    category: string,
    unit: string = 'each',
    parLevel?: number,
    reorderQty?: number,
    notes?: string
): Promise<number> {
    const rows = await query<{ id: number }>(
        `INSERT INTO supply_items (name, category, unit, par_level, reorder_qty, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
        [name, category, unit, parLevel ?? null, reorderQty ?? null, notes ?? null]
    );
    return rows[0].id;
}

export async function updateSupplyItem(
    id: number,
    updates: Partial<{ name: string; category: string; unit: string; par_level: number | null; reorder_qty: number | null; notes: string | null; active: boolean }>
): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
        fields.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = NOW()`);
    values.push(id);

    await query(
        `UPDATE supply_items SET ${fields.join(', ')} WHERE id = $${idx}`,
        values
    );
}

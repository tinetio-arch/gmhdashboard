/**
 * Pharmacy Order Queries - All specialty pharmacies
 * Strive (Tirzepatide), Farmakaio, Olympia, TopRX, Carrie Boyd
 */

import { query } from './db';

// ==================== SHARED INTERFACE ====================

export interface PharmacyOrder {
    order_id: string;
    patient_name: string;
    medication_ordered: string | null;
    dose: string | null;
    order_number: string | null;
    date_ordered: string | null;
    status: string;
    order_in_chart: boolean;
    ordered_to: string | null;
    patient_received: string | null;
    notes: string | null;
    is_office_use: boolean;
    healthie_patient_id: string | null;
    healthie_patient_name: string | null;
    pdf_s3_key: string | null;
    healthie_document_id: string | null;
    uploaded_to_healthie_at: string | null;
    created_at: string;
}

export type PharmacyType = 'tirzepatide' | 'farmakaio' | 'olympia' | 'toprx' | 'carrieboyd';

const TABLE_NAMES: Record<PharmacyType, string> = {
    tirzepatide: 'tirzepatide_orders',
    farmakaio: 'farmakaio_orders',
    olympia: 'olympia_orders',
    toprx: 'toprx_orders',
    carrieboyd: 'carrieboyd_orders',
};

// ==================== GENERIC FUNCTIONS ====================

export async function fetchPharmacyOrders(pharmacy: PharmacyType): Promise<PharmacyOrder[]> {
    const table = TABLE_NAMES[pharmacy];
    const medicationCol = pharmacy === 'tirzepatide' ? 'vials_ordered as medication_ordered' : 'medication_ordered';
    return await query<PharmacyOrder>(
        `SELECT order_id, patient_name, ${medicationCol}, dose, order_number, date_ordered, status, 
                order_in_chart, ordered_to, patient_received, notes, is_office_use,
                healthie_patient_id, healthie_patient_name,
                pdf_s3_key, healthie_document_id, uploaded_to_healthie_at, created_at 
         FROM ${table} ORDER BY date_ordered DESC, created_at DESC`
    );
}

export async function getPharmacyOrder(pharmacy: PharmacyType, orderId: string): Promise<PharmacyOrder | null> {
    const table = TABLE_NAMES[pharmacy];
    const medicationCol = pharmacy === 'tirzepatide' ? 'vials_ordered as medication_ordered' : 'medication_ordered';
    const result = await query<PharmacyOrder>(
        `SELECT order_id, patient_name, ${medicationCol}, dose, order_number, date_ordered, status, 
                order_in_chart, ordered_to, patient_received, notes, is_office_use,
                healthie_patient_id, healthie_patient_name,
                pdf_s3_key, healthie_document_id, uploaded_to_healthie_at, created_at 
         FROM ${table} WHERE order_id = $1`,
        [orderId]
    );
    return result[0] || null;
}

export async function createPharmacyOrder(pharmacy: PharmacyType, data: {
    patient_name: string;
    medication_ordered?: string;
    dose?: string;
    order_number?: string;
    date_ordered?: string;
    status?: string;
    order_in_chart?: boolean;
    ordered_to?: string;
    patient_received?: string;
    notes?: string;
    is_office_use?: boolean;
    healthie_patient_id?: string;
    healthie_patient_name?: string;
}): Promise<PharmacyOrder> {
    const table = TABLE_NAMES[pharmacy];
    const medicationCol = pharmacy === 'tirzepatide' ? 'vials_ordered' : 'medication_ordered';
    const result = await query<PharmacyOrder>(
        `INSERT INTO ${table} 
         (patient_name, ${medicationCol}, dose, order_number, date_ordered, status, order_in_chart, ordered_to, patient_received, notes, is_office_use, healthie_patient_id, healthie_patient_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *, ${medicationCol} as medication_ordered`,
        [
            data.patient_name,
            data.medication_ordered || null,
            data.dose || null,
            data.order_number || null,
            data.date_ordered || null,
            data.status || 'Pending',
            data.order_in_chart || false,
            data.ordered_to || null,
            data.patient_received || null,
            data.notes || null,
            data.is_office_use || false,
            data.healthie_patient_id || null,
            data.healthie_patient_name || null,
        ]
    );
    return result[0];
}

export async function updatePharmacyOrder(
    pharmacy: PharmacyType,
    orderId: string,
    data: Partial<Omit<PharmacyOrder, 'order_id' | 'created_at'>>
): Promise<void> {
    const table = TABLE_NAMES[pharmacy];
    const medicationCol = pharmacy === 'tirzepatide' ? 'vials_ordered' : 'medication_ordered';

    const updates: string[] = [];
    const params: unknown[] = [orderId];
    let idx = 2;

    if (data.patient_name !== undefined) { updates.push(`patient_name = $${idx++}`); params.push(data.patient_name); }
    if (data.medication_ordered !== undefined) { updates.push(`${medicationCol} = $${idx++}`); params.push(data.medication_ordered); }
    if (data.dose !== undefined) { updates.push(`dose = $${idx++}`); params.push(data.dose); }
    if (data.order_number !== undefined) { updates.push(`order_number = $${idx++}`); params.push(data.order_number); }
    if (data.date_ordered !== undefined) { updates.push(`date_ordered = $${idx++}`); params.push(data.date_ordered); }
    if (data.status !== undefined) { updates.push(`status = $${idx++}`); params.push(data.status); }
    if (data.order_in_chart !== undefined) { updates.push(`order_in_chart = $${idx++}`); params.push(data.order_in_chart); }
    if (data.ordered_to !== undefined) { updates.push(`ordered_to = $${idx++}`); params.push(data.ordered_to); }
    if (data.patient_received !== undefined) { updates.push(`patient_received = $${idx++}`); params.push(data.patient_received); }
    if (data.notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(data.notes); }
    if (data.is_office_use !== undefined) { updates.push(`is_office_use = $${idx++}`); params.push(data.is_office_use); }
    if (data.healthie_patient_id !== undefined) { updates.push(`healthie_patient_id = $${idx++}`); params.push(data.healthie_patient_id); }
    if (data.healthie_patient_name !== undefined) { updates.push(`healthie_patient_name = $${idx++}`); params.push(data.healthie_patient_name); }
    if (data.pdf_s3_key !== undefined) { updates.push(`pdf_s3_key = $${idx++}`); params.push(data.pdf_s3_key); }
    if (data.healthie_document_id !== undefined) { updates.push(`healthie_document_id = $${idx++}`); params.push(data.healthie_document_id); }
    if (data.uploaded_to_healthie_at !== undefined) { updates.push(`uploaded_to_healthie_at = $${idx++}`); params.push(data.uploaded_to_healthie_at); }

    if (updates.length === 0) return;

    updates.push(`updated_at = NOW()`);
    await query(`UPDATE ${table} SET ${updates.join(', ')} WHERE order_id = $1`, params);
}

export async function deletePharmacyOrder(pharmacy: PharmacyType, orderId: string): Promise<void> {
    const table = TABLE_NAMES[pharmacy];
    await query(`DELETE FROM ${table} WHERE order_id = $1`, [orderId]);
}

// ==================== LEGACY EXPORTS ====================

export { PharmacyOrder as FarmakaioOrder };
export const fetchTirzepatideOrders = () => fetchPharmacyOrders('tirzepatide');
export const fetchFarmakaioOrders = () => fetchPharmacyOrders('farmakaio');
export const fetchOlympiaOrders = () => fetchPharmacyOrders('olympia');
export const fetchTopRxOrders = () => fetchPharmacyOrders('toprx');
export const fetchCarrieBoydOrders = () => fetchPharmacyOrders('carrieboyd');

// Legacy create/update wrappers
export const createFarmakaioOrder = (data: Parameters<typeof createPharmacyOrder>[1]) => createPharmacyOrder('farmakaio', data);
export const updateFarmakaioOrder = (orderId: string, data: Parameters<typeof updatePharmacyOrder>[2]) => updatePharmacyOrder('farmakaio', orderId, data);
export const createTirzepatideOrder = (data: Parameters<typeof createPharmacyOrder>[1]) => createPharmacyOrder('tirzepatide', data);
export const updateTirzepatideOrder = (orderId: string, data: Parameters<typeof updatePharmacyOrder>[2]) => updatePharmacyOrder('tirzepatide', orderId, data);

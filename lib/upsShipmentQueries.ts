/**
 * Database queries for UPS shipment records.
 * Table: ups_shipments
 */

import { query } from './db';

export type UPSShipmentRow = {
    id: number;
    patient_id: string;
    tracking_number: string;
    shipment_id: string | null;
    service_code: string;
    service_name: string | null;
    status: string;
    ship_to_name: string;
    ship_to_address: string;
    ship_to_city: string | null;
    ship_to_state: string | null;
    ship_to_zip: string | null;
    package_weight: number | null;
    package_description: string | null;
    shipping_cost: number | null;
    label_format: string | null;
    label_data: string | null;
    estimated_delivery: string | null;
    actual_delivery: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    voided_at: string | null;
    notes: string | null;
};

export type CreateShipmentData = {
    patientId: string;
    trackingNumber: string;
    shipmentId?: string;
    serviceCode: string;
    serviceName?: string;
    shipToName: string;
    shipToAddress: string;
    shipToCity?: string;
    shipToState?: string;
    shipToZip?: string;
    packageWeight?: number;
    packageDescription?: string;
    shippingCost?: number;
    labelFormat?: string;
    labelData?: string;
    estimatedDelivery?: string;
    createdBy?: string;
    notes?: string;
};

export async function createShipmentRecord(data: CreateShipmentData): Promise<UPSShipmentRow> {
    const [row] = await query<UPSShipmentRow>(
        `INSERT INTO ups_shipments (
      patient_id, tracking_number, shipment_id, service_code, service_name,
      ship_to_name, ship_to_address, ship_to_city, ship_to_state, ship_to_zip,
      package_weight, package_description, shipping_cost,
      label_format, label_data, estimated_delivery, created_by, notes
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16, $17, $18
    ) RETURNING *`,
        [
            data.patientId,
            data.trackingNumber,
            data.shipmentId || null,
            data.serviceCode,
            data.serviceName || null,
            data.shipToName,
            data.shipToAddress,
            data.shipToCity || null,
            data.shipToState || null,
            data.shipToZip || null,
            data.packageWeight || null,
            data.packageDescription || null,
            data.shippingCost || null,
            data.labelFormat || 'GIF',
            data.labelData || null,
            data.estimatedDelivery || null,
            data.createdBy || null,
            data.notes || null,
        ]
    );
    return row;
}

export async function getShipmentsForPatient(
    patientId: string,
    limit: number = 50,
): Promise<UPSShipmentRow[]> {
    return query<UPSShipmentRow>(
        `SELECT * FROM ups_shipments
     WHERE patient_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
        [patientId, limit]
    );
}

export async function getShipmentById(id: number): Promise<UPSShipmentRow | null> {
    const [row] = await query<UPSShipmentRow>(
        `SELECT * FROM ups_shipments WHERE id = $1`,
        [id]
    );
    return row ?? null;
}

export async function updateShipmentStatus(
    id: number,
    status: string,
    details?: { actualDelivery?: string; notes?: string },
): Promise<void> {
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params: any[] = [id, status];
    let idx = 3;

    if (details?.actualDelivery) {
        sets.push(`actual_delivery = $${idx}`);
        params.push(details.actualDelivery);
        idx++;
    }
    if (details?.notes) {
        sets.push(`notes = COALESCE(notes, '') || E'\\n' || $${idx}`);
        params.push(details.notes);
        idx++;
    }

    await query(`UPDATE ups_shipments SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function voidShipmentRecord(id: number): Promise<void> {
    await query(
        `UPDATE ups_shipments
     SET status = 'voided', voided_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
        [id]
    );
}

import { query } from './db';
import {
  createDispense,
  signDispense as signDispenseRecord,
  type NewDispenseInput,
} from './inventoryQueries';
import { createOrUpdateAudit } from './auditQueries';

/**
 * DEA / Controlled Dispense domain module
 * ---------------------------------------
 * Wraps all logic related to controlled substance dispensing, signatures, and
 * compliance reporting.
 */

export type DispenseInput = NewDispenseInput;

export type DispenseRecord = {
  dispenseId: string;
  patientId: string | null;
  patientName: string | null;
  medication: string | null;
  quantity: number | null;
  dispensedAt: string | null;
  signatureStatus: string | null;
};

export type DeaReport = {
  start: string;
  end: string;
  totalDispenses: number;
  unsignedDispenses: number;
  entries: DispenseRecord[];
};

export interface DeaService {
  recordDispense(input: DispenseInput): Promise<DispenseRecord>;
  signDispense(input: {
    dispenseId: string;
    signerUserId: string;
    signerRole: string;
    note?: string;
    ip?: string | null;
  }): Promise<void>;
  getUnsignedDispenses(limit?: number): Promise<DispenseRecord[]>;
  generateDeaReport(range: { start: string; end: string }): Promise<DeaReport>;
  reconcileInventory(input: { performedByUserId: string; notes?: string | null }): Promise<{
    success: boolean;
    auditId: string;
  }>;
}

function mapDispenseRow(row: any): DispenseRecord {
  return {
    dispenseId: row.dispense_id,
    patientId: row.patient_id ?? null,
    patientName: row.patient_name ?? null,
    medication: row.medication ?? null,
    quantity: row.total_amount !== undefined && row.total_amount !== null ? Number(row.total_amount) : null,
    dispensedAt: row.dispensed_at ?? null,
    signatureStatus: row.signature_status ?? null,
  };
}

async function fetchDispenseSnapshot(dispenseId: string): Promise<DispenseRecord> {
  const rows = await query(
    `
      SELECT
        d.dispense_id,
        d.patient_id,
        COALESCE(p.full_name, d.patient_name) AS patient_name,
        COALESCE(dt.dea_drug_name, v.dea_drug_name) AS medication,
        d.total_amount,
        COALESCE(dt.transaction_time::text, d.dispense_date::text) AS dispensed_at,
        COALESCE(d.signature_status, 'awaiting_signature') AS signature_status
      FROM dispenses d
      LEFT JOIN patients p ON p.patient_id = d.patient_id
      LEFT JOIN vials v ON v.vial_id = d.vial_id
      LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
      WHERE d.dispense_id = $1
    `,
    [dispenseId]
  );
  if (!rows.length) {
    throw new Error(`Dispense ${dispenseId} not found.`);
  }
  return mapDispenseRow(rows[0]);
}

export const deaService: DeaService = {
  async recordDispense(input) {
    const result = await createDispense(input);
    return fetchDispenseSnapshot(result.dispenseId);
  },

  async signDispense(input) {
    await signDispenseRecord({
      dispenseId: input.dispenseId,
      signerUserId: input.signerUserId,
      signerRole: input.signerRole,
      signatureNote: input.note ?? null,
      signedIp: input.ip ?? null,
    });
  },

  async getUnsignedDispenses(limit = 50) {
    const rows = await query(
      `
        SELECT
          d.dispense_id,
          d.patient_id,
          COALESCE(p.full_name, d.patient_name) AS patient_name,
          COALESCE(dt.dea_drug_name, v.dea_drug_name) AS medication,
          d.total_amount,
          d.dispense_date::text AS dispensed_at,
          COALESCE(d.signature_status, 'awaiting_signature') AS signature_status
        FROM dispenses d
        LEFT JOIN patients p ON p.patient_id = d.patient_id
        LEFT JOIN vials v ON v.vial_id = d.vial_id
        LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
        WHERE COALESCE(d.signature_status, 'awaiting_signature') <> 'signed'
        ORDER BY d.dispense_date DESC
        LIMIT $1
      `,
      [limit]
    );
    return rows.map(mapDispenseRow);
  },

  async generateDeaReport(range) {
    const rows = await query(
      `
        SELECT
          d.dispense_id,
          d.patient_id,
          COALESCE(p.full_name, d.patient_name) AS patient_name,
          COALESCE(dt.dea_drug_name, v.dea_drug_name) AS medication,
          d.total_amount,
          COALESCE(dt.transaction_time::text, d.dispense_date::text) AS dispensed_at,
          COALESCE(d.signature_status, 'awaiting_signature') AS signature_status
        FROM dispenses d
        LEFT JOIN patients p ON p.patient_id = d.patient_id
        LEFT JOIN vials v ON v.vial_id = d.vial_id
        LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
        WHERE COALESCE(dt.transaction_time, d.dispense_date::timestamp) BETWEEN $1::timestamp AND $2::timestamp
        ORDER BY COALESCE(dt.transaction_time, d.dispense_date::timestamp) DESC
      `,
      [range.start, range.end]
    );

    const totalDispenses = rows.length;
    const unsignedDispenses = rows.filter(
      (row) => (row.signature_status ?? 'awaiting_signature') !== 'signed'
    ).length;

    return {
      start: range.start,
      end: range.end,
      totalDispenses,
      unsignedDispenses,
      entries: rows.map(mapDispenseRow),
    };
  },

  async reconcileInventory({ performedByUserId, notes = null }) {
    const record = await createOrUpdateAudit({
      performedBy: performedByUserId,
      notes,
    });

    return {
      success: true,
      auditId: record.audit_id,
    };
  },
};


import type { PoolClient } from 'pg';
import { getPool, query } from './db';
import { recordDispenseEvent } from './dispenseHistory';
import {
  DEFAULT_TESTOSTERONE_DEA_CODE,
  DEFAULT_TESTOSTERONE_VENDOR,
  TESTOSTERONE_VENDORS,
  normalizeTestosteroneVendor
} from './testosterone';

export type VialRow = {
  vial_id: string;
  external_id: string | null;
  size_ml: string | null;
  remaining_volume_ml: string | null;
  status: string | null;
  expiration_date: string | null;
  date_received: string | null;
  lot_number: string | null;
  dea_drug_name: string | null;
  dea_drug_code: string | null;
  controlled_substance: boolean | null;
  location: string | null;
  notes: string | null;
};

export type InventorySummary = {
  active_vials: number;
  expired_vials: number;
  total_remaining_ml: number;
};

export type TransactionRow = {
  dispense_id: string;
  dispense_date: string | null;
  transaction_type: string | null;
  vial_external_id: string | null;
  patient_name: string | null;
  patient_dob: string | null;
  total_dispensed_ml: string | null;
  syringe_count: number | null;
  dose_per_syringe_ml: string | null;
  waste_ml: string | null;
  total_amount: string | null;
  notes: string | null;
  prescriber: string | null;
  dea_schedule: string | null;
  dea_drug_name: string | null;
  dea_drug_code: string | null;
  units: string | null;
  dispensed_total_vial: string | null;
  remaining_volume_ml: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  signed_by: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signature_note: string | null;
  signature_status: string | null;
  prescribing_provider_id: string | null;
  prescribing_provider_name: string | null;
};

export type ProviderSignatureRow = {
  dispense_id: string;
  dispense_date: string | null;
  vial_external_id: string | null;
  transaction_type: string | null;
  patient_name: string | null;
  total_dispensed_ml: string | null;
  waste_ml: string | null;
  total_amount: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  signed_by: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signature_status: string | null;
  signature_note: string | null;
};

export type ProviderSignatureSummary = {
  pending_count: number;
  most_recent_signed_at: string | null;
};

export type PatientDispenseRow = {
  dispense_id: string;
  dispense_date: string | null;
  transaction_type: string | null;
  vial_external_id: string | null;
  total_amount: string | null;
  total_dispensed_ml: string | null;
  waste_ml: string | null;
  syringe_count: number | null;
  dose_per_syringe_ml: string | null;
  notes: string | null;
  created_by_name: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
};

export type DispenseHistoryEvent = {
  event_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_role: string | null;
  event_payload: Record<string, unknown> | null;
  created_at: string;
  actor_display_name: string | null;
};

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const stringified = String(value).trim();
  if (!stringified) return null;
  // Handle timestamp strings by extracting the date portion.
  const isoCandidate = stringified.includes('T') ? stringified : `${stringified}T00:00:00`;
  const parsed = new Date(isoCandidate);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return stringified;
}

function normalizeNumeric(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null;
  }
  const stringified = String(value).trim();
  return stringified === '' ? null : stringified;
}

function resolveVendorName(
  candidate: string | null | undefined,
  sizeMl: number | null | undefined
): (typeof TESTOSTERONE_VENDORS)[number] | null {
  const normalized = normalizeTestosteroneVendor(candidate ?? undefined);
  if (normalized) {
    return normalized;
  }
  if (sizeMl !== null && sizeMl !== undefined) {
    const numeric = Number(sizeMl);
    if (Number.isFinite(numeric)) {
      if (numeric >= 20) {
        return TESTOSTERONE_VENDORS[0];
      }
      if (numeric > 0) {
        return TESTOSTERONE_VENDORS[1];
      }
    }
  }
  return null;
}

function normalizeVialRow(row: {
  vial_id: string;
  external_id: string | null;
  size_ml: string | null;
  remaining_volume_ml: string | null;
  status: string | null;
  expiration_date: string | null;
  date_received: string | null;
  lot_number: string | null;
  dea_drug_name: string | null;
  dea_drug_code: string | null;
  controlled_substance: boolean | null;
  location: string | null;
  notes: string | null;
}): VialRow {
  return {
    vial_id: row.vial_id,
    external_id: row.external_id,
    size_ml: normalizeNumeric(row.size_ml),
    remaining_volume_ml: normalizeNumeric(row.remaining_volume_ml),
    status: row.status,
    expiration_date: normalizeDate(row.expiration_date),
    date_received: normalizeDate(row.date_received),
    lot_number: row.lot_number,
    dea_drug_name: row.dea_drug_name,
    dea_drug_code: row.dea_drug_code,
    controlled_substance: row.controlled_substance,
    location: row.location,
    notes: row.notes ?? null
  };
}

export async function fetchInventory(): Promise<VialRow[]> {
  const rows = await query<VialRow>(
    `SELECT
        vial_id,
        external_id,
        size_ml,
        remaining_volume_ml,
        status,
        expiration_date,
        date_received,
        lot_number,
        dea_drug_name,
        dea_drug_code,
        controlled_substance,
        location,
        notes
     FROM vials
     ORDER BY expiration_date ASC NULLS LAST, external_id ASC`
  );

  return rows.map((row) =>
    normalizeVialRow({
      vial_id: row.vial_id,
      external_id: row.external_id,
      size_ml: row.size_ml,
      remaining_volume_ml: row.remaining_volume_ml,
      status: row.status,
      expiration_date: row.expiration_date,
      date_received: row.date_received,
      lot_number: row.lot_number,
      dea_drug_name: row.dea_drug_name,
      dea_drug_code: row.dea_drug_code,
      controlled_substance: row.controlled_substance,
      location: row.location,
      notes: row.notes
    })
  );
}

export async function fetchInventorySummary(): Promise<InventorySummary> {
  const [row] = await query<{ active_vials: unknown; expired_vials: unknown; total_remaining_ml: unknown }>(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'Active') AS active_vials,
        COUNT(*) FILTER (WHERE status = 'Expired') AS expired_vials,
        COALESCE(SUM(remaining_volume_ml), 0) AS total_remaining_ml
     FROM vials`
  );
  return {
    active_vials: Number(row?.active_vials ?? 0),
    expired_vials: Number(row?.expired_vials ?? 0),
    total_remaining_ml: Number(row?.total_remaining_ml ?? 0)
  };
}

export async function fetchTransactions(limit = 250): Promise<TransactionRow[]> {
  return query<TransactionRow>(
    `SELECT
        d.dispense_id,
        d.dispense_date,
        d.transaction_type,
        d.vial_external_id,
        COALESCE(p.full_name, d.patient_name) AS patient_name,
        p.dob AS patient_dob,
        d.total_dispensed_ml,
        d.syringe_count,
        d.dose_per_syringe_ml,
        d.waste_ml,
        d.total_amount,
        d.notes,
        dt.prescriber,
        dt.dea_schedule,
        COALESCE(dt.dea_drug_name, v.dea_drug_name) AS dea_drug_name,
        COALESCE(dt.dea_drug_code, v.dea_drug_code) AS dea_drug_code,
        dt.units,
        CASE
          WHEN v.size_ml IS NOT NULL AND v.remaining_volume_ml IS NOT NULL
          THEN (v.size_ml - v.remaining_volume_ml)::text
          ELSE NULL
        END AS dispensed_total_vial,
        v.remaining_volume_ml::text AS remaining_volume_ml,
        d.created_by,
        cu.display_name AS created_by_name,
        d.created_by_role,
        d.signed_by,
        su.display_name AS signed_by_name,
        d.signed_at,
        d.signature_note,
        d.signature_status,
        d.prescribing_provider_id,
        pu.display_name AS prescribing_provider_name
     FROM dispenses d
     LEFT JOIN patients p ON p.patient_id = d.patient_id
     LEFT JOIN vials v ON v.vial_id = d.vial_id
     LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
     LEFT JOIN users cu ON cu.user_id = d.created_by
     LEFT JOIN users su ON su.user_id = d.signed_by
     LEFT JOIN users pu ON pu.user_id = d.prescribing_provider_id
     ORDER BY d.dispense_date DESC NULLS LAST, d.dispense_id DESC
     LIMIT $1`,
    [limit]
  );
}

export async function fetchProviderSignatureQueue(): Promise<ProviderSignatureRow[]> {
  return query<ProviderSignatureRow>(
    `SELECT
        dispense_id,
        dispense_date,
        vial_external_id,
        transaction_type,
        patient_name,
        total_dispensed_ml,
        waste_ml,
        total_amount,
        notes,
        created_by,
        created_by_name,
        created_by_role,
        signed_by,
        signed_by_name,
        signed_at,
        signature_status,
        signature_note
     FROM provider_signature_queue_v
     WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed'
     ORDER BY dispense_date DESC NULLS LAST, dispense_id DESC`
  );
}

export async function fetchProviderSignatureSummary(): Promise<ProviderSignatureSummary> {
  const [row] = await query<{ pending_count: unknown; most_recent_signed_at: string | null }>(
    `SELECT
        COUNT(*) FILTER (WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed') AS pending_count,
        MAX(signed_at)::text AS most_recent_signed_at
     FROM provider_signature_queue_v`
  );
  return {
    pending_count: Number(row?.pending_count ?? 0),
    most_recent_signed_at: row?.most_recent_signed_at ?? null
  };
}

export async function fetchDispensesForPatient(patientId: string, limit = 200): Promise<PatientDispenseRow[]> {
  return query<PatientDispenseRow>(
    `SELECT
        d.dispense_id,
        d.dispense_date,
        d.transaction_type,
        v.external_id AS vial_external_id,
        d.total_amount::text AS total_amount,
        d.total_dispensed_ml::text AS total_dispensed_ml,
        d.waste_ml::text AS waste_ml,
        d.syringe_count,
        d.dose_per_syringe_ml::text AS dose_per_syringe_ml,
        d.notes,
        cu.display_name AS created_by_name,
        su.display_name AS signed_by_name,
        d.signed_at::text AS signed_at
     FROM dispenses d
     LEFT JOIN vials v ON v.vial_id = d.vial_id
     LEFT JOIN users cu ON cu.user_id = d.created_by
     LEFT JOIN users su ON su.user_id = d.signed_by
     WHERE d.patient_id = $1
     ORDER BY COALESCE(d.dispense_date, NOW()) DESC, d.dispense_id DESC
     LIMIT $2`,
    [patientId, limit]
  );
}

export async function fetchDispenseHistory(dispenseId: string): Promise<DispenseHistoryEvent[]> {
  const rows = await query<{
    event_id: string;
    event_type: string;
    actor_user_id: string | null;
    actor_role: string | null;
    event_payload: unknown;
    created_at: string;
    actor_display_name: string | null;
  }>(
    `SELECT
        h.event_id,
        h.event_type,
        h.actor_user_id,
        h.actor_role,
        h.event_payload AS event_payload,
        h.created_at::text AS created_at,
        u.display_name AS actor_display_name
     FROM dispense_history h
     LEFT JOIN users u ON u.user_id = h.actor_user_id
     WHERE h.dispense_id = $1
     ORDER BY h.created_at DESC`,
    [dispenseId]
  );
  return rows.map((row) => ({
    ...row,
    event_payload:
      typeof row.event_payload === 'string'
        ? JSON.parse(row.event_payload)
        : (row.event_payload as Record<string, unknown> | null)
  }));
}

export type NewVialInput = {
  externalId?: string | null;
  lotNumber?: string | null;
  status?: string | null;
  remainingVolumeMl?: number | null;
  sizeMl?: number | null;
  expirationDate?: string | null;
  dateReceived?: string | null;
  deaDrugName?: string | null;
  deaDrugCode?: string | null;
  controlledSubstance?: boolean;
  location?: string | null;
  notes?: string | null;
};

async function generateNextVialId(client: PoolClient): Promise<string> {
  await client.query('LOCK TABLE vials IN SHARE ROW EXCLUSIVE MODE');
  const result = await client.query<{ next_id: string }>(
    `
      SELECT CONCAT('V', LPAD((COALESCE(MAX(REGEXP_REPLACE(external_id, '\\\\D', '', 'g')::integer), 0) + 1)::text, 4, '0')) AS next_id
        FROM vials
    `
  );
  return result.rows[0]?.next_id ?? 'V0001';
}

export async function createVial(input: NewVialInput): Promise<VialRow> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    let externalId = input.externalId ? String(input.externalId).trim() : '';
    if (!externalId) {
      externalId = await generateNextVialId(client);
    }

    const sizeMl = input.sizeMl ?? null;
    const remainingVolume =
      input.remainingVolumeMl !== undefined && input.remainingVolumeMl !== null ? input.remainingVolumeMl : sizeMl;

    const vendorMatch = resolveVendorName(input.deaDrugName, sizeMl);
    const finalVendor =
      vendorMatch ?? ((input.controlledSubstance ?? false) ? DEFAULT_TESTOSTERONE_VENDOR : null);
    const controlled = input.controlledSubstance ?? Boolean(finalVendor);
    const deaDrugCode = finalVendor ? DEFAULT_TESTOSTERONE_DEA_CODE : input.deaDrugCode ?? null;

    const result = await client.query<VialRow>(
      `
        INSERT INTO vials (
          external_id,
          lot_number,
          status,
          remaining_volume_ml,
          size_ml,
          expiration_date,
          date_received,
          dea_drug_name,
          dea_drug_code,
          controlled_substance,
          location,
          notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING
          vial_id,
          external_id,
          size_ml::text,
          remaining_volume_ml::text,
          status,
          expiration_date::text,
          date_received::text,
          lot_number,
          dea_drug_name,
          dea_drug_code,
          controlled_substance,
          location,
          notes
      `,
      [
        externalId,
        input.lotNumber ?? null,
        input.status ?? 'Active',
        remainingVolume ?? null,
        sizeMl ?? null,
        input.expirationDate ?? null,
        input.dateReceived ?? null,
        finalVendor,
        deaDrugCode,
        controlled,
        input.location ?? null,
        input.notes ?? null
      ]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateVial(
  vialId: string,
  fields: { deaDrugName?: string | null; deaDrugCode?: string | null }
): Promise<VialRow> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  let pendingCode: string | null | undefined;

  if (fields.deaDrugName !== undefined) {
    const raw = fields.deaDrugName?.trim() ?? '';
    const normalized = normalizeTestosteroneVendor(raw);
    const vendorToStore = normalized ?? (raw.length ? raw : null);
    updates.push(`dea_drug_name = $${index++}`);
    values.push(vendorToStore);

    if (normalized) {
      pendingCode = DEFAULT_TESTOSTERONE_DEA_CODE;
      updates.push(`controlled_substance = $${index++}`);
      values.push(true);
    } else if (!raw.length) {
      pendingCode = null;
      updates.push(`controlled_substance = $${index++}`);
      values.push(false);
    }
  }

  if (fields.deaDrugCode !== undefined) {
    pendingCode = fields.deaDrugCode ?? null;
  }

  if (pendingCode !== undefined) {
    updates.push(`dea_drug_code = $${index++}`);
    values.push(pendingCode);
  }

  if (updates.length === 0) {
    const [row] = await query<VialRow>(
      `SELECT vial_id,
              external_id,
              size_ml,
              remaining_volume_ml,
              status,
              expiration_date,
              date_received,
              lot_number,
              dea_drug_name,
              dea_drug_code,
              controlled_substance,
              location,
              notes
         FROM vials
        WHERE vial_id = $1`,
      [vialId]
    );
    if (!row) {
      throw new Error('Vial not found.');
    }
    return normalizeVialRow(row);
  }

  values.push(vialId);

  const [row] = await query<VialRow>(
    `UPDATE vials
        SET ${updates.join(', ')}
      WHERE vial_id = $${index}
      RETURNING vial_id,
                external_id,
                size_ml,
                remaining_volume_ml,
                status,
                expiration_date,
                date_received,
                lot_number,
                dea_drug_name,
                dea_drug_code,
                controlled_substance,
                location,
                notes`,
    values
  );

  if (!row) {
    throw new Error('Vial not found.');
  }

  return normalizeVialRow(row);
}

export type NewDispenseInput = {
  vialExternalId: string;
  dispenseDate: string;
  transactionType?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  totalDispensedMl?: number | null;
  syringeCount?: number | null;
  dosePerSyringeMl?: number | null;
  wasteMl?: number | null;
  totalAmount?: number | null;
  notes?: string | null;
  prescriber?: string | null;
  deaSchedule?: string | null;
  deaDrugName?: string | null;
  deaDrugCode?: string | null;
  units?: string | null;
  recordDea?: boolean;
  createdByUserId: string;
  createdByRole: string;
  prescribingProviderId?: string | null;
  signatureStatus?: string | null;
  signatureNote?: string | null;
};

export type CreateDispenseResult = {
  dispenseId: string;
  deaTransactionId: string | null;
  updatedRemainingMl: string | null;
};

const WASTE_PER_SYRINGE = 0.1;

export async function createDispense(input: NewDispenseInput): Promise<CreateDispenseResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const vialLookup = await client.query<{
      vial_id: string;
      controlled_substance: boolean | null;
      dea_drug_name: string | null;
      dea_drug_code: string | null;
      remaining_volume_ml: string | null;
    }>(
      `SELECT vial_id, controlled_substance, dea_drug_name, dea_drug_code, remaining_volume_ml
         FROM vials
        WHERE external_id = $1`,
      [input.vialExternalId.trim()]
    );

    if (vialLookup.rowCount === 0) {
      throw new Error(`Vial with external ID "${input.vialExternalId}" was not found.`);
    }

    const vialRow = vialLookup.rows[0];

    let patientId = input.patientId ?? null;
    if (!patientId && input.patientName) {
      const patientLookup = await client.query<{ patient_id: string }>(
        `SELECT patient_id
           FROM patients
          WHERE LOWER(full_name) = LOWER($1)
          LIMIT 1`,
        [input.patientName.trim()]
      );
      if (patientLookup.rowCount) {
        patientId = patientLookup.rows[0].patient_id;
      }
    }

    const prescribingProviderId = input.prescribingProviderId ?? null;

    const signatureStatus = input.signatureStatus ?? 'awaiting_signature';

    const dispenseDate = new Date(input.dispenseDate);
    if (Number.isNaN(dispenseDate.getTime())) {
      throw new Error('Dispense date is invalid.');
    }

    let syringeCount = input.syringeCount ?? null;
    if (syringeCount !== null) {
      if (!Number.isFinite(syringeCount) || !Number.isInteger(syringeCount)) {
        throw new Error('Syringe count must be a whole number.');
      }
      syringeCount = Math.trunc(syringeCount);
    }
    const dosePerSyringe = input.dosePerSyringeMl ?? null;

    let totalDispensedMl = input.totalDispensedMl ?? null;
    let wasteMl = input.wasteMl ?? null;

    if (syringeCount !== null && dosePerSyringe !== null) {
      const derivedDispense = Number((dosePerSyringe * syringeCount).toFixed(3));
      if (totalDispensedMl === null) {
        totalDispensedMl = derivedDispense;
      }
      const derivedWaste = Number((WASTE_PER_SYRINGE * syringeCount).toFixed(3));
      if (wasteMl === null) {
        wasteMl = derivedWaste;
      }
    }

    if (totalDispensedMl === null || Number.isNaN(totalDispensedMl)) {
      throw new Error('Unable to determine dispensed volume (mL).');
    }

    if (wasteMl === null || Number.isNaN(wasteMl)) {
      wasteMl = 0;
    }

    const totalAmount = input.totalAmount ?? Number((totalDispensedMl + wasteMl).toFixed(3));

    const dispenseInsert = await client.query<{ dispense_id: string }>(
      `
        INSERT INTO dispenses (
          vial_id,
          vial_external_id,
          patient_id,
          patient_name,
          dispense_date,
          transaction_type,
          total_dispensed_ml,
          syringe_count,
          dose_per_syringe_ml,
          waste_ml,
          total_amount,
          notes,
          prescriber,
          created_by,
          created_by_role,
          signature_status,
          signature_note,
          prescribing_provider_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING dispense_id
      `,
      [
        vialRow.vial_id,
        input.vialExternalId.trim(),
        patientId,
        input.patientName ?? null,
        dispenseDate.toISOString(),
        input.transactionType ?? null,
        totalDispensedMl,
        syringeCount,
        dosePerSyringe,
        wasteMl,
        totalAmount,
        input.notes ?? null,
        input.prescriber ?? null,
        input.createdByUserId,
        input.createdByRole,
        signatureStatus,
        input.signatureNote ?? null,
        prescribingProviderId
      ]
    );

    const dispenseId = dispenseInsert.rows[0].dispense_id;

    let updatedRemaining: string | null = vialRow.remaining_volume_ml ?? null;
    if (totalDispensedMl !== undefined || wasteMl !== undefined) {
      const remainingUpdate = await client.query<{ remaining_volume_ml: string | null }>(
        `
          UPDATE vials
             SET remaining_volume_ml = GREATEST(
                   0::numeric,
                   COALESCE(remaining_volume_ml, 0::numeric)
                   - COALESCE($2::numeric, 0::numeric)
                   - COALESCE($3::numeric, 0::numeric)
                 )
           WHERE vial_id = $1
           RETURNING remaining_volume_ml::text
        `,
        [vialRow.vial_id, totalDispensedMl ?? 0, wasteMl ?? 0]
      );
      updatedRemaining = remainingUpdate.rows[0]?.remaining_volume_ml ?? null;
    }

    let deaTransactionId: string | null = null;
    const shouldRecordDea =
      (input.recordDea ?? true) && (vialRow.controlled_substance ?? false) && totalDispensedMl !== null && totalDispensedMl !== undefined;

    if (shouldRecordDea) {
      const deaInsert = await client.query<{ dea_tx_id: string }>(
        `
          INSERT INTO dea_transactions (
            dispense_id,
            vial_id,
            patient_id,
            prescriber,
            dea_drug_name,
            dea_drug_code,
            dea_schedule,
            quantity_dispensed,
            units,
            transaction_time,
            source_system,
            notes
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (dispense_id)
          DO UPDATE SET
            quantity_dispensed = EXCLUDED.quantity_dispensed,
            dea_drug_name = COALESCE(EXCLUDED.dea_drug_name, dea_transactions.dea_drug_name),
            dea_drug_code = COALESCE(EXCLUDED.dea_drug_code, dea_transactions.dea_drug_code),
            dea_schedule = COALESCE(EXCLUDED.dea_schedule, dea_transactions.dea_schedule),
            transaction_time = EXCLUDED.transaction_time,
            prescriber = COALESCE(EXCLUDED.prescriber, dea_transactions.prescriber),
            notes = COALESCE(EXCLUDED.notes, dea_transactions.notes),
            updated_at = NOW()
          RETURNING dea_tx_id
        `,
        [
          dispenseId,
          vialRow.vial_id,
          patientId,
          input.prescriber ?? null,
          input.deaDrugName ?? vialRow.dea_drug_name,
          input.deaDrugCode ?? vialRow.dea_drug_code,
          input.deaSchedule ?? 'Schedule III',
          totalDispensedMl,
          input.units ?? 'mL',
          dispenseDate.toISOString(),
          'dashboard',
          input.notes ?? null
        ]
      );
      deaTransactionId = deaInsert.rows[0]?.dea_tx_id ?? null;
    }

    await recordDispenseEvent(client, {
      dispenseId,
      eventType: 'created',
      actorUserId: input.createdByUserId,
      actorRole: input.createdByRole,
      payload: {
        patientId,
        vialExternalId: input.vialExternalId.trim(),
        totalDispensedMl,
        wasteMl,
        totalAmount,
        syringeCount,
        dosePerSyringe,
        transactionType: input.transactionType ?? null,
        prescriber: input.prescriber ?? null,
        signatureStatus
      }
    });

    await client.query('COMMIT');
    return {
      dispenseId,
      deaTransactionId,
      updatedRemainingMl: updatedRemaining
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteVial(vialId: string, cascade: { removeLogs?: boolean } = {}): Promise<void> {
  const client = await getPool().connect();
  const removeLogs = cascade.removeLogs ?? true;
  try {
    await client.query('BEGIN');
    if (removeLogs) {
      await client.query('DELETE FROM dea_transactions WHERE vial_id = $1', [vialId]);
      await client.query('DELETE FROM dispenses WHERE vial_id = $1', [vialId]);
    }
    await client.query('DELETE FROM vials WHERE vial_id = $1', [vialId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDispense(
  dispenseId: string,
  actor?: { userId: string; role: string }
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const dispenseResult = await client.query<{
      vial_id: string | null;
      vial_external_id: string | null;
      total_dispensed_ml: string | null;
      waste_ml: string | null;
    }>(
      `SELECT vial_id, vial_external_id, total_dispensed_ml, waste_ml
         FROM dispenses
        WHERE dispense_id = $1`,
      [dispenseId]
    );

    if (dispenseResult.rowCount === 0) {
      throw new Error('Transaction already deleted.');
    }

    const { vial_id: vialId, vial_external_id: vialExternalId, total_dispensed_ml: dispensed, waste_ml: waste } =
      dispenseResult.rows[0];

    const amountToRestore =
      (dispensed ? Number.parseFloat(dispensed) : 0) + (waste ? Number.parseFloat(waste) : 0);

    await client.query('DELETE FROM dea_transactions WHERE dispense_id = $1', [dispenseId]);
    await client.query('DELETE FROM dispenses WHERE dispense_id = $1', [dispenseId]);

    if (amountToRestore > 0) {
      if (vialId) {
        await client.query(
          `UPDATE vials
              SET remaining_volume_ml = COALESCE(remaining_volume_ml, 0) + $2
            WHERE vial_id = $1`,
          [vialId, amountToRestore]
        );
      } else if (vialExternalId) {
        await client.query(
          `UPDATE vials
              SET remaining_volume_ml = COALESCE(remaining_volume_ml, 0) + $2
            WHERE external_id = $1`,
          [vialExternalId, amountToRestore]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDispenseById(dispenseId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dea_transactions WHERE dispense_id = $1', [dispenseId]);
    const result = await client.query('DELETE FROM dispenses WHERE dispense_id = $1 RETURNING dispense_id', [dispenseId]);
    if (result.rowCount === 0) {
      throw new Error('Transaction not found.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type SignDispenseInput = {
  dispenseId: string;
  signerUserId: string;
  signerRole: string;
  signatureNote?: string | null;
  signatureStatus?: string | null;
  signedIp?: string | null;
};

export async function signDispense(input: SignDispenseInput): Promise<void> {
  const client = await getPool().connect();
  const signatureStatus = input.signatureStatus ?? 'signed';
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      signature_status: string | null;
    }>(
      `SELECT signature_status
         FROM dispenses
        WHERE dispense_id = $1
        FOR UPDATE`,
      [input.dispenseId]
    );

    if (current.rowCount === 0) {
      throw new Error('Dispense not found.');
    }

    await client.query(
      `UPDATE dispenses
          SET signed_by = $2,
              signed_at = NOW(),
              signed_ip = $3,
              signature_note = $4,
              signature_status = $5
        WHERE dispense_id = $1`,
      [input.dispenseId, input.signerUserId, input.signedIp ?? null, input.signatureNote ?? null, signatureStatus]
    );

    await recordDispenseEvent(client, {
      dispenseId: input.dispenseId,
      eventType: 'signed',
      actorUserId: input.signerUserId,
      actorRole: input.signerRole,
      payload: {
        signatureStatus,
        signatureNote: input.signatureNote ?? null,
        signedIp: input.signedIp ?? null,
        previousStatus: current.rows[0].signature_status
      }
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type ReopenDispenseInput = {
  dispenseId: string;
  actorUserId: string;
  actorRole: string;
  note?: string | null;
};

export async function reopenDispense(input: ReopenDispenseInput): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT signature_status FROM dispenses WHERE dispense_id = $1 FOR UPDATE`,
      [input.dispenseId]
    );
    if (existing.rowCount === 0) {
      throw new Error('Dispense not found.');
    }

    await client.query(
      `UPDATE dispenses
          SET signed_by = NULL,
              signed_at = NULL,
              signed_ip = NULL,
              signature_note = $2,
              signature_status = 'awaiting_signature'
        WHERE dispense_id = $1`,
      [input.dispenseId, input.note ?? null]
    );

    await recordDispenseEvent(client, {
      dispenseId: input.dispenseId,
      eventType: 'reopened',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: {
        reason: input.note ?? null,
        previousStatus: existing.rows[0].signature_status
      }
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

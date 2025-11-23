import { getPool, query } from './db';
import { computeLabStatus, type LabStatusState } from './patientFormatting';
import { stripHonorifics } from './nameUtils';

export type PatientDataEntryRow = {
  patient_id: string;
  patient_name: string;
  alert_status: string | null;
  status_key: string | null;
  status_row_color: string | null;
  status_alert_color: string | null;
  last_lab: string | null;
  next_lab: string | null;
  regimen: string | null;
  method_of_payment: string | null;
  payment_method_key: string | null;
  payment_method_color: string | null;
  type_of_client: string | null;
  client_type_key: string | null;
  client_type_color: string | null;
  is_primary_care: boolean;
  lab_status: string | null;
  patient_notes: string | null;
  lab_notes: string | null;
  service_start_date: string | null;
  contract_end: string | null;
  date_of_birth: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  address: string | null;
  phone_number: string | null;
  added_by: string | null;
  date_added: string | null;
  last_modified: string | null;
  email: string | null;
  qbo_customer_email: string | null;
  regular_client: boolean | null;
  is_verified: boolean | null;
  membership_owes: string | null;
  last_supply_date?: string | null;
  eligible_for_next_supply?: string | null;
  supply_status?: string | null;
  membership_program?: string | null;
  membership_status?: string | null;
  membership_balance?: string | null;
  next_charge_date?: string | null;
  last_charge_date?: string | null;
  // GoHighLevel sync fields
  ghl_contact_id?: string | null;
  ghl_sync_status?: string | null;
  ghl_last_synced_at?: string | null;
  ghl_sync_error?: string | null;
  last_controlled_dispense_at?: string | null;
  last_dea_drug?: string | null;
};

export type ProfessionalPatient = {
  patient_id: string;
  patient_name: string;
  date_of_birth: string | null;
  regimen: string | null;
  last_lab: string | null;
  next_lab: string | null;
  last_supply_date: string | null;
  eligible_for_next_supply: string | null;
  address: string | null;
  phone_number: string | null;
  method_of_payment: string | null;
  type_of_client: string | null;
  service_start_date: string | null;
  contract_end: string | null;
  regular_client: boolean | null;
  is_verified: boolean | null;
  membership_owes: string | null;
  patient_email: string | null;
  alert_status: string | null;
  status_key: string | null;
  status_row_color: string | null;
  status_alert_color: string | null;
  payment_method_key: string | null;
  payment_method_color: string | null;
  client_type_key: string | null;
  client_type_color: string | null;
  is_primary_care: boolean | null;
  lab_status: string | null;
  patient_notes: string | null;
  lab_notes: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  contact_phone: string | null;
  added_by: string | null;
  date_added: string | null;
  last_modified: string | null;
  membership_program: string | null;
  membership_status: string | null;
  membership_balance: string | null;
  next_charge_date: string | null;
  last_charge_date: string | null;
  supply_status: string | null;
  last_controlled_dispense_at: string | null;
  last_dea_drug: string | null;
};

type RawAddress = {
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

function splitAddressString(address: string | null): RawAddress {
  if (!address) {
    return { address_line1: null, city: null, state: null, postal_code: null };
  }
  const sanitized = address.replace(/\n+/g, ' ').trim();
  if (!sanitized) {
    return { address_line1: null, city: null, state: null, postal_code: null };
  }
  const parts = sanitized
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length);
  if (parts.length === 0) {
    return { address_line1: sanitized, city: null, state: null, postal_code: null };
  }
  const line1 = parts[0] ?? null;
  const city = parts[1] ?? null;
  let state: string | null = null;
  let postal: string | null = null;
  if (parts.length >= 3) {
    const tokens = parts[2].split(/\s+/).filter(Boolean);
    if (parts.length === 3) {
      state = tokens[0] ?? null;
      postal = tokens[1] ?? null;
    } else {
      state = parts[2] ?? null;
      postal = parts[3] ?? null;
    }
  }
  return { address_line1: line1, city, state, postal_code: postal };
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (!token) return false;
    return ['true', '1', 'yes', 'y', 'on'].includes(token);
  }
  return false;
}

function normalizeCurrency(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatOptionalValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    return value.toString();
  }
  return String(value);
}

type DerivedLabStatus = {
  label: string;
  state: LabStatusState;
};

function deriveLabStatus(
  labStatus: string | null | undefined,
  lastLab: string | null,
  nextLab: string | null
): DerivedLabStatus {
  const provided = typeof labStatus === 'string' ? labStatus.trim() : '';
  const computed = computeLabStatus(lastLab, nextLab);
  const label = (provided || computed.label || 'No lab data').trim() || 'No lab data';
  return { label, state: computed.state };
}

function enforceLabStatusOnPatientStatus(
  statusKey: string | null | undefined,
  labState: LabStatusState
): string | null {
  const normalized = statusKey?.trim().toLowerCase() ?? null;
  if (normalized === 'active' && (labState === 'overdue' || labState === 'due-soon')) {
    return 'active_pending';
  }
  if (normalized === 'active_pending' && labState === 'current') {
    return 'active';
  }
  return statusKey ?? null;
}

export async function fetchPatientDataEntries(): Promise<PatientDataEntryRow[]> {
  return query<PatientDataEntryRow>(
    `SELECT *
     FROM patient_data_entry_v
     ORDER BY
       CASE
         WHEN COALESCE(status_key, '') LIKE 'hold%' OR LOWER(COALESCE(alert_status, '')) LIKE 'hold%' THEN 0
         WHEN COALESCE(status_key, '') = 'active_pending' OR LOWER(COALESCE(alert_status, '')) = 'active - pending' THEN 1
         WHEN COALESCE(status_key, '') = 'active' OR LOWER(COALESCE(alert_status, '')) = 'active' THEN 2
         WHEN COALESCE(status_key, '') = 'inactive' OR LOWER(COALESCE(alert_status, '')) = 'inactive' THEN 3
         ELSE 4
       END,
       LOWER(COALESCE(type_of_client, '')) DESC,
       patient_name ASC`
  );
}

export async function fetchProfessionalDashboardPatients(): Promise<ProfessionalPatient[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT *
     FROM professional_patient_dashboard_v
     ORDER BY
       CASE
         WHEN COALESCE(status_key, '') LIKE 'hold%' OR LOWER(COALESCE(alert_status, '')) LIKE 'hold%' THEN 0
         WHEN COALESCE(status_key, '') = 'active_pending' OR LOWER(COALESCE(alert_status, '')) = 'active - pending' THEN 1
         WHEN COALESCE(status_key, '') = 'active' OR LOWER(COALESCE(alert_status, '')) = 'active' THEN 2
         WHEN COALESCE(status_key, '') = 'inactive' OR LOWER(COALESCE(alert_status, '')) = 'inactive' THEN 3
         ELSE 4
       END,
       CASE
         WHEN (COALESCE(status_key, '') = 'active_pending' OR LOWER(COALESCE(alert_status, '')) = 'active - pending') THEN
           CASE
             WHEN COALESCE(lab_status, '') ILIKE 'overdue%' THEN 0
             WHEN COALESCE(lab_status, '') ILIKE 'due%' THEN 1
             WHEN COALESCE(lab_status, '') ILIKE 'current%' THEN 2
             ELSE 3
           END
         ELSE 99
       END,
       LOWER(COALESCE(type_of_client, '')) DESC,
       patient_name ASC`
  );
  return rows.map((row) => ({
    patient_id: String(row.patient_id),
    patient_name: String(row.patient_name ?? ''),
    date_of_birth: formatOptionalValue(row.date_of_birth),
    regimen: formatOptionalValue(row.regimen),
    last_lab: formatOptionalValue(row.last_lab),
    next_lab: formatOptionalValue(row.next_lab),
    last_supply_date: formatOptionalValue(row.last_supply_date),
    eligible_for_next_supply: formatOptionalValue(row.eligible_for_next_supply),
    address: formatOptionalValue(row.address),
    phone_number: formatOptionalValue(row.phone_number),
    method_of_payment: formatOptionalValue(row.method_of_payment),
    type_of_client: formatOptionalValue(row.type_of_client),
    service_start_date: formatOptionalValue(row.service_start_date),
    contract_end: formatOptionalValue(row.contract_end),
    regular_client: toBoolean(row.regular_client),
    is_verified: toBoolean(row.is_verified),
    membership_owes: formatOptionalValue(row.membership_owes),
    patient_email: formatOptionalValue(row.patient_email),
    alert_status: formatOptionalValue(row.alert_status),
    status_key: formatOptionalValue(row.status_key),
    status_row_color: formatOptionalValue(row.status_row_color),
    status_alert_color: formatOptionalValue(row.status_alert_color),
    payment_method_key: formatOptionalValue(row.payment_method_key),
    payment_method_color: formatOptionalValue(row.payment_method_color),
    client_type_key: formatOptionalValue(row.client_type_key),
    client_type_color: formatOptionalValue(row.client_type_color),
    is_primary_care: toBoolean(row.is_primary_care),
    lab_status: formatOptionalValue(row.lab_status),
    patient_notes: formatOptionalValue(row.patient_notes),
    lab_notes: formatOptionalValue(row.lab_notes),
    address_line1: formatOptionalValue(row.address_line1),
    city: formatOptionalValue(row.city),
    state: formatOptionalValue(row.state),
    postal_code: formatOptionalValue(row.postal_code),
    contact_phone: formatOptionalValue(row.contact_phone),
    added_by: formatOptionalValue(row.added_by),
    date_added: formatOptionalValue(row.date_added),
    last_modified: formatOptionalValue(row.last_modified),
    membership_program: formatOptionalValue(row.membership_program),
    membership_status: formatOptionalValue(row.membership_status),
    membership_balance: formatOptionalValue(row.membership_balance),
    next_charge_date: formatOptionalValue(row.next_charge_date),
    last_charge_date: formatOptionalValue(row.last_charge_date),
    supply_status: formatOptionalValue(row.supply_status),
    last_controlled_dispense_at: formatOptionalValue(row.last_controlled_dispense_at),
    last_dea_drug: formatOptionalValue(row.last_dea_drug)
  }));
}

export type PatientOption = {
  patient_id: string;
  patient_name: string;
  date_of_birth: string | null;
  regimen: string | null;
  type_of_client: string | null;
  status_key: string | null;
  alert_status: string | null;
  lab_status: string | null;
  last_lab: string | null;
  next_lab: string | null;
};

export async function fetchActivePatientOptions(): Promise<PatientOption[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT
        patient_id,
        patient_name,
        date_of_birth,
        regimen,
        type_of_client,
        status_key,
        alert_status,
        lab_status,
        last_lab,
        next_lab
     FROM patient_data_entry_v
     WHERE
       COALESCE(status_key, '') IN ('active', 'active_pending')
       OR LOWER(COALESCE(alert_status, '')) IN ('active', 'active - pending')
     ORDER BY patient_name ASC`
  );

  return rows.map((row) => ({
    patient_id: String(row.patient_id),
    patient_name: String(row.patient_name ?? ''),
    date_of_birth: formatOptionalValue(row.date_of_birth),
    regimen: formatOptionalValue(row.regimen),
    type_of_client: formatOptionalValue(row.type_of_client),
    status_key: formatOptionalValue(row.status_key),
    alert_status: formatOptionalValue(row.alert_status),
    lab_status: formatOptionalValue(row.lab_status),
    last_lab: formatOptionalValue(row.last_lab),
    next_lab: formatOptionalValue(row.next_lab)
  }));
}

export async function fetchPatientById(patientId: string): Promise<PatientDataEntryRow | null> {
  const [row] = await query<PatientDataEntryRow>(
    `SELECT * FROM patient_data_entry_v WHERE patient_id = $1`,
    [patientId]
  );
  return row ?? null;
}

export type PatientDataEntryPayload = {
  patientId?: string;
  patientName: string;
  statusKey: string | null;
  paymentMethodKey: string | null;
  clientTypeKey: string | null;
  regimen: string | null;
  lastLab: string | null;
  nextLab: string | null;
  labStatus: string | null;
  labNotes: string | null;
  patientNotes: string | null;
  serviceStartDate: string | null;
  contractEndDate: string | null;
  dateOfBirth: string | null;
  address: string | null;
  phoneNumber: string | null;
  addedBy: string | null;
  dateAdded: string | null;
  lastModified: string | null;
  email: string | null;
  regularClient: boolean;
  isVerified: boolean;
  membershipOwes: string | null;
  eligibleForNextSupply: string | null;
  supplyStatus: string | null;
  membershipProgram: string | null;
  membershipStatus: string | null;
  membershipBalance: string | null;
  nextChargeDate: string | null;
  lastChargeDate: string | null;
  lastSupplyDate: string | null;
  lastControlledDispenseAt: string | null;
  lastDeaDrug: string | null;
};

export async function createPatient(payload: PatientDataEntryPayload): Promise<PatientDataEntryRow> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cleanedName = stripHonorifics(payload.patientName ?? '');
    const { address_line1, city, state, postal_code } = splitAddressString(payload.address ?? null);
    const serviceStart = normalizeDate(payload.serviceStartDate);
    const contractEnd = normalizeDate(payload.contractEndDate);
    const dateOfBirth = normalizeDate(payload.dateOfBirth);
    const dateAdded = normalizeDate(payload.dateAdded) ?? new Date().toISOString();
    const lastModified = normalizeDate(payload.lastModified) ?? new Date().toISOString();
    const membershipOwes = normalizeCurrency(payload.membershipOwes);
    const regularClient = toBoolean(payload.regularClient);
    const isVerified = toBoolean(payload.isVerified);
    const email = payload.email?.trim() || null;
    const lastLab = normalizeDate(payload.lastLab);
    const nextLab = normalizeDate(payload.nextLab);
    const { label: labStatusValue, state: labStatusState } = deriveLabStatus(
      payload.labStatus,
      lastLab,
      nextLab
    );
    const statusKey = enforceLabStatusOnPatientStatus(payload.statusKey, labStatusState);

    const patientInsert = await client.query<{ patient_id: string }>(
      `INSERT INTO patients (
          full_name,
          status_key,
          alert_status,
          payment_method_key,
          payment_method,
          client_type_key,
          client_type,
          regimen,
          notes,
          lab_status,
          service_start_date,
          contract_end_date,
          dob,
          phone_primary,
          address_line1,
          city,
          state,
          postal_code,
          added_by,
          date_added,
          last_modified,
          email,
          regular_client,
          is_verified,
          membership_owes,
          updated_at
       ) VALUES (
          $1,
          NULLIF($2::text, ''),
          (SELECT display_name FROM patient_status_lookup WHERE status_key = NULLIF($2::text, '')),
          NULLIF($3::text, ''),
          (SELECT display_name FROM payment_method_lookup WHERE method_key = NULLIF($3::text, '')),
          NULLIF($4::text, ''),
          (SELECT display_name FROM client_type_lookup WHERE type_key = NULLIF($4::text, '')),
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          NOW()
       ) RETURNING patient_id`,
      [
        cleanedName || payload.patientName.trim(),
        statusKey,
        payload.paymentMethodKey,
        payload.clientTypeKey,
        payload.regimen ?? null,
        payload.patientNotes ?? null,
        labStatusValue,
        serviceStart,
        contractEnd,
        dateOfBirth,
        payload.phoneNumber ?? null,
        address_line1,
        city,
        state,
        postal_code,
        payload.addedBy ?? 'dashboard',
        dateAdded,
        lastModified,
        email,
        regularClient,
        isVerified,
        membershipOwes
      ]
    );
    const patientId = patientInsert.rows[0].patient_id;

    if (labStatusValue || payload.labNotes || lastLab || nextLab) {
      await client.query(
        `INSERT INTO labs (patient_id, last_lab_date, next_lab_date, lab_status, lab_notes)
         VALUES ($1, $2, $3, $4, $5)` ,
        [patientId, lastLab, nextLab, labStatusValue, payload.labNotes ?? payload.patientNotes ?? null]
      );
    }

    const refreshed = await client.query<PatientDataEntryRow>(
      'SELECT * FROM patient_data_entry_v WHERE patient_id = $1',
      [patientId]
    );
    await client.query('COMMIT');
    return refreshed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePatient(payload: PatientDataEntryPayload): Promise<PatientDataEntryRow> {
  if (!payload.patientId) {
    throw new Error('patientId is required for update');
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cleanedName = stripHonorifics(payload.patientName ?? '');
    const { address_line1, city, state, postal_code } = splitAddressString(payload.address ?? null);
    const serviceStart = normalizeDate(payload.serviceStartDate);
    const contractEnd = normalizeDate(payload.contractEndDate);
    const dateOfBirth = normalizeDate(payload.dateOfBirth);
    const dateAdded = normalizeDate(payload.dateAdded) ?? new Date().toISOString();
    const lastModified = normalizeDate(payload.lastModified) ?? new Date().toISOString();
    const membershipOwes = normalizeCurrency(payload.membershipOwes);
    const regularClient = toBoolean(payload.regularClient);
    const isVerified = toBoolean(payload.isVerified);
    const email = payload.email?.trim() || null;
    const lastLab = normalizeDate(payload.lastLab);
    const nextLab = normalizeDate(payload.nextLab);
    const { label: labStatusValue, state: labStatusState } = deriveLabStatus(
      payload.labStatus,
      lastLab,
      nextLab
    );
    const statusKey = enforceLabStatusOnPatientStatus(payload.statusKey, labStatusState);

    await client.query(
      `UPDATE patients
          SET full_name = $2,
              status_key = NULLIF($3::text, ''),
              alert_status = (
                SELECT display_name FROM patient_status_lookup WHERE status_key = NULLIF($3::text, '')
              ),
              payment_method_key = NULLIF($4::text, ''),
              payment_method = (
                SELECT display_name FROM payment_method_lookup WHERE method_key = NULLIF($4::text, '')
              ),
              client_type_key = NULLIF($5::text, ''),
              client_type = (
                SELECT display_name FROM client_type_lookup WHERE type_key = NULLIF($5::text, '')
              ),
              regimen = $6,
              notes = $7,
              lab_status = $8,
              service_start_date = $9,
              contract_end_date = $10,
              dob = $11,
              phone_primary = $12,
              address_line1 = $13,
              city = $14,
              state = $15,
              postal_code = $16,
              added_by = $17,
              date_added = $18,
              last_modified = $19,
              email = $20,
              regular_client = $21,
              is_verified = $22,
              membership_owes = $23,
              updated_at = NOW()
        WHERE patient_id = $1`,
      [
        payload.patientId,
        cleanedName || payload.patientName.trim(),
        statusKey,
        payload.paymentMethodKey,
        payload.clientTypeKey,
        payload.regimen ?? null,
        payload.patientNotes ?? null,
        labStatusValue,
        serviceStart,
        contractEnd,
        dateOfBirth,
        payload.phoneNumber ?? null,
        address_line1,
        city,
        state,
        postal_code,
        payload.addedBy ?? 'dashboard',
        dateAdded,
        lastModified,
        email,
        regularClient,
        isVerified,
        membershipOwes
      ]
    );

    const labResult = await client.query(
      `UPDATE labs
          SET last_lab_date = $2,
              next_lab_date = $3,
              lab_status = $4,
              lab_notes = $5,
              updated_at = NOW()
        WHERE patient_id = $1`,
      [payload.patientId, lastLab, nextLab, labStatusValue, payload.labNotes ?? payload.patientNotes ?? null]
    );
    if (labResult.rowCount === 0 && (labStatusValue || payload.labNotes || lastLab || nextLab)) {
      await client.query(
        `INSERT INTO labs (patient_id, last_lab_date, next_lab_date, lab_status, lab_notes)
         VALUES ($1, $2, $3, $4, $5)` ,
        [payload.patientId, lastLab, nextLab, labStatusValue, payload.labNotes ?? payload.patientNotes ?? null]
      );
    }

    const refreshed = await client.query<PatientDataEntryRow>(
      'SELECT * FROM patient_data_entry_v WHERE patient_id = $1',
      [payload.patientId]
    );
    await client.query('COMMIT');
    return refreshed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePatient(patientId: string): Promise<void> {
  await query('DELETE FROM patients WHERE patient_id = $1', [patientId]);
}

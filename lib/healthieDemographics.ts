import { query } from './db';
import { createHealthieClient } from './healthie';

type PatientRow = {
  patient_id: string;
  patient_name: string;
  email: string | null;
  phone_number: string | null;
  date_of_birth: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  method_of_payment: string | null;
  client_type: string | null;
};

const HEALTHIE_PAYMENT_REGEX = /healthie/i;
const HEALTHIE_CLIENT_TYPES = new Set(['NowMensHealth.Care', 'NowPrimary.Care']);

function splitName(fullName: string) {
  const tokens = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return { first: 'Patient', last: 'Unknown' };
  }
  if (tokens.length === 1) {
    return { first: tokens[0], last: 'Unknown' };
  }
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

function sanitizePhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  return digits;
}

function normalizeDob(dob?: string | null): string | undefined {
  if (!dob) return undefined;
  const trimmed = dob.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return undefined;
}

type LocationInput = {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

function buildLocationInput(row: PatientRow): LocationInput | undefined {
  const location: LocationInput = {};
  if (row.address_line1?.trim()) {
    location.line1 = row.address_line1.trim();
  }
  if (row.city?.trim()) {
    location.city = row.city.trim();
  }
  if (row.state?.trim()) {
    location.state = row.state.trim();
  }
  if (row.postal_code?.trim()) {
    location.zip = row.postal_code.trim();
  }

  if (!location.line1 && !location.city && !location.state && !location.zip) {
    return undefined;
  }

  location.name = 'Primary';
  location.country = location.country ?? 'US';
  return location;
}

async function fetchLinkedHealthieId(patientId: string): Promise<string | null> {
  const result = await query<{ healthie_client_id: string }>(
    `
      SELECT healthie_client_id
      FROM healthie_clients
      WHERE patient_id = $1
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `,
    [patientId]
  );
  return result[0]?.healthie_client_id ?? null;
}

async function upsertHealthieLink(patientId: string, healthieClientId: string, matchMethod: string) {
  await query(
    `
      INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      ON CONFLICT (healthie_client_id)
      DO UPDATE SET
        patient_id = EXCLUDED.patient_id,
        match_method = EXCLUDED.match_method,
        is_active = TRUE,
        updated_at = NOW()
    `,
    [patientId, healthieClientId, matchMethod]
  );
}

async function ensureHealthieClientId(row: PatientRow, healthieClientInstance = createHealthieClient()) {
  if (!healthieClientInstance) {
    throw new Error('Healthie client not configured');
  }

  let existingId = await fetchLinkedHealthieId(row.patient_id);

  if (!existingId && row.email) {
    const matchByEmail = await healthieClientInstance.findClientByEmail(row.email);
    if (matchByEmail?.id) {
      await upsertHealthieLink(row.patient_id, matchByEmail.id, 'email_lookup');
      existingId = matchByEmail.id;
    }
  }

  if (!existingId && row.phone_number) {
    const matchByPhone = await healthieClientInstance.findClientByPhone(row.phone_number);
    if (matchByPhone?.id) {
      await upsertHealthieLink(row.patient_id, matchByPhone.id, 'phone_lookup');
      existingId = matchByPhone.id;
    }
  }

  if (!existingId) {
    const { first, last } = splitName(row.patient_name);
    const created = await healthieClientInstance.createClient({
      first_name: first,
      last_name: last,
      email: row.email ?? undefined,
      phone_number: sanitizePhone(row.phone_number),
      dob: normalizeDob(row.date_of_birth),
    });
    await upsertHealthieLink(row.patient_id, created.id, 'created_by_sync');
    existingId = created.id;
  }

  return existingId;
}

async function fetchPatientRow(patientId: string): Promise<PatientRow | null> {
  const rows = await query<PatientRow>(
    `
      SELECT
        patient_id,
        patient_name,
        email,
        phone_number,
        date_of_birth,
        address_line1,
        city,
        state,
        postal_code,
        method_of_payment,
        client_type
      FROM patient_data_entry_v
      WHERE patient_id = $1
      LIMIT 1
    `,
    [patientId]
  );
  return rows[0] ?? null;
}

function shouldSyncPatient(row: PatientRow): boolean {
  const method = row.method_of_payment ?? '';
  const clientType = row.client_type ?? '';
  return HEALTHIE_PAYMENT_REGEX.test(method) && HEALTHIE_CLIENT_TYPES.has(clientType);
}

export async function syncHealthiePatientDemographics(
  patientId: string
): Promise<{ status: 'synced' | 'skipped'; reason?: string }> {
  const row = await fetchPatientRow(patientId);
  if (!row) {
    return { status: 'skipped', reason: 'Patient not found' };
  }
  if (!shouldSyncPatient(row)) {
    return { status: 'skipped', reason: 'Patient not billed via Healthie' };
  }

  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    throw new Error('Healthie client not configured');
  }

  const healthieClientId = await ensureHealthieClientId(row, healthieClient);
  const location = buildLocationInput(row);
  const { first, last } = splitName(row.patient_name);

  await healthieClient.updateClient(healthieClientId, {
    first_name: first,
    last_name: last,
    email: row.email ?? undefined,
    phone_number: sanitizePhone(row.phone_number),
    dob: normalizeDob(row.date_of_birth),
    location,
  });

  return { status: 'synced' };
}


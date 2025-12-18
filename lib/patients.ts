import { query as dbQuery } from './db';

/**
 * Patients domain module
 * ----------------------
 * Centralizes all logic for translating internal patient_ids into Healthie user
 * IDs, GoHighLevel contact IDs, and other identifiers we need throughout the
 * platform.
 */

export type PatientProfile = {
  patientId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  dob?: string | null;
  healthieClientId?: string | null;
  ghlContactId?: string | null;
};

export type PatientQuery = {
  name?: string;
  phone?: string;
  email?: string;
};

const SEARCH_LIMIT = 25;

type PatientRow = {
  patient_id: string;
  patient_name: string;
  email?: string | null;
  phone_number?: string | null;
  date_of_birth?: string | null;
  healthie_client_id?: string | null;
  ghl_contact_id?: string | null;
};

function mapRowToProfile(row: PatientRow): PatientProfile {
  return {
    patientId: row.patient_id,
    fullName: row.patient_name,
    email: row.email ?? null,
    phone: row.phone_number ?? null,
    dob: row.date_of_birth ?? null,
    healthieClientId: row.healthie_client_id ?? null,
    ghlContactId: row.ghl_contact_id ?? null,
  };
}

async function fetchPatientRows(whereClause: string, params: unknown[]): Promise<PatientProfile[]> {
  const rows = await dbQuery<PatientRow>(
    `
      SELECT
        p.patient_id,
        p.patient_name,
        p.email,
        p.phone_number,
        p.date_of_birth,
        hc.healthie_client_id,
        pts.ghl_contact_id
      FROM patient_data_entry_v p
      LEFT JOIN LATERAL (
        SELECT healthie_client_id
        FROM healthie_clients
        WHERE patient_id = p.patient_id
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1
      ) hc ON TRUE
      LEFT JOIN patients pts ON pts.patient_id = p.patient_id
      ${whereClause}
      ORDER BY p.patient_name ASC
      LIMIT ${SEARCH_LIMIT}
    `,
    params
  );

  return rows.map(mapRowToProfile);
}

async function getActiveHealthieClientId(patientId: string): Promise<string> {
  const rows = await dbQuery<{ healthie_client_id: string }>(
    `
      SELECT healthie_client_id
      FROM healthie_clients
      WHERE patient_id = $1
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `,
    [patientId]
  );

  const healthieId = rows[0]?.healthie_client_id;
  if (!healthieId) {
    throw new Error(`No Healthie client linked to patient ${patientId}.`);
  }
  return healthieId;
}

async function getGhlContactId(patientId: string): Promise<string> {
  const rows = await dbQuery<{ ghl_contact_id: string | null }>(
    `SELECT ghl_contact_id FROM patients WHERE patient_id = $1`,
    [patientId]
  );
  const contactId = rows[0]?.ghl_contact_id;
  if (!contactId) {
    throw new Error(`Patient ${patientId} is not linked to a GHL contact.`);
  }
  return contactId;
}

export interface PatientsService {
  findByQuery(query: PatientQuery): Promise<PatientProfile[]>;
  getById(patientId: string): Promise<PatientProfile | null>;
  ensureHealthieClient(patientId: string): Promise<string>;
  ensureGhlContact(patientId: string): Promise<string>;
  linkExternalIds(
    patientId: string,
    ids: { healthieClientId?: string; ghlContactId?: string }
  ): Promise<void>;
}

export const patientsService: PatientsService = {
  async findByQuery(query) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.name) {
      params.push(`%${query.name.trim()}%`);
      conditions.push(`p.patient_name ILIKE $${params.length}`);
    }
    if (query.email) {
      params.push(`%${query.email.trim()}%`);
      conditions.push(`p.email ILIKE $${params.length}`);
    }
    if (query.phone) {
      params.push(`%${query.phone.replace(/\D/g, '')}%`);
      conditions.push(`REGEXP_REPLACE(COALESCE(p.phone_number, ''), '\\D', '', 'g') LIKE $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return fetchPatientRows(whereClause, params);
  },

  async getById(patientId) {
    const results = await fetchPatientRows('WHERE p.patient_id = $1', [patientId]);
    return results[0] ?? null;
  },

  ensureHealthieClient(patientId) {
    return getActiveHealthieClientId(patientId);
  },

  ensureGhlContact(patientId) {
    return getGhlContactId(patientId);
  },

  async linkExternalIds(patientId, ids) {
    if (ids.healthieClientId) {
      await dbQuery(
        `
          INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active)
          VALUES ($1, $2, 'manual_link', TRUE)
          ON CONFLICT (healthie_client_id)
          DO UPDATE SET
            patient_id = EXCLUDED.patient_id,
            match_method = EXCLUDED.match_method,
            is_active = TRUE,
            updated_at = NOW()
        `,
        [patientId, ids.healthieClientId]
      );
    }

    if (ids.ghlContactId) {
      await dbQuery(
        `
          UPDATE patients
          SET ghl_contact_id = $2,
              updated_at = NOW()
          WHERE patient_id = $1
        `,
        [patientId, ids.ghlContactId]
      );
    }
  },
};


import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { query } from './db';

const BIOSCOPE_HEADER = 'x-bioscope-secret';

export type BioscopeAuthorizedPatient = {
  id: number;
  healthie_patient_id: string;
  patient_name: string | null;
  added_by: string;
  added_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  notes: string | null;
};

export class BioscopeUnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'BioscopeUnauthorizedError';
  }
}

export class BioscopeForbiddenError extends Error {
  status = 403;
  constructor(message = 'Patient not authorized for BioSCOPE access') {
    super(message);
    this.name = 'BioscopeForbiddenError';
  }
}

export function verifyBioscopeSecret(request: NextRequest): boolean {
  const expected = process.env.BIOSCOPE_API_SECRET;
  if (!expected) {
    console.error('[bioscope-auth] BIOSCOPE_API_SECRET is not configured');
    return false;
  }
  const provided = request.headers.get(BIOSCOPE_HEADER);
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function isPatientAuthorized(healthieId: string): Promise<boolean> {
  if (!healthieId) return false;
  const rows = await query<{ id: number }>(
    `SELECT id FROM bioscope_authorized_patients
      WHERE healthie_patient_id = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [healthieId]
  );
  return rows.length > 0;
}

export async function listAuthorizedPatients(includeRevoked = true): Promise<BioscopeAuthorizedPatient[]> {
  const sql = includeRevoked
    ? `SELECT * FROM bioscope_authorized_patients ORDER BY revoked_at IS NULL DESC, added_at DESC`
    : `SELECT * FROM bioscope_authorized_patients WHERE revoked_at IS NULL ORDER BY added_at DESC`;
  return query<BioscopeAuthorizedPatient>(sql);
}

export async function addAuthorizedPatient(input: {
  healthie_patient_id: string;
  patient_name?: string | null;
  added_by: string;
  notes?: string | null;
}): Promise<BioscopeAuthorizedPatient> {
  const [row] = await query<BioscopeAuthorizedPatient>(
    `INSERT INTO bioscope_authorized_patients
       (healthie_patient_id, patient_name, added_by, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.healthie_patient_id, input.patient_name ?? null, input.added_by, input.notes ?? null]
  );
  return row;
}

export async function revokeAuthorizedPatient(id: number, revokedBy: string): Promise<void> {
  await query(
    `UPDATE bioscope_authorized_patients
        SET revoked_at = NOW(),
            revoked_by = $2
      WHERE id = $1
        AND revoked_at IS NULL`,
    [id, revokedBy]
  );
}

export async function auditBioscopeCall(input: {
  action: string;
  healthie_patient_id: string | null;
  status: 'completed' | 'rejected' | 'error';
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_action_log
         (agent_name, action_type, category, summary, details, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'bioscope',
        input.action,
        'integration',
        input.summary,
        JSON.stringify({
          healthie_patient_id: input.healthie_patient_id,
          ...(input.details ?? {})
        }),
        input.status
      ]
    );
  } catch (err) {
    console.error('[bioscope-auth] failed to write audit log:', err);
  }
}

export async function authorizeBioscopeRequest(
  request: NextRequest,
  healthiePatientId: string,
  action: string
): Promise<void> {
  if (!verifyBioscopeSecret(request)) {
    await auditBioscopeCall({
      action,
      healthie_patient_id: healthiePatientId || null,
      status: 'rejected',
      summary: `BioSCOPE auth failed (invalid or missing ${BIOSCOPE_HEADER})`,
      details: { reason: 'invalid_secret' }
    });
    throw new BioscopeUnauthorizedError();
  }

  if (!healthiePatientId) {
    await auditBioscopeCall({
      action,
      healthie_patient_id: null,
      status: 'rejected',
      summary: 'BioSCOPE request rejected — missing patient id',
      details: { reason: 'missing_patient_id' }
    });
    throw new BioscopeForbiddenError('Missing patient id');
  }

  const allowed = await isPatientAuthorized(healthiePatientId);
  if (!allowed) {
    await auditBioscopeCall({
      action,
      healthie_patient_id: healthiePatientId,
      status: 'rejected',
      summary: `BioSCOPE request rejected — patient ${healthiePatientId} not on allowlist`,
      details: { reason: 'patient_not_allowlisted' }
    });
    throw new BioscopeForbiddenError();
  }
}

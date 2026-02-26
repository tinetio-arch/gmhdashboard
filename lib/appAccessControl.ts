/**
 * App Access Control System
 * 
 * Manages patient access to the headless mobile app by controlling
 * the Healthie `active` flag and maintaining a Postgres audit trail.
 */

import { query, getPool } from './db';
import { HealthieClient } from './healthie';

// ── Types ──────────────────────────────────────────────────────────

export type AccessStatus = 'granted' | 'revoked' | 'suspended';
export type ReasonCategory = 'payment' | 'policy_violation' | 'discharged' | 'administrative' | 'other';

export interface AccessControlRecord {
  id: number;
  patient_id: string;
  healthie_client_id: string | null;
  access_status: AccessStatus;
  reason: string;
  reason_category: ReasonCategory | null;
  changed_by: string | null;
  changed_by_name: string | null;
  healthie_synced: boolean;
  healthie_sync_error: string | null;
  effective_at: string;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientAccessSummary {
  patient_id: string;
  patient_name: string;
  healthie_client_id: string | null;
  current_status: AccessStatus;
  last_changed_at: string | null;
  last_changed_by: string | null;
  last_reason: string | null;
  last_reason_category: ReasonCategory | null;
  status_key: string | null;
}

export interface AccessControlStats {
  total_patients: number;
  granted_count: number;
  revoked_count: number;
  suspended_count: number;
  recent_changes: AccessControlRecord[];
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Get the current access status for a patient.
 * Returns the most recent access control record, or 'granted' if none exists.
 * Also checks if the patient is inactive in GMH — inactive patients are always revoked.
 */
export async function getPatientAccessStatus(patientId: string): Promise<{
  status: AccessStatus;
  record: AccessControlRecord | null;
}> {
  // Check if patient is inactive in GMH — always revoked regardless of app_access_controls
  const [patient] = await query<{ status_key: string | null }>(
    `SELECT status_key FROM patients WHERE patient_id = $1 LIMIT 1`,
    [patientId]
  );
  if (patient?.status_key === 'inactive') {
    return { status: 'revoked', record: null };
  }

  const rows = await query<AccessControlRecord>(
    `SELECT aac.*, u.display_name AS changed_by_name
     FROM app_access_controls aac
     LEFT JOIN users u ON u.user_id = aac.changed_by
     WHERE aac.patient_id = $1
     ORDER BY aac.effective_at DESC
     LIMIT 1`,
    [patientId]
  );

  if (rows.length === 0) {
    return { status: 'granted', record: null };
  }

  const record = rows[0];

  // Check if a suspension has expired
  if (record.access_status === 'suspended' && record.expires_at) {
    const expiresAt = new Date(record.expires_at);
    if (expiresAt <= new Date()) {
      // Auto-restore: suspension has expired
      await query(
        `INSERT INTO app_access_controls 
         (patient_id, healthie_client_id, access_status, reason, reason_category, notes, effective_at)
         VALUES ($1, $2, 'granted', 'Suspension expired (auto-restored)', 'administrative', 'Automatic restoration after suspension period ended', NOW())`,
        [patientId, record.healthie_client_id]
      );
      // Sync to Healthie
      if (record.healthie_client_id) {
        try {
          await syncHealthieAccessStatus(record.healthie_client_id, true);
        } catch (err) {
          console.error('[AppAccessControl] Auto-restore Healthie sync failed:', err);
        }
      }
      return { status: 'granted', record: null };
    }
  }

  return { status: record.access_status, record };
}

/**
 * Look up the Healthie client ID for a patient.
 * Checks both the healthie_clients mapping table and the patients table.
 */
async function lookupHealthieClientId(patientId: string, dbClient?: any): Promise<string | null> {
  const queryFn = dbClient
    ? (sql: string, params: any[]) => dbClient.query(sql, params).then((r: any) => r.rows)
    : query;

  // Try healthie_clients mapping table first
  const [mapping] = await queryFn(
    `SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1`,
    [patientId]
  );
  if (mapping?.healthie_client_id) return mapping.healthie_client_id;

  // Fallback to patients table
  const [patient] = await queryFn(
    `SELECT healthie_client_id FROM patients WHERE patient_id = $1 LIMIT 1`,
    [patientId]
  );
  return patient?.healthie_client_id || null;
}

/**
 * Revoke a patient's access to the app.
 */
export async function revokePatientAccess({
  patientId,
  reason,
  reasonCategory,
  changedBy,
  notes,
  expiresAt,
}: {
  patientId: string;
  reason: string;
  reasonCategory: ReasonCategory;
  changedBy: string;
  notes?: string;
  expiresAt?: string; // ISO date for suspension
}): Promise<AccessControlRecord> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const healthieClientId = await lookupHealthieClientId(patientId, client);
    const accessStatus: AccessStatus = expiresAt ? 'suspended' : 'revoked';

    // Insert access control record
    const insertResult = await client.query(
      `INSERT INTO app_access_controls 
       (patient_id, healthie_client_id, access_status, reason, reason_category, changed_by, notes, expires_at, effective_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [patientId, healthieClientId, accessStatus, reason, reasonCategory, changedBy, notes || null, expiresAt || null]
    );

    const record = insertResult.rows[0];

    // Sync to Healthie (deactivate patient)
    let healthieSynced = false;
    let healthieSyncError: string | null = null;

    if (healthieClientId) {
      try {
        await syncHealthieAccessStatus(healthieClientId, false);
        healthieSynced = true;
      } catch (err) {
        healthieSyncError = err instanceof Error ? err.message : String(err);
        console.error(`[AppAccessControl] Healthie sync failed for ${healthieClientId}:`, healthieSyncError);
      }

      await client.query(
        `UPDATE app_access_controls SET healthie_synced = $1, healthie_sync_error = $2 WHERE id = $3`,
        [healthieSynced, healthieSyncError, record.id]
      );
    }

    await client.query('COMMIT');

    // Send Telegram notification (fire-and-forget)
    sendAccessChangeNotification(patientId, accessStatus, reason, changedBy).catch(() => { });

    return { ...record, healthie_synced: healthieSynced, healthie_sync_error: healthieSyncError };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Restore a patient's access to the app.
 */
export async function restorePatientAccess({
  patientId,
  reason,
  changedBy,
  notes,
}: {
  patientId: string;
  reason: string;
  changedBy: string;
  notes?: string;
}): Promise<AccessControlRecord> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const healthieClientId = await lookupHealthieClientId(patientId, client);

    const insertResult = await client.query(
      `INSERT INTO app_access_controls 
       (patient_id, healthie_client_id, access_status, reason, reason_category, changed_by, notes, effective_at)
       VALUES ($1, $2, 'granted', $3, 'administrative', $4, $5, NOW())
       RETURNING *`,
      [patientId, healthieClientId, reason, changedBy, notes || null]
    );

    const record = insertResult.rows[0];

    let healthieSynced = false;
    let healthieSyncError: string | null = null;

    if (healthieClientId) {
      try {
        await syncHealthieAccessStatus(healthieClientId, true);
        healthieSynced = true;
      } catch (err) {
        healthieSyncError = err instanceof Error ? err.message : String(err);
        console.error(`[AppAccessControl] Healthie sync failed for ${healthieClientId}:`, healthieSyncError);
      }

      await client.query(
        `UPDATE app_access_controls SET healthie_synced = $1, healthie_sync_error = $2 WHERE id = $3`,
        [healthieSynced, healthieSyncError, record.id]
      );
    }

    await client.query('COMMIT');

    sendAccessChangeNotification(patientId, 'granted', reason, changedBy).catch(() => { });

    return { ...record, healthie_synced: healthieSynced, healthie_sync_error: healthieSyncError };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the full audit trail for a patient's access changes.
 */
export async function getAccessControlHistory(patientId: string): Promise<AccessControlRecord[]> {
  return query<AccessControlRecord>(
    `SELECT aac.*, u.display_name AS changed_by_name
     FROM app_access_controls aac
     LEFT JOIN users u ON u.user_id = aac.changed_by
     WHERE aac.patient_id = $1
     ORDER BY aac.effective_at DESC`,
    [patientId]
  );
}

/**
 * Get a summary of all patients with their latest access status.
 */
export async function getAllPatientAccessSummaries(): Promise<PatientAccessSummary[]> {
  return query<PatientAccessSummary>(
    `SELECT 
       p.patient_id,
       p.full_name AS patient_name,
       COALESCE(hc.healthie_client_id, p.healthie_client_id) AS healthie_client_id,
       CASE 
         WHEN p.status_key = 'inactive' THEN 'revoked'
         ELSE COALESCE(latest.access_status, 'granted')
       END::text AS current_status,
       CASE
         WHEN p.status_key = 'inactive' AND latest.access_status IS NULL THEN NULL
         ELSE latest.effective_at
       END AS last_changed_at,
       u.display_name AS last_changed_by,
       CASE
         WHEN p.status_key = 'inactive' AND latest.reason IS NULL THEN 'Patient inactive in GMH'
         ELSE latest.reason
       END AS last_reason,
       CASE
         WHEN p.status_key = 'inactive' AND latest.reason_category IS NULL THEN 'administrative'
         ELSE latest.reason_category
       END AS last_reason_category,
       p.status_key
     FROM patients p
     LEFT JOIN LATERAL (
       SELECT hc2.healthie_client_id
       FROM healthie_clients hc2
       WHERE hc2.patient_id = p.patient_id::text AND hc2.is_active = true
       ORDER BY hc2.created_at DESC
       LIMIT 1
     ) hc ON TRUE
     LEFT JOIN LATERAL (
       SELECT aac.access_status, aac.effective_at, aac.changed_by, aac.reason, aac.reason_category
       FROM app_access_controls aac
       WHERE aac.patient_id = p.patient_id
       ORDER BY aac.effective_at DESC
       LIMIT 1
     ) latest ON TRUE
     LEFT JOIN users u ON u.user_id = latest.changed_by
     ORDER BY 
       CASE 
         WHEN p.status_key = 'inactive' THEN 0
         WHEN COALESCE(latest.access_status, 'granted') = 'revoked' THEN 0
         WHEN COALESCE(latest.access_status, 'granted') = 'suspended' THEN 1
         ELSE 2
       END,
       p.full_name`
  );
}

/**
 * Get aggregate stats for the access control dashboard.
 */
export async function getAccessControlStats(): Promise<AccessControlStats> {
  const [counts] = await query<{ total: string; granted: string; revoked: string; suspended: string }>(
    `SELECT
       COUNT(DISTINCT p.patient_id)::text AS total,
       COUNT(DISTINCT p.patient_id) FILTER (
         WHERE p.status_key != 'inactive' AND COALESCE(latest.access_status, 'granted') = 'granted'
       )::text AS granted,
       COUNT(DISTINCT p.patient_id) FILTER (
         WHERE p.status_key = 'inactive' OR latest.access_status = 'revoked'
       )::text AS revoked,
       COUNT(DISTINCT p.patient_id) FILTER (
         WHERE p.status_key != 'inactive' AND latest.access_status = 'suspended'
       )::text AS suspended
     FROM patients p
     LEFT JOIN LATERAL (
       SELECT aac.access_status
       FROM app_access_controls aac
       WHERE aac.patient_id = p.patient_id
       ORDER BY aac.effective_at DESC
       LIMIT 1
     ) latest ON TRUE`
  );

  const recentChanges = await query<AccessControlRecord>(
    `SELECT aac.*, u.display_name AS changed_by_name
     FROM app_access_controls aac
     LEFT JOIN users u ON u.user_id = aac.changed_by
     ORDER BY aac.effective_at DESC
     LIMIT 10`
  );

  return {
    total_patients: Number(counts?.total ?? 0),
    granted_count: Number(counts?.granted ?? 0),
    revoked_count: Number(counts?.revoked ?? 0),
    suspended_count: Number(counts?.suspended ?? 0),
    recent_changes: recentChanges,
  };
}

// ── Healthie Integration ───────────────────────────────────────────

async function syncHealthieAccessStatus(healthieClientId: string, active: boolean): Promise<void> {
  const apiKey = process.env.HEALTHIE_API_KEY;
  const apiUrl = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

  if (!apiKey) {
    throw new Error('HEALTHIE_API_KEY not configured');
  }

  const healthie = new HealthieClient({ apiKey, apiUrl });
  await healthie.updateClient(healthieClientId, { active });

  console.log(`[AppAccessControl] Healthie patient ${healthieClientId} set to active=${active}`);
}

// ── Telegram Notifications ─────────────────────────────────────────

async function sendAccessChangeNotification(
  patientId: string,
  status: AccessStatus,
  reason: string,
  changedByUserId: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) return;

  const [patient] = await query<{ full_name: string }>(
    `SELECT full_name FROM patients WHERE patient_id = $1`,
    [patientId]
  );
  const [staff] = await query<{ display_name: string | null }>(
    `SELECT display_name FROM users WHERE user_id = $1`,
    [changedByUserId]
  );

  const patientName = patient?.full_name ?? 'Unknown';
  const staffName = staff?.display_name ?? 'System';

  const emoji = status === 'granted' ? '✅' : status === 'revoked' ? '🚫' : '⏸️';
  const verb = status === 'granted' ? 'RESTORED' : status === 'revoked' ? 'REVOKED' : 'SUSPENDED';

  const message = `${emoji} APP ACCESS ${verb}\n\nPatient: ${patientName}\nReason: ${reason}\nBy: ${staffName}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (err) {
    console.error('[AppAccessControl] Telegram notification failed:', err);
  }
}

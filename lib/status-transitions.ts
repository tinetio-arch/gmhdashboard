// Phase 1.0 of Hardening Plan v3 — single chokepoint for patients.status_key writes.
//
// Architecture:
//   - Helper does a pre-flight rule check; on rule-failure it logs a "blocked" audit
//     row and returns { applied:false, blocked:true } without attempting the UPDATE.
//     This gives callers nice return semantics (no exception to catch).
//   - On accepted transitions, helper SET LOCALs caller context into session GUCs
//     and runs UPDATE. The DB trigger (migrations/20260425_status_audit.sql)
//     reads those GUCs, re-applies the same rules as a backstop, writes the
//     accepted-transition audit row, and stamps status_key_updated_at.
//   - Rogue UPDATEs that bypass the helper still hit the trigger — source falls
//     back to 'unknown' and rule violations RAISE EXCEPTION at the DB.

import type { PoolClient } from 'pg';
import { getPool } from './db';

export type StatusKey =
  | 'active'
  | 'active_pending'
  | 'hold_payment_research'
  | 'hold_patient_research'
  | 'hold_service_change'
  | 'hold_contract_renewal'
  | 'inactive_payment_research'
  | 'inactive';

export type TransitionSource =
  | 'admin_api'
  | 'webhook_processor'
  | 'cron'
  | `script:${string}`;

export interface StatusTransitionInput {
  patientId: string;                  // UUID
  toStatus: StatusKey;
  source: TransitionSource;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  client?: PoolClient;
}

export interface StatusTransitionResult {
  applied: boolean;
  blocked: boolean;
  blockReason?: string;
  fromStatus: StatusKey | null;
  toStatus: StatusKey;
}

const TERMINAL_STATUSES: ReadonlySet<StatusKey> = new Set(['inactive']);

export async function transitionStatus(
  input: StatusTransitionInput
): Promise<StatusTransitionResult> {
  const { patientId, toStatus, source, actor, reason, metadata } = input;

  const ownClient = !input.client;
  const client = input.client ?? (await getPool().connect());

  try {
    if (ownClient) await client.query('BEGIN');

    const currentRows = await client.query<{ status_key: StatusKey | null }>(
      'SELECT status_key FROM patients WHERE patient_id = $1 FOR UPDATE',
      [patientId]
    );

    if (currentRows.rows.length === 0) {
      if (ownClient) await client.query('ROLLBACK');
      throw new Error(`transitionStatus: patient_id ${patientId} not found`);
    }

    const fromStatus = currentRows.rows[0].status_key;

    // Rule 1: webhook_processor cannot set inactive
    if (toStatus === 'inactive' && source === 'webhook_processor') {
      const blockReason = 'webhook_processor cannot set status=inactive';
      await logBlocked(client, { patientId, fromStatus, toStatus, source, actor, reason, blockReason, metadata });
      if (ownClient) await client.query('COMMIT');
      return { applied: false, blocked: true, blockReason, fromStatus, toStatus };
    }

    // Rule 2: out of inactive only via admin_api or script:*
    if (
      fromStatus &&
      TERMINAL_STATUSES.has(fromStatus) &&
      fromStatus !== toStatus &&
      source !== 'admin_api' &&
      !source.startsWith('script:')
    ) {
      const blockReason = `Cannot move out of inactive via source=${source}; admin_api or script:* only`;
      await logBlocked(client, { patientId, fromStatus, toStatus, source, actor, reason, blockReason, metadata });
      if (ownClient) await client.query('COMMIT');
      return { applied: false, blocked: true, blockReason, fromStatus, toStatus };
    }

    // Pass session context to the trigger via SET LOCAL (cleared at COMMIT/ROLLBACK)
    await client.query(`SELECT set_config('gmh.status_source', $1, true)`, [source]);
    await client.query(`SELECT set_config('gmh.status_actor',  $1, true)`, [actor ?? '']);
    await client.query(`SELECT set_config('gmh.status_reason', $1, true)`, [reason ?? '']);
    await client.query(
      `SELECT set_config('gmh.status_metadata', $1, true)`,
      [metadata ? JSON.stringify(metadata) : '']
    );

    // Apply the transition. Trigger writes the audit row + sets status_key_updated_at.
    await client.query(
      `UPDATE patients
          SET status_key = $2,
              alert_status = (SELECT display_name FROM patient_status_lookup WHERE status_key = $2)
        WHERE patient_id = $1`,
      [patientId, toStatus]
    );

    if (ownClient) await client.query('COMMIT');

    return { applied: true, blocked: false, fromStatus, toStatus };
  } catch (err) {
    if (ownClient) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

interface BlockedRow {
  patientId: string;
  fromStatus: StatusKey | null;
  toStatus: StatusKey;
  source: TransitionSource;
  actor?: string;
  reason?: string;
  blockReason: string;
  metadata?: Record<string, unknown>;
}

async function logBlocked(client: PoolClient, row: BlockedRow): Promise<void> {
  await client.query(
    `INSERT INTO patient_status_audit
       (patient_id, from_status, to_status, source, actor, reason, blocked, block_reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8::jsonb)`,
    [
      row.patientId,
      row.fromStatus,
      row.toStatus,
      row.source,
      row.actor ?? null,
      row.reason ?? null,
      row.blockReason,
      row.metadata ? JSON.stringify(row.metadata) : null,
    ]
  );
}

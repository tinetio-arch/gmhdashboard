import { query } from './db';

/**
 * Patient communications ledger — repo wrapper around `patient_communications`.
 *
 * Schema authored by sibling Phase-1 task (claude-task-2859db1d):
 *   migrations/20260526_patient_communications.sql  (commit 5cbb618).
 *
 * This file is the ONLY place in the gateway that talks to the ledger schema.
 * If the table evolves, only this file needs updating.
 *
 * Schema highlights the gateway depends on:
 *   - id BIGSERIAL PK (returned as string from node-pg by default)
 *   - patient_id UUID NULL (ON DELETE SET NULL — audit trail survives patient delete)
 *   - source TEXT NOT NULL                — subsystem that initiated the send
 *   - event_type TEXT NOT NULL            — logical event slug (e.g. appointment_reminder_24h)
 *   - channel TEXT NOT NULL CHECK IN ('sms','email','push','voice','in_app','healthie_message','other')
 *   - status TEXT NOT NULL CHECK IN ('queued','sent','delivered','failed','opened','clicked','bounced','skipped','suppressed')
 *   - idempotency_key TEXT NULL, UNIQUE WHERE NOT NULL
 *   - queued_at, sent_at, delivered_at, failed_at, opened_at, created_at, updated_at TIMESTAMPTZ
 *   - subject, body TEXT — actual content sent
 *   - provider TEXT, external_id TEXT — provider-side message id (Expo ticket / GHL id / SES MessageId)
 *   - error_code TEXT, error_message TEXT
 *   - raw_metadata JSONB — anything that doesn't fit the above
 */

export type LedgerChannel = 'sms' | 'email' | 'push' | 'voice' | 'in_app' | 'healthie_message' | 'other';

export type LedgerStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'skipped'
  | 'suppressed';

export type AccountKey = 'mensHealth' | 'primaryCare' | 'abxtac';

export interface LedgerRow {
  id: string;
  patient_id: string | null;
  healthie_client_id: string | null;
  ghl_contact_id: string | null;
  clinic: string | null;
  account_key: AccountKey | null;
  source: string;
  event_type: string;
  channel: LedgerChannel;
  direction: 'outbound' | 'inbound';
  template_key: string | null;
  template_variables: Record<string, unknown> | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  recipient_push_token: string | null;
  subject: string | null;
  body: string | null;
  provider: string | null;
  external_id: string | null;
  status: LedgerStatus;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  triggered_by_user_id: string | null;
  request_id: string | null;
  raw_metadata: Record<string, unknown> | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertLedgerArgs {
  patient_id: string | null;
  healthie_client_id?: string | null;
  ghl_contact_id?: string | null;
  clinic?: string | null;
  account_key?: AccountKey | null;
  source: string;
  event_type: string;
  channel: LedgerChannel;
  direction?: 'outbound' | 'inbound';
  template_key?: string | null;
  template_variables?: Record<string, unknown> | null;
  recipient_phone?: string | null;
  recipient_email?: string | null;
  recipient_push_token?: string | null;
  subject?: string | null;
  body?: string | null;
  provider?: string | null;
  external_id?: string | null;
  status: LedgerStatus;
  error_code?: string | null;
  error_message?: string | null;
  idempotency_key?: string | null;
  triggered_by_user_id?: string | null;
  request_id?: string | null;
  raw_metadata?: Record<string, unknown> | null;
  sent_at?: string | null;
}

export interface UpdateLedgerArgs {
  status: LedgerStatus;
  provider?: string | null;
  external_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
  failed_at?: string | null;
  delivered_at?: string | null;
  raw_metadata?: Record<string, unknown> | null;
}

const ALL_COLUMNS = `
  id, patient_id, healthie_client_id, ghl_contact_id, clinic, account_key,
  source, event_type, channel, direction, template_key, template_variables,
  recipient_phone, recipient_email, recipient_push_token,
  subject, body, provider, external_id,
  status, error_code, error_message,
  idempotency_key, triggered_by_user_id, request_id, raw_metadata,
  queued_at, sent_at, delivered_at, opened_at, failed_at, created_at, updated_at
`;

export async function findByIdempotencyKey(key: string): Promise<LedgerRow | null> {
  const rows = await query<LedgerRow>(
    `SELECT ${ALL_COLUMNS} FROM patient_communications WHERE idempotency_key = $1 LIMIT 1`,
    [key]
  );
  return rows[0] ?? null;
}

/**
 * Soft dedup: returns the most-recent NON-FAILED row for this (patient, event_type)
 * within the given window. The gateway uses this to suppress redundant sends like a
 * second appointment reminder within an hour.
 */
export async function findRecentByPatientEvent(
  patientId: string,
  eventType: string,
  windowMinutes: number
): Promise<LedgerRow | null> {
  const rows = await query<LedgerRow>(
    `SELECT ${ALL_COLUMNS}
       FROM patient_communications
      WHERE patient_id = $1
        AND event_type = $2
        AND queued_at >= NOW() - ($3 || ' minutes')::interval
        AND status IN ('queued','sent','delivered')
      ORDER BY queued_at DESC
      LIMIT 1`,
    [patientId, eventType, String(windowMinutes)]
  );
  return rows[0] ?? null;
}

export async function countSentInLastHours(patientId: string, hours: number): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM patient_communications
      WHERE patient_id = $1
        AND status IN ('sent','delivered')
        AND queued_at >= NOW() - ($2 || ' hours')::interval`,
    [patientId, String(hours)]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function insertLedgerRow(args: InsertLedgerArgs): Promise<LedgerRow> {
  const rows = await query<LedgerRow>(
    `INSERT INTO patient_communications (
        patient_id, healthie_client_id, ghl_contact_id, clinic, account_key,
        source, event_type, channel, direction, template_key, template_variables,
        recipient_phone, recipient_email, recipient_push_token,
        subject, body, provider, external_id,
        status, error_code, error_message,
        idempotency_key, triggered_by_user_id, request_id, raw_metadata,
        sent_at
     ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11::jsonb,
        $12,$13,$14,
        $15,$16,$17,$18,
        $19,$20,$21,
        $22,$23,$24,$25::jsonb,
        $26
     )
     RETURNING ${ALL_COLUMNS}`,
    [
      args.patient_id,
      args.healthie_client_id ?? null,
      args.ghl_contact_id ?? null,
      args.clinic ?? null,
      args.account_key ?? null,
      args.source,
      args.event_type,
      args.channel,
      args.direction ?? 'outbound',
      args.template_key ?? null,
      args.template_variables ? JSON.stringify(args.template_variables) : null,
      args.recipient_phone ?? null,
      args.recipient_email ?? null,
      args.recipient_push_token ?? null,
      args.subject ?? null,
      args.body ?? null,
      args.provider ?? null,
      args.external_id ?? null,
      args.status,
      args.error_code ?? null,
      args.error_message ?? null,
      args.idempotency_key ?? null,
      args.triggered_by_user_id ?? null,
      args.request_id ?? null,
      args.raw_metadata ? JSON.stringify(args.raw_metadata) : null,
      args.sent_at ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('comms-ledger: INSERT returned no row');
  return row;
}

export async function updateLedgerRow(id: string, args: UpdateLedgerArgs): Promise<void> {
  await query(
    `UPDATE patient_communications
        SET status = $1,
            provider = COALESCE($2, provider),
            external_id = COALESCE($3, external_id),
            error_code = $4,
            error_message = $5,
            sent_at = COALESCE($6, sent_at),
            failed_at = COALESCE($7, failed_at),
            delivered_at = COALESCE($8, delivered_at),
            raw_metadata = COALESCE($9::jsonb, raw_metadata)
      WHERE id = $10`,
    [
      args.status,
      args.provider ?? null,
      args.external_id ?? null,
      args.error_code ?? null,
      args.error_message ?? null,
      args.sent_at ?? null,
      args.failed_at ?? null,
      args.delivered_at ?? null,
      args.raw_metadata ? JSON.stringify(args.raw_metadata) : null,
      id,
    ]
  );
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

import crypto from 'crypto';
import { query } from '@/lib/db';

export type HealthieWebhookPayload = {
  resource_id: string;
  resource_id_type: string;
  event_type: string;
  changed_fields?: string[];
  [key: string]: unknown;
};

export type PersistedWebhook = {
  resource_id: string;
  resource_id_type: string;
  event_type: string;
  changed_fields?: string[];
  raw_payload: unknown;
  signature: string | null;
  content_digest: string | null;
  content_length: number;
  received_at?: Date;
};

function computeHash(bodyText: string) {
  return crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex');
}

export async function recordHealthieWebhook(params: {
  bodyText: string;
  payload: HealthieWebhookPayload;
  signature: string | null;
  contentDigest: string | null;
  contentLength: number;
}): Promise<{ inserted: boolean; eventId: number | null }>
export async function recordHealthieWebhook(params: {
  bodyText: string;
  payload: HealthieWebhookPayload;
  signature: string | null;
  contentDigest: string | null;
  contentLength: number;
}): Promise<{ inserted: boolean; eventId: number | null }> {
  const { bodyText, payload, signature, contentDigest, contentLength } = params;
  const hash = computeHash(bodyText);

  const rows = await query<{ id: number; inserted: boolean }>(
    `INSERT INTO healthie_webhook_events (
        event_type,
        resource_id,
        resource_id_type,
        changed_fields,
        raw_payload,
        signature,
        content_digest,
        content_length,
        body_sha256
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (body_sha256) DO NOTHING
      RETURNING id, TRUE as inserted` as any,
    [
      payload.event_type,
      payload.resource_id,
      payload.resource_id_type,
      payload.changed_fields ?? null,
      payload,
      signature,
      contentDigest,
      contentLength,
      hash,
    ]
  );

  if (!rows || rows.length === 0) {
    return { inserted: false, eventId: null };
  }

  return { inserted: true, eventId: rows[0].id };
}

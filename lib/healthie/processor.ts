import { query } from '@/lib/db';

export type WebhookEventRow = {
  id: number;
  event_type: string;
  resource_id: string;
  resource_id_type: string;
  changed_fields: string[] | null;
  raw_payload: unknown;
  status: string;
  received_at: Date;
};

export type ProcessResult = 'processed' | 'skipped';

export type WebhookHandler = (event: WebhookEventRow) => Promise<ProcessResult>;

const DEFAULT_BATCH_SIZE = 100;

export async function fetchPendingEvents(limit = DEFAULT_BATCH_SIZE): Promise<WebhookEventRow[]> {
  return query<WebhookEventRow>(
    `select id, event_type, resource_id, resource_id_type, changed_fields, raw_payload, status, received_at
     from healthie_webhook_events
     where status = 'received'
     order by received_at asc
     limit $1`,
    [limit]
  );
}

export async function markProcessed(id: number) {
  await query(
    `update healthie_webhook_events
     set status = 'processed', processed_at = now(), error = null
     where id = $1`,
    [id]
  );
}

export async function markError(id: number, error: string) {
  await query(
    `update healthie_webhook_events
     set status = 'error', error = $2, processed_at = now()
     where id = $1`,
    [id, error.slice(0, 2000)]
  );
}

export async function processPendingEvents(handler: WebhookHandler) {
  const events = await fetchPendingEvents();
  if (!events.length) return { processed: 0, skipped: 0, errors: 0 };

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of events) {
    try {
      const result = await handler(event);
      if (result === 'processed') {
        await markProcessed(event.id);
        processed += 1;
      } else {
        await markProcessed(event.id);
        skipped += 1;
      }
    } catch (err) {
      errors += 1;
      await markError(event.id, err instanceof Error ? err.message : String(err));
    }
  }

  return { processed, skipped, errors };
}

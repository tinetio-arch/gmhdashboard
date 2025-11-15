import type { PoolClient } from 'pg';

export type DispenseEventType = 'created' | 'signed' | 'reopened' | 'updated' | 'deleted';

export type RecordDispenseEventInput = {
  dispenseId: string;
  eventType: DispenseEventType;
  actorUserId?: string | null;
  actorRole?: string | null;
  payload?: unknown;
};

export async function recordDispenseEvent(client: PoolClient, input: RecordDispenseEventInput): Promise<void> {
  const { dispenseId, eventType, actorUserId = null, actorRole = null, payload = null } = input;
  await client.query(
    `INSERT INTO dispense_history (
        dispense_id,
        event_type,
        actor_user_id,
        actor_role,
        event_payload
      ) VALUES ($1,$2,$3,$4,$5)`,
    [dispenseId, eventType, actorUserId, actorRole, payload ? JSON.stringify(payload) : null]
  );
}

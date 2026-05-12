/**
 * Expo Push send helper.
 * - Batches to 100 messages per request (Expo limit).
 * - Logs every send to push_send_log with a dedupe key so crons can safely re-run.
 * - Handles DeviceNotRegistered by flipping patient_push_tokens.active = FALSE.
 *
 * Receipts are checked asynchronously by /api/cron/push-receipts — we only persist
 * the ticket here. See Expo docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

import { query } from '@/lib/db';

export type PushCategory =
    | 'appointments'
    | 'messages'
    | 'results'
    | 'billing'
    | 'announcements'
    | 'promotions';

export interface PushTarget {
    expoToken: string;
    healthieClientId?: string | null;
}

export interface PushMessage {
    target: PushTarget;
    category: PushCategory;
    dedupeKey: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channelId?: string; // Android channel
    sound?: 'default' | null;
    badge?: number;
}

interface ExpoTicketOk { status: 'ok'; id: string; }
interface ExpoTicketError {
    status: 'error';
    message: string;
    details?: { error?: string };
}
type ExpoTicket = ExpoTicketOk | ExpoTicketError;

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * Filter out messages already logged (category + dedupeKey + expoToken).
 * Returns only the messages that have not been sent before.
 */
async function filterDuplicates(messages: PushMessage[]): Promise<PushMessage[]> {
    if (messages.length === 0) return [];
    const keys = messages.map(m => ({
        category: m.category,
        dedupe_key: m.dedupeKey,
        expo_token: m.target.expoToken,
    }));
    const placeholders = keys.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',');
    const params = keys.flatMap(k => [k.category, k.dedupe_key, k.expo_token]);
    const existing = await query<{ category: string; dedupe_key: string; expo_token: string }>(
        `SELECT category, dedupe_key, expo_token
         FROM push_send_log
         WHERE (category, dedupe_key, expo_token) IN (${placeholders})`,
        params
    );
    const seen = new Set(existing.map(r => `${r.category}|${r.dedupe_key}|${r.expo_token}`));
    return messages.filter(m => !seen.has(`${m.category}|${m.dedupeKey}|${m.target.expoToken}`));
}

export interface SendResult {
    attempted: number;
    sent: number;
    skippedDuplicate: number;
    failed: number;
    deviceNotRegistered: number;
}

export async function sendPushMessages(messages: PushMessage[]): Promise<SendResult> {
    const result: SendResult = {
        attempted: messages.length,
        sent: 0,
        skippedDuplicate: 0,
        failed: 0,
        deviceNotRegistered: 0,
    };

    const fresh = await filterDuplicates(messages);
    result.skippedDuplicate = messages.length - fresh.length;
    if (fresh.length === 0) return result;

    for (const batch of chunk(fresh, BATCH_SIZE)) {
        const expoPayload = batch.map(m => ({
            to: m.target.expoToken,
            title: m.title,
            body: m.body,
            data: m.data || {},
            sound: m.sound === null ? undefined : (m.sound || 'default'),
            channelId: m.channelId,
            badge: m.badge,
            priority: 'high',
        }));

        let tickets: ExpoTicket[] = [];
        try {
            const res = await fetch(EXPO_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(expoPayload),
            });
            const json = await res.json();
            tickets = (json?.data as ExpoTicket[]) || [];
            if (!Array.isArray(tickets) || tickets.length !== batch.length) {
                console.warn('[expoPush] Unexpected Expo response shape:', json);
                result.failed += batch.length;
                continue;
            }
        } catch (err) {
            console.error('[expoPush] Network error posting batch:', err);
            result.failed += batch.length;
            continue;
        }

        for (let i = 0; i < batch.length; i++) {
            const m = batch[i];
            const t = tickets[i];

            if (t.status === 'ok') {
                result.sent++;
                await query(
                    `INSERT INTO push_send_log
                        (expo_token, healthie_client_id, category, dedupe_key, title, body, data, ticket_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
                     ON CONFLICT (category, dedupe_key, expo_token) DO NOTHING`,
                    [
                        m.target.expoToken,
                        m.target.healthieClientId ?? null,
                        m.category,
                        m.dedupeKey,
                        m.title,
                        m.body,
                        JSON.stringify(m.data || {}),
                        t.id,
                    ]
                );
            } else {
                result.failed++;
                const errCode = t.details?.error || '';
                if (errCode === 'DeviceNotRegistered') {
                    result.deviceNotRegistered++;
                    await query(
                        `UPDATE patient_push_tokens SET active = FALSE, updated_at = NOW() WHERE expo_token = $1`,
                        [m.target.expoToken]
                    );
                }
                await query(
                    `INSERT INTO push_send_log
                        (expo_token, healthie_client_id, category, dedupe_key, title, body, data, receipt_status, receipt_error)
                     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'error',$8)
                     ON CONFLICT (category, dedupe_key, expo_token) DO NOTHING`,
                    [
                        m.target.expoToken,
                        m.target.healthieClientId ?? null,
                        m.category,
                        m.dedupeKey,
                        m.title,
                        m.body,
                        JSON.stringify(m.data || {}),
                        t.message || errCode || 'unknown',
                    ]
                );
            }
        }
    }

    return result;
}

interface PushTokenRow {
    expo_token: string;
    healthie_client_id: string;
    preferences: Record<string, boolean>;
}

/**
 * Load all active tokens for a Healthie client that have opted into the given category.
 */
export async function loadTokensForPatient(
    healthieClientId: string,
    category: PushCategory
): Promise<PushTokenRow[]> {
    return query<PushTokenRow>(
        `SELECT expo_token, healthie_client_id, preferences
         FROM patient_push_tokens
         WHERE healthie_client_id = $1
           AND active = TRUE
           AND COALESCE((preferences->>$2)::boolean, TRUE) = TRUE`,
        [String(healthieClientId), category]
    );
}

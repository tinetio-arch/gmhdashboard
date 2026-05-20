/**
 * lib/push.ts — Web Push sender for staff iPad/Mobile PWA assignment banners.
 *
 * Reads VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT from env.
 * Called by /api/internal/push-staff (which is in turn called by
 * ~/dispatch-mcp/lib/notify.py when a task is assigned).
 *
 * Subscriptions live in push_subscriptions (migration 20260519). On HTTP 410
 * (Gone) from the push service we delete the row — Apple/Google send 410
 * when the user uninstalls the PWA or revokes permission.
 */

import webpush from 'web-push';
import { query } from '@/lib/db';

export interface StaffPushPayload {
  title: string;
  body: string;
  url?: string;
  urgent?: boolean;
  tag?: string;
  row_uuid?: string;
}

export interface StaffPushResult {
  ipad_user_id: string;
  attempted: number;
  delivered: number;
  removed_gone: number;
  errors: Array<{ endpoint: string; status?: number; message: string }>;
}

let vapidConfigured = false;
function configureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:admin@granitemountainhealth.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys not set — sendPushToStaff will no-op');
    return false;
  }
  webpush.setVapidDetails(subj, pub, priv);
  vapidConfigured = true;
  return true;
}

interface SubRow {
  id: string;
  subscription_jsonb: { endpoint: string; keys: { p256dh: string; auth: string } };
}

export async function sendPushToStaff(
  ipadUserId: string,
  payload: StaffPushPayload
): Promise<StaffPushResult> {
  const result: StaffPushResult = {
    ipad_user_id: ipadUserId,
    attempted: 0,
    delivered: 0,
    removed_gone: 0,
    errors: [],
  };

  if (!configureVapid()) {
    result.errors.push({ endpoint: '-', message: 'VAPID not configured' });
    return result;
  }

  // Only consider subscriptions that have been touched in the last 180 days.
  // After that, we assume the browser/device is stale; if it's still alive
  // the next /api/push/subscribe ping from the PWA will revive it.
  const subs = await query<SubRow>(
    `SELECT id, subscription_jsonb
       FROM push_subscriptions
      WHERE ipad_user_id = \$1
        AND last_used_at > NOW() - INTERVAL '180 days'`,
    [ipadUserId]
  );

  if (subs.length === 0) return result;

  const body = JSON.stringify(payload);
  const sendOne = async (s: SubRow) => {
    result.attempted += 1;
    try {
      await webpush.sendNotification(s.subscription_jsonb as any, body, { TTL: 3600 });
      result.delivered += 1;
      await query(
        `UPDATE push_subscriptions SET last_used_at = NOW(), last_error = NULL WHERE id = \$1`,
        [s.id]
      );
    } catch (err: any) {
      const status = err?.statusCode as number | undefined;
      const endpoint = s.subscription_jsonb?.endpoint || '-';
      if (status === 404 || status === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = \$1`, [s.id]);
        result.removed_gone += 1;
      } else {
        await query(
          `UPDATE push_subscriptions SET last_error = \$1 WHERE id = \$2`,
          [String(err?.message || err).slice(0, 500), s.id]
        );
        result.errors.push({ endpoint, status, message: String(err?.message || err) });
      }
    }
  };

  await Promise.all(subs.map(sendOne));
  return result;
}

/**
 * POST /api/push/subscribe — Register a Web Push subscription for the staff
 * member currently signed in to the iPad/Mobile PWA.
 *
 * Body: { subscription: PushSubscriptionJSON, ipad_user_id?: string }
 *
 * If ipad_user_id is supplied it MUST match the authenticated user
 * (defence-in-depth — the client passes it for clarity but the server is
 * authoritative). We upsert on (ipad_user_id, endpoint) so a staff member
 * re-subscribing on the same device just refreshes last_used_at.
 *
 * Companion: lib/push.ts:sendPushToStaff(), public/ipad/sw.js,
 * migrations/20260519_push_subscriptions.sql.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireApiUser(request, 'read');
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw e;
  }

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sub: PushSubscriptionJSON | undefined = body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'subscription with endpoint and keys.{p256dh,auth} required' }, { status: 400 });
  }

  // Server-side authoritative ipad_user_id.
  const ipadUserId = (user as any).user_id || (user as any).id;
  if (!ipadUserId) {
    return NextResponse.json({ error: 'user has no user_id' }, { status: 400 });
  }
  if (body?.ipad_user_id && body.ipad_user_id !== ipadUserId) {
    return NextResponse.json({ error: 'ipad_user_id mismatch' }, { status: 403 });
  }

  const ua = request.headers.get('user-agent') || null;

  await query(
    `INSERT INTO push_subscriptions (ipad_user_id, subscription_jsonb, user_agent)
     VALUES (\$1, \$2::jsonb, \$3)
     ON CONFLICT (ipad_user_id, (subscription_jsonb->>'endpoint'))
     DO UPDATE SET last_used_at = NOW(), last_error = NULL, user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent)`,
    [ipadUserId, JSON.stringify(sub), ua]
  );

  return NextResponse.json({ ok: true });
}

// Allow the client to ping-refresh last_used_at without re-uploading the full sub.
export async function PATCH(request: NextRequest) {
  let user;
  try { user = await requireApiUser(request, 'read'); }
  catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw e;
  }
  const ipadUserId = (user as any).user_id || (user as any).id;
  let body: any; try { body = await request.json(); } catch { body = {}; }
  const endpoint = body?.endpoint;
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await query(
    `UPDATE push_subscriptions SET last_used_at = NOW() WHERE ipad_user_id = \$1 AND subscription_jsonb->>'endpoint' = \$2`,
    [ipadUserId, endpoint]
  );
  return NextResponse.json({ ok: true });
}

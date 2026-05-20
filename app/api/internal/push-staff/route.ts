/**
 * POST /api/internal/push-staff — Internal endpoint called by
 * ~/dispatch-mcp/lib/notify.py to fan a Web Push notification out to all
 * registered iPad/Mobile devices for a staff user.
 *
 * Auth: shared x-internal-auth header (INTERNAL_AUTH_SECRET) — same pattern
 *   as /api/cron/sync-all etc. admin sessions may also call it for debugging.
 *
 * Body: { ipad_user_id: UUID, payload: { title, body, url?, urgent?, tag?, row_uuid? } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { sendPushToStaff } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // requireApiUser('admin') accepts x-internal-auth (-> INTERNAL_USER_ID sentinel,
  // role admin) OR a real admin session.
  try {
    await requireApiUser(request, 'admin');
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

  const ipadUserId: string | undefined = body?.ipad_user_id;
  const payload = body?.payload;
  if (!ipadUserId || typeof ipadUserId !== 'string') {
    return NextResponse.json({ error: 'ipad_user_id required' }, { status: 400 });
  }
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') {
    return NextResponse.json({ error: 'payload.{title,body} required' }, { status: 400 });
  }

  const result = await sendPushToStaff(ipadUserId, payload);
  return NextResponse.json(result);
}

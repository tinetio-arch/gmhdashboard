import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try { var user = await requireApiUser(request, 'write'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'CEO access only' }, { status: 403 });
  }

  const body = await request.json();
  const { decision_id, action } = body;

  if (!decision_id || !action) {
    return NextResponse.json({ error: 'decision_id and action required' }, { status: 400 });
  }

  if (!['resolved', 'dismissed'].includes(action)) {
    return NextResponse.json({ error: 'action must be resolved or dismissed' }, { status: 400 });
  }

  const result = await query<any>(
    `UPDATE agent_action_log
     SET status = $1, resolved_at = NOW(), resolved_by = $2
     WHERE id = $3 AND status = 'needs_decision'
     RETURNING id, summary, status`,
    [action, user.email, decision_id]
  );

  if (result.length === 0) {
    return NextResponse.json({ error: 'Decision not found or already resolved' }, { status: 404 });
  }

  return NextResponse.json({ success: true, decision: result[0] });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { var user = await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'CEO access only' }, { status: 403 });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

  const [pendingDecisions, todayActivity, systemStatus] = await Promise.all([
    query<any>(
      `SELECT id, agent_name, action_type, category, summary, details, created_at
       FROM agent_action_log
       WHERE status = 'needs_decision'
         AND resolved_at IS NULL
       ORDER BY created_at DESC
       LIMIT 20`
    ),

    query<any>(
      `SELECT agent_name, action_type, category, summary, created_at
       FROM agent_action_log
       WHERE created_at >= $1::date
         AND status IN ('completed', 'resolved')
       ORDER BY created_at DESC
       LIMIT 50`,
      [today]
    ),

    query<any>(
      `SELECT agent_name, action_type, category, summary, details, created_at
       FROM agent_action_log
       WHERE agent_name = 'system_monitor'
       ORDER BY created_at DESC
       LIMIT 1`
    ),
  ]);

  const autoFixCount = todayActivity.filter((a: any) => a.action_type === 'auto_fix').length;
  const infoCount = todayActivity.filter((a: any) => a.action_type === 'info').length;
  const errorCount = todayActivity.filter((a: any) => a.action_type === 'error').length;

  return NextResponse.json({
    pending_decisions: pendingDecisions,
    today_activity: todayActivity,
    today_summary: { auto_fixes: autoFixCount, info: infoCount, errors: errorCount, total: todayActivity.length },
    system_status: systemStatus[0] || null,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { source, id, action, notes } = body;

  if (!source || !id || !action) {
    return NextResponse.json({ error: 'source, id, and action required' }, { status: 400 });
  }
  if (!['resolved', 'dismissed', 'retried'].includes(action)) {
    return NextResponse.json({ error: 'action must be resolved, dismissed, or retried' }, { status: 400 });
  }

  try {
    if (source === 'healthie_billing') {
      await query(
        `INSERT INTO dismissed_healthie_billing (billing_item_id, dismissed_by)
         VALUES ($1, $2) ON CONFLICT (billing_item_id) DO NOTHING`,
        [id, (user as any).email]
      );
      return NextResponse.json({ success: true });
    }

    if (source === 'payment_transactions') {
      if (!UUID_REGEX.test(id)) {
        return NextResponse.json({ error: `Invalid transaction ID format: ${id}` }, { status: 400 });
      }
      const newStatus = action === 'dismissed' ? 'dismissed' : 'resolved';
      const noteText = `[${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })} CEO] ${action}: ${notes || 'No notes'}`;
      const result = await query<any>(
        `UPDATE payment_transactions
         SET status = $1, error_message = COALESCE(error_message, '') || E'\n' || $2
         WHERE transaction_id = $3 AND status IN ('failed', 'error', 'declined')
         RETURNING transaction_id, status`,
        [newStatus, noteText, id]
      );
      if (result.length === 0) {
        return NextResponse.json({ error: 'Transaction not found or already resolved' }, { status: 404 });
      }
      return NextResponse.json({ success: true, updated: result[0] });
    }

    if (source === 'payment_issues') {
      if (!UUID_REGEX.test(id)) {
        return NextResponse.json({ error: `Invalid issue ID format: ${id}` }, { status: 400 });
      }
      const noteText = `[${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })} ${(user as any).email}] ${action}: ${notes || 'No notes'}`;
      const result = await query<any>(
        `UPDATE payment_issues
         SET resolved_at = NOW(),
             resolution_notes = COALESCE(resolution_notes, '') || E'\n' || $1
         WHERE issue_id = $2 AND resolved_at IS NULL
         RETURNING issue_id`,
        [noteText, id]
      );
      if (result.length === 0) {
        return NextResponse.json({ error: 'Issue not found or already resolved' }, { status: 404 });
      }
      return NextResponse.json({ success: true, updated: result[0] });
    }

    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
  } catch (error) {
    console.error('[CEO Resolve Charge] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
}

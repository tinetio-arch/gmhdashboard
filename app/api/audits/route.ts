'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createOrUpdateAudit, fetchAuditHistory, fetchAuditSummary } from '@/lib/auditQueries';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const [history, summary] = await Promise.all([fetchAuditHistory(), fetchAuditSummary()]);
    return NextResponse.json({ history, summary });
  } catch (error) {
    console.error('Failed to fetch audit data', error);
    return NextResponse.json({ error: 'Failed to fetch audit data.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');
  const body = await request.json().catch(() => ({}));
  try {
    const audit = await createOrUpdateAudit({
      performedBy: user.user_id,
      notes: typeof body?.notes === 'string' ? body.notes : null,
      auditWeek: typeof body?.auditWeek === 'string' ? body.auditWeek : null
    });
    return NextResponse.json({ audit });
  } catch (error) {
    console.error('Failed to record audit', error);
    return NextResponse.json({ error: 'Failed to record audit.' }, { status: 500 });
  }
}


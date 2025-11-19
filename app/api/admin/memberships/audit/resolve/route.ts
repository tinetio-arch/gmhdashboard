import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const user = await requireApiUser(req, 'admin');
  const body = await req.json();
  const normName: string | undefined = body?.normName;
  const notes: string | undefined = body?.notes ?? null;

  if (!normName) {
    return NextResponse.json({ error: 'normName is required' }, { status: 400 });
  }

  await query(
    `INSERT INTO membership_audit_resolutions (normalized_name, notes, resolved_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (normalized_name) DO UPDATE SET
       notes = EXCLUDED.notes,
       resolved_by = EXCLUDED.resolved_by,
       resolved_at = NOW()`,
    [normName, notes, user.user_id]
  );

  return NextResponse.json({ success: true });
}


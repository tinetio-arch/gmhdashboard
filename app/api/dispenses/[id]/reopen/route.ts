'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../../lib/auth';
import { reopenDispense } from '../../../../../lib/inventoryQueries';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireApiUser(request, 'admin');
  try {
    const body = await request.json().catch(() => ({}));
    await reopenDispense({
      dispenseId: params.id,
      actorUserId: user.user_id,
      actorRole: user.role,
      note: typeof body?.note === 'string' ? body.note : null
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to reopen dispense', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../../lib/auth';
import { signDispense } from '../../../../../lib/inventoryQueries';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireApiUser(request, 'write');
  if (!(user.can_sign || user.role === 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note : null;
    const signedIp = request.headers.get('x-forwarded-for') ?? request.ip ?? null;

    await signDispense({
      dispenseId: params.id,
      signerUserId: user.user_id,
      signerRole: user.role,
      signatureNote: note,
      signedIp
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to sign dispense', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

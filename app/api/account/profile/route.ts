'use server';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { changePasswordWithCurrent, requireApiUser, updateUserDisplayName } from '@/lib/auth';

const payloadSchema = z.object({
  displayName: z.string().max(120).optional().nullable(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(12).optional()
});

export async function PATCH(request: NextRequest) {
  const user = await requireApiUser(request, 'read');
  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { displayName, currentPassword, newPassword } = parsed.data;

  if (displayName !== undefined) {
    const nextName = displayName ? displayName.trim() : '';
    await updateUserDisplayName(user.user_id, nextName || null);
  }

  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
    }
    const updated = await changePasswordWithCurrent(user.user_id, currentPassword, newPassword);
    if (!updated) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}



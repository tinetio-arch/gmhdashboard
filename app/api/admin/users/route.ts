import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  countActiveAdmins,
  createUser,
  deleteUser,
  listUsers,
  requireApiUser,
  revokeSessionsForUser,
  updateUserDisplayName,
  updateUserEmail,
  updateUserPassword,
  updateUserRole,
  userHasRole
} from '@/lib/auth';
import { query } from '@/lib/db';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(['admin', 'write', 'read']),
  displayName: z.string().max(120).optional().nullable()
});

const updateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'write', 'read']).optional(),
  password: z.string().min(12).optional(),
  displayName: z.string().max(120).optional().nullable(),
  isActive: z.boolean().optional(),
  email: z.string().email().optional()
});

async function updateUserActiveStatus(userId: string, isActive: boolean): Promise<void> {
  await query('UPDATE users SET is_active = $2 WHERE user_id = $1', [userId, isActive]);
}

async function getUserRole(userId: string): Promise<string | null> {
  const [row] = await query<{ role: string }>('SELECT role FROM users WHERE user_id = $1', [userId]);
  return row?.role ?? null;
}

export async function GET(request: NextRequest) {
  const user = await requireApiUser(request, 'admin');
  if (!userHasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const users = await listUsers();
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { email, password, role, displayName } = parsed.data;
  const user = await createUser({ email, password, role, displayName });
  return NextResponse.json({ user }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const currentUser = await requireApiUser(request, 'admin');
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { userId, role, password, displayName, isActive, email } = parsed.data;
  const existingRole = await getUserRole(userId);
  if (!existingRole) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (currentUser.user_id === userId && role && role !== 'admin') {
    return NextResponse.json({ error: 'You cannot downgrade your own admin role.' }, { status: 400 });
  }

  try {
    if (role) {
      if (existingRole === 'admin' && role !== 'admin' && (await countActiveAdmins()) <= 1) {
        return NextResponse.json({ error: 'At least one admin must remain active.' }, { status: 400 });
      }
      await updateUserRole(userId, role);
      await revokeSessionsForUser(userId);
    }

    if (displayName !== undefined) {
      await updateUserDisplayName(userId, displayName ?? null);
    }

    if (email) {
      await updateUserEmail(userId, email);
      await revokeSessionsForUser(userId);
    }

    if (typeof isActive === 'boolean') {
      if (existingRole === 'admin' && !isActive && (await countActiveAdmins()) <= 1) {
        return NextResponse.json({ error: 'At least one admin must remain active.' }, { status: 400 });
      }
      await updateUserActiveStatus(userId, isActive);
      await revokeSessionsForUser(userId);
    }

    if (password) {
      await updateUserPassword(userId, password);
      await revokeSessionsForUser(userId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Email address is already in use.' }, { status: 400 });
    }
    console.error('Failed to update user', error);
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireApiUser(request, 'admin');
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (user.user_id === userId) {
    return NextResponse.json({ error: 'Administrators cannot delete their own account.' }, { status: 400 });
  }

  const targetRole = await getUserRole(userId);
  if (!targetRole) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (targetRole === 'admin' && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: 'At least one admin must remain active.' }, { status: 400 });
  }

  await deleteUser(userId);
  await revokeSessionsForUser(userId);
  return NextResponse.json({ success: true });
}


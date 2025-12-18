import { NextRequest, NextResponse } from 'next/server';
import {
  requireApiUser,
  listUsers,
  createUser,
  countActiveAdmins,
  revokeSessionsForUser,
  hashPassword,
  type UserRole
} from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type CreateUserBody = {
  email?: string;
  password?: string;
  role?: UserRole;
  displayName?: string | null;
  isProvider?: boolean;
  canSign?: boolean;
};

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('[API] Failed to list users:', error);
    return NextResponse.json(
      { error: 'Failed to list users' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');

    let body: CreateUserBody;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[API] Invalid JSON body for create user:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { email, password, role, displayName, isProvider, canSign } = body;

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: 'Email, password, and role are required' },
        { status: 400 }
      );
    }

    if (!['admin', 'write', 'read'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, write, or read.' },
        { status: 400 }
      );
    }

    try {
      // Check if a user with this email already exists (active or inactive)
      const [existing] = await query<{
        user_id: string;
        email: string;
        role: UserRole;
        is_active: boolean;
      }>(
        `SELECT user_id, email, role, is_active
           FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1`,
        [email.trim().toLowerCase()]
      );

      // If an inactive user exists with this email, reactivate instead of inserting a new row
      if (existing && !existing.is_active) {
        const passwordHash = await hashPassword(password);
        const [reactivated] = await query<{
          user_id: string;
          email: string;
          role: UserRole;
          display_name: string | null;
          is_active: boolean;
          is_provider: boolean;
          can_sign: boolean;
          created_at: string;
          updated_at: string;
        }>(
          `UPDATE users
              SET password_hash = $2,
                  role = $3,
                  display_name = $4,
                  is_provider = $5,
                  can_sign = $6,
                  is_active = TRUE,
                  updated_at = NOW()
            WHERE user_id = $1
        RETURNING user_id,
                  email,
                  role,
                  display_name,
                  is_active,
                  is_provider,
                  can_sign,
                  created_at,
                  updated_at`,
          [
            existing.user_id,
            passwordHash,
            role,
            displayName ?? null,
            Boolean(isProvider),
            Boolean(canSign)
          ]
        );

        return NextResponse.json({ user: reactivated, reactivated: true }, { status: 200 });
      }

      // Otherwise, fall back to the normal create path (will fail if an active user already exists)
      const user = await createUser({
        email,
        password,
        role,
        displayName: displayName ?? null,
        isProvider: Boolean(isProvider),
        canSign: Boolean(canSign)
      });

      return NextResponse.json({ user }, { status: 201 });
    } catch (createError) {
      console.error('[API] Error creating user:', createError);
      const message =
        createError instanceof Error ? createError.message : 'Failed to create user';

      // Handle common database errors (e.g. duplicate email)
      if (message.toLowerCase().includes('duplicate') || message.includes('unique')) {
        return NextResponse.json(
          { error: 'A user with that email already exists.' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[API] Unexpected error in create user:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actingUser = await requireApiUser(req, 'admin');

    let body: { userId?: string };
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[API] Invalid JSON body for delete user:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const userId = body.userId;
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    if (userId === actingUser.user_id) {
      return NextResponse.json(
        { error: 'You cannot remove your own account.' },
        { status: 400 }
      );
    }

    const [target] = await query<{
      user_id: string;
      email: string;
      role: UserRole;
      is_active: boolean;
    }>(
      `SELECT user_id, email, role, is_active
         FROM users
        WHERE user_id = $1`,
      [userId]
    );

    if (!target) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!target.is_active) {
      return NextResponse.json({
        success: true,
        message: 'User is already inactive.'
      });
    }

    if (target.role === 'admin') {
      const activeAdmins = await countActiveAdmins();
      if (activeAdmins <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last active admin.' },
          { status: 400 }
        );
      }
    }

    await query(
      `UPDATE users
          SET is_active = FALSE,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId]
    );

    await revokeSessionsForUser(userId);

    return NextResponse.json({
      success: true,
      message: `User ${target.email} has been deactivated and can no longer log in.`
    });
  } catch (error) {
    console.error('[API] Failed to remove user:', error);
    return NextResponse.json(
      { error: 'Failed to remove user' },
      { status: 500 }
    );
  }
}



import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SESSION_COOKIE_NAME,
  authenticateUser,
  clearSessionCookie,
  createSession,
  invalidateExpiredSessions,
  requireApiUser,
  revokeSessionByToken,
  setSessionCookie
} from '@/lib/auth';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await authenticateUser(email, password);
  if (!user) {
    await invalidateExpiredSessions();
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const { token, expires } = await createSession(user.user_id);
  const response = NextResponse.json({
    success: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
      created_at: user.created_at,
      updated_at: user.updated_at
    }
  });
  setSessionCookie(response, token, expires);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'read');
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await invalidateExpiredSessions();
    await revokeSessionByToken(token);
  }
  clearSessionCookie(response);
  return response;
}


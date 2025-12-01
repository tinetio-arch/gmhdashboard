import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const { token, expires } = await createSession(user.user_id);
    const response = NextResponse.json({ success: true, user: { email: user.email, role: user.role } });
    setSessionCookie(response, token, expires);

    return response;
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}


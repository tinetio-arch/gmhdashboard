import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, getSessionTokenFromRequest, revokeSessionByToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const token = getSessionTokenFromRequest(request);
    if (token) {
      await revokeSessionByToken(token);
    }

    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    const response = NextResponse.json({ error: 'Logout failed' }, { status: 500 });
    clearSessionCookie(response);
    return response;
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, clearSessionCookie, revokeSessionByToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await revokeSessionByToken(token);
  }
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}



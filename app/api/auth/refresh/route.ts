import { NextRequest, NextResponse } from 'next/server';
import {
  requireApiUser,
  createSession,
  setSessionCookie,
  revokeSessionByToken,
  getSessionTokenFromRequest,
  UnauthorizedError,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Validate the current session — requireApiUser THROWS UnauthorizedError on failure (E3)
    const user = await requireApiUser(request, 'read');

    // Revoke the old session
    const oldToken = getSessionTokenFromRequest(request);
    if (oldToken) {
      await revokeSessionByToken(oldToken);
    }

    // Create a fresh session with a new 12-hour TTL
    const { token, expires } = await createSession(user.user_id);

    // Build response and set the new cookie
    const response = NextResponse.json({ success: true });
    setSessionCookie(response, token, expires);

    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[AUTH] Session refresh failed:', error);
    return NextResponse.json({ success: false, error: 'Refresh failed' }, { status: 500 });
  }
}

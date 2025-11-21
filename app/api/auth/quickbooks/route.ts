import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireApiUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    // Check if user is authenticated and is admin
    const user = await requireApiUser(req, 'admin');

    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
    const scope = 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment openid profile email';

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'QuickBooks OAuth not configured. Please check environment variables.' },
        { status: 500 }
      );
    }

    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(7);

    // Store state in cookie for validation (expires in 10 minutes)
    const cookieStore = await cookies();
    cookieStore.set('qb_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
    });

    const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('state', state);

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    console.error('QuickBooks OAuth initiation error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate QuickBooks OAuth' },
      { status: 500 }
    );
  }
}
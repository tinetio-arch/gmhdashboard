import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    // Check if user is authenticated and is admin
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const realmId = searchParams.get('realmId');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('QuickBooks OAuth error:', error);
      return NextResponse.json(
        { error: `OAuth error: ${error}` },
        { status: 400 }
      );
    }

    if (!code || !realmId) {
      return NextResponse.json(
        { error: 'Missing authorization code or realm ID' },
        { status: 400 }
      );
    }

    // Validate state parameter
    const cookieStore = await cookies();
    const storedState = cookieStore.get('qb_oauth_state')?.value;

    if (!storedState || state !== storedState) {
      return NextResponse.json(
        { error: 'Invalid state parameter - possible CSRF attack' },
        { status: 400 }
      );
    }

    // Clear the state cookie
    cookieStore.delete('qb_oauth_state');

    // Exchange code for tokens
    const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI!;

    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

    // Store tokens in database
    await query(
      `INSERT INTO quickbooks_oauth_tokens (realm_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (realm_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [realmId, tokens.access_token, tokens.refresh_token, expiresAt]
    );

    // Update environment variable if needed (for immediate use)
    process.env.QUICKBOOKS_REALM_ID = realmId;
    process.env.QUICKBOOKS_ACCESS_TOKEN = tokens.access_token;
    process.env.QUICKBOOKS_REFRESH_TOKEN = tokens.refresh_token;

    return NextResponse.json({
      success: true,
      message: 'QuickBooks connected successfully',
      realmId: realmId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('QuickBooks OAuth callback error:', error);
    return NextResponse.json(
      { error: 'Failed to complete QuickBooks OAuth' },
      { status: 500 }
    );
  }
}
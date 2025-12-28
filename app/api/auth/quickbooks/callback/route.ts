import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/auth/quickbooks/callback
 * Handles the OAuth callback from QuickBooks after user authorizes
 */

// Helper to build correct public URL
function getPublicUrl(path: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://nowoptimal.com';
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    return `${baseUrl}${basePath}${path}`;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const realmId = searchParams.get('realmId');
    const error = searchParams.get('error');

    // Check for OAuth errors
    if (error) {
        console.error('QuickBooks OAuth error:', error);
        return NextResponse.redirect(getPublicUrl(`/admin/quickbooks?error=${encodeURIComponent(error)}`));
    }

    // Validate state parameter
    const storedState = request.cookies.get('qb_oauth_state')?.value;
    if (!state || state !== storedState) {
        console.error('Invalid OAuth state parameter');
        return NextResponse.redirect(getPublicUrl('/admin/quickbooks?error=invalid_state'));
    }

    if (!code || !realmId) {
        console.error('Missing code or realmId in callback');
        return NextResponse.redirect(getPublicUrl('/admin/quickbooks?error=missing_params'));
    }

    try {
        // Exchange authorization code for access token
        const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
        const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
        const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI!;

        const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

        const tokenResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('Token exchange failed:', errorText);
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }

        const tokens = await tokenResponse.json();

        // Store tokens in database
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        await query(
            `INSERT INTO quickbooks_oauth_tokens
        (realm_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (realm_id)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
            [
                realmId,
                tokens.access_token,
                tokens.refresh_token,
                expiresAt,
            ]
        );

        console.log('QuickBooks OAuth successful for realm:', realmId);

        // Redirect back to admin page with success
        const response = NextResponse.redirect(getPublicUrl('/admin/quickbooks?success=true'));

        // Clear state cookie
        response.cookies.delete('qb_oauth_state');

        return response;
    } catch (error) {
        console.error('Error in QuickBooks OAuth callback:', error);
        return NextResponse.redirect(
            getPublicUrl(`/admin/quickbooks?error=${encodeURIComponent(error instanceof Error ? error.message : 'unknown')}`)
        );
    }
}

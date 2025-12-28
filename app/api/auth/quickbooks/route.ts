import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/quickbooks
 * Initiates QuickBooks OAuth flow by redirecting to QuickBooks authorization page
 */
export async function GET(request: NextRequest) {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'production';

    if (!clientId || !redirectUri) {
        return NextResponse.json(
            { error: 'QuickBooks OAuth not configured. Missing CLIENT_ID or REDIRECT_URI.' },
            { status: 500 }
        );
    }

    // Generate state parameter for CSRF protection
    const state = Math.random().toString(36).substring(7);

    // QuickBooks OAuth 2.0 authorization endpoint
    const baseUrl =
        environment === 'sandbox'
            ? 'https://appcenter.intuit.com/connect/oauth2'
            : 'https://appcenter.intuit.com/connect/oauth2';

    const authUrl = new URL(baseUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    authUrl.searchParams.set('state', state);

    // Store state in cookie for validation in callback
    const response = NextResponse.redirect(authUrl.toString());
    response.cookies.set('qb_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        path: '/',
    });

    return response;
}

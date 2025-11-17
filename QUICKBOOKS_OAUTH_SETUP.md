# QuickBooks OAuth 2.0 Setup Guide

This guide walks you through setting up OAuth credentials to connect your application to QuickBooks Online API.

## Prerequisites

- A QuickBooks Online account (paid subscription)
- Access to Intuit Developer Portal
- A web server or application that can handle OAuth callbacks

## Step 1: Create an Intuit Developer Account

1. Go to [Intuit Developer Portal](https://developer.intuit.com/)
2. Click **"Sign In"** or **"Create Account"**
3. Sign in with your Intuit account (or create one if you don't have it)
4. Accept the terms and conditions

## Step 2: Create a New App

1. Once logged in, go to **"My Apps"** in the top navigation
2. Click **"Create an app"** or **"New app"**
3. Fill in the app details:
   - **App Name**: e.g., "Granite Mountain Health Payment Sync"
   - **App Type**: Select **"OAuth 2.0"**
   - **Environment**: Choose **"Production"** (or "Sandbox" for testing)
   - **Description**: Brief description of your app

4. Click **"Create"**

## Step 3: Configure OAuth Settings

After creating the app, you'll see the app dashboard. Configure these settings:

### 3.1 OAuth 2.0 Settings

1. Go to **"Keys & OAuth"** or **"OAuth 2.0"** section
2. You'll see:
   - **Client ID** (also called App ID)
   - **Client Secret** (also called App Secret)
   - **Redirect URI** (you need to set this)

3. **Set Redirect URI**:
   - For local development: `http://localhost:3000/api/auth/quickbooks/callback`
   - For production: `https://yourdomain.com/api/auth/quickbooks/callback`
   - Click **"Add"** or **"Save"** after entering

4. **Scopes**: Select the permissions your app needs:
   - ✅ `com.intuit.quickbooks.accounting` (Required for invoices, customers, payments)
   - ✅ `com.intuit.quickbooks.payment` (If you need payment processing)
   - ✅ `profile` (User profile information)
   - ✅ `email` (User email)

5. Click **"Save"** or **"Update"**

### 3.2 Copy Your Credentials

**IMPORTANT**: Copy and securely store these values:

- **Client ID** (also called App ID)
- **Client Secret** (also called App Secret)
- **Redirect URI** (the one you configured)

You'll need these in your environment variables.

## Step 4: Get Your Company ID (Realm ID)

The **Realm ID** is your QuickBooks company ID. You'll get this during the OAuth flow, but you can also find it:

1. Log into your QuickBooks Online account
2. Go to **Settings** → **Company Settings**
3. Look for **Company ID** or check the URL (it's in the URL after `/company/`)
4. Or, it will be provided in the OAuth callback response

## Step 5: Implement OAuth Flow

You need to implement the OAuth 2.0 authorization code flow. Here's how:

### 5.1 Authorization URL

When a user wants to connect their QuickBooks account, redirect them to:

```
https://appcenter.intuit.com/connect/oauth2?
  client_id=YOUR_CLIENT_ID&
  scope=com.intuit.quickbooks.accounting&
  redirect_uri=YOUR_REDIRECT_URI&
  response_type=code&
  access_type=offline&
  state=YOUR_STATE_VALUE
```

**Parameters:**
- `client_id`: Your Client ID from Step 3
- `scope`: Space-separated list of scopes (e.g., `com.intuit.quickbooks.accounting profile email`)
- `redirect_uri`: Must match exactly what you set in Step 3.1
- `response_type`: Always `code`
- `access_type`: Use `offline` to get a refresh token
- `state`: A random string for CSRF protection

### 5.2 Handle the Callback

After the user authorizes, QuickBooks redirects to your `redirect_uri` with:
- `code`: Authorization code (temporary, expires in ~5 minutes)
- `realmId`: Your company ID (this is what you need!)
- `state`: The state value you sent

### 5.3 Exchange Code for Tokens

Exchange the authorization code for access and refresh tokens:

```typescript
// Example implementation
async function exchangeCodeForTokens(code: string) {
  const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const tokens = await response.json();
  
  // tokens contains:
  // - access_token: Use for API calls (expires in ~1 hour)
  // - refresh_token: Use to get new access tokens (doesn't expire)
  // - expires_in: Seconds until access token expires
  // - realmId: Your company ID
  
  return tokens;
}
```

## Step 6: Create OAuth API Endpoints

Let's create the API routes to handle OAuth flow:

### 6.1 Authorization Endpoint

Create: `app/api/auth/quickbooks/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const scope = 'com.intuit.quickbooks.accounting profile email';
  
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'QuickBooks OAuth not configured' },
      { status: 500 }
    );
  }

  // Generate state for CSRF protection
  const state = Math.random().toString(36).substring(7);
  
  // Store state in session/cookie for validation
  
  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
```

### 6.2 Callback Endpoint

Create: `app/api/auth/quickbooks/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
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

  // Validate state (compare with stored state)
  // ... state validation logic ...

  // Exchange code for tokens
  const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI!;

  try {
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
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    // Store tokens securely (database, encrypted storage, etc.)
    // tokens.access_token
    // tokens.refresh_token
    // tokens.expires_in
    // realmId (from query param)

    // Save to environment or database
    // For production, store in database with encryption
    // For now, you can update .env file or use a secure storage service

    return NextResponse.json({
      success: true,
      message: 'QuickBooks connected successfully',
      realmId: realmId,
      // Don't return tokens in response - store them securely
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json(
      { error: 'Failed to exchange authorization code' },
      { status: 500 }
    );
    );
  }
}
```

## Step 7: Store Credentials Securely

### Option 1: Environment Variables (Development)

Add to your `.env` file:

```bash
QUICKBOOKS_CLIENT_ID=your_client_id_here
QUICKBOOKS_CLIENT_SECRET=your_client_secret_here
QUICKBOOKS_REDIRECT_URI=http://localhost:3000/api/auth/quickbooks/callback
QUICKBOOKS_REALM_ID=your_realm_id_here
QUICKBOOKS_ACCESS_TOKEN=your_access_token_here
QUICKBOOKS_REFRESH_TOKEN=your_refresh_token_here
QUICKBOOKS_ENVIRONMENT=production
```

**⚠️ Security Note**: Never commit `.env` files to git! Add `.env` to `.gitignore`.

### Option 2: Database Storage (Production)

For production, store tokens in your database with encryption:

```sql
CREATE TABLE IF NOT EXISTS quickbooks_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    realm_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## Step 8: Implement Token Refresh

Access tokens expire after ~1 hour. You need to refresh them:

```typescript
// Add to lib/quickbooks.ts or create lib/quickbooksAuth.ts
export async function refreshQuickBooksToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;

  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}
```

## Step 9: Test the Connection

1. **Start your development server**:
   ```bash
   npm run dev
   ```

2. **Visit the authorization endpoint**:
   ```
   http://localhost:3000/api/auth/quickbooks
   ```

3. **You'll be redirected to QuickBooks** to authorize the app

4. **After authorization**, you'll be redirected back with tokens

5. **Test API access**:
   ```typescript
   import { createQuickBooksClient } from '@/lib/quickbooks';
   
   const qbClient = createQuickBooksClient();
   if (qbClient) {
     const customers = await qbClient.getCustomers();
     console.log('Connected! Found', customers.length, 'customers');
   }
   ```

## Troubleshooting

### "Invalid redirect_uri"
- Make sure the redirect URI in your code **exactly matches** what you set in the Intuit Developer Portal
- Check for trailing slashes, http vs https, etc.

### "Invalid client_id or client_secret"
- Double-check you copied the credentials correctly
- Make sure you're using the right environment (sandbox vs production)

### "Token expired"
- Access tokens expire after ~1 hour
- Implement automatic token refresh before making API calls
- Check token expiration and refresh if needed

### "Insufficient permissions"
- Make sure you selected the right scopes in the Developer Portal
- Re-authorize the app if you changed scopes

### "Realm ID not found"
- Realm ID comes from the OAuth callback (`realmId` parameter)
- Make sure you're storing it when you get the tokens
- You can also find it in QuickBooks Online → Settings → Company Settings

## Production Considerations

1. **Use HTTPS**: OAuth requires HTTPS in production
2. **Secure Token Storage**: Encrypt tokens in database
3. **Token Refresh**: Implement automatic refresh before expiration
4. **Error Handling**: Handle token expiration gracefully
5. **Rate Limiting**: QuickBooks API has rate limits (500 requests per minute)
6. **Webhooks**: Consider setting up webhooks for real-time updates

## Next Steps

After OAuth is set up:

1. ✅ Test the connection
2. ✅ Map patients to QuickBooks customers
3. ✅ Set up automated sync
4. ✅ Monitor sync logs
5. ✅ Configure payment rules

## Additional Resources

- [QuickBooks API Documentation](https://developer.intuit.com/app/developer/qbo/docs/get-started)
- [OAuth 2.0 Guide](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [API Explorer](https://developer.intuit.com/app/developer/qbo/docs/get-started/explore-the-quickbooks-online-api)
- [Support Forum](https://help.developer.intuit.com/)



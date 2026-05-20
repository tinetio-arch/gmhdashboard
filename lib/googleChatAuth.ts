import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Google Chat inbound-webhook authentication (wave3b).
 *
 * Google Chat signs every request to an HTTP-endpoint app with a Bearer JWT in
 * the `Authorization` header. The token is:
 *   - issued by `chat@system.gserviceaccount.com` (iss)
 *   - audience == the Chat app's GCP **project number** (aud)
 *   - signed with Google's rotating service-account keys, published as JWKS at
 *     https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com
 *
 * We verify signature + issuer + audience + expiry before any processing.
 *
 * Audience handling: Google Chat lets the app's "Authentication Audience" be
 * configured as EITHER the GCP project number OR the app's full HTTP-endpoint
 * URL. We accept either, so the endpoint works regardless of which mode is set:
 *   - the app URL (APP_URL_AUDIENCE below) is always accepted, and
 *   - any project number(s) in GOOGLE_CHAT_PROJECT_NUMBER (comma-separated), and
 *   - any extra values in GOOGLE_CHAT_AUDIENCE (comma-separated) for overrides.
 * A token passes if its `aud` matches ANY configured value. The acceptable set
 * is never empty (the app URL is built in), so we never accept an unverified
 * request; a token with an unrecognized `aud` is rejected (401).
 *
 * Ref: https://developers.google.com/workspace/chat/authenticate-incoming-requests
 */

export const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com';

// The app's public HTTP-endpoint URL — accepted when the Chat app uses
// "App URL" as its authentication audience. Overridable via GOOGLE_CHAT_APP_URL.
const APP_URL_AUDIENCE = 'https://nowoptimal.com/ops/api/chat/webhook';

/** Build the set of acceptable JWT audiences (app URL + any configured numbers). */
export function acceptableAudiences(): string[] {
  const out = new Set<string>();
  out.add(process.env.GOOGLE_CHAT_APP_URL || APP_URL_AUDIENCE);
  for (const key of ['GOOGLE_CHAT_PROJECT_NUMBER', 'GOOGLE_CHAT_AUDIENCE']) {
    const v = process.env[key];
    if (v) v.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s));
  }
  return [...out];
}

// Lazily-created remote key set. `jose` caches keys and handles rotation,
// honoring the cert endpoint's cache-control headers.
let _remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getRemoteJwks(): JWTVerifyGetKey {
  if (!_remoteJwks) {
    _remoteJwks = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return _remoteJwks;
}

export type VerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

/** Pull the raw token out of an `Authorization: Bearer <jwt>` header. */
export function extractBearer(request: Request): string | null {
  const h = request.headers.get('authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Testable verification core. `keyResolver` is injectable so tests can verify
 * against a locally-minted key set; production passes the remote Google JWKS.
 */
export async function verifyChatToken(
  token: string,
  keyResolver: JWTVerifyGetKey,
  audience: string | string[],
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: CHAT_ISSUER,
      audience,
      // jwtVerify enforces exp/nbf automatically; allow tiny clock skew.
      clockTolerance: 30,
    });
    // If Google asserts an email-verified flag, require it to be true.
    if (payload.email_verified === false) {
      return { ok: false, status: 401, reason: 'email_not_verified' };
    }
    return { ok: true, payload: payload as Record<string, unknown> };
  } catch (err) {
    const code =
      (err as { code?: string })?.code ||
      (err as { message?: string })?.message ||
      'unknown';
    return { ok: false, status: 401, reason: `jwt_invalid:${code}` };
  }
}

/** Verify an inbound Google Chat webhook request. Fails closed. */
export async function verifyGoogleChatRequest(request: Request): Promise<VerifyResult> {
  const audiences = acceptableAudiences();
  if (audiences.length === 0) {
    // Unreachable in practice (app URL is always included) — defensive guard.
    console.error('[chat-webhook] no acceptable audiences configured — failing closed');
    return { ok: false, status: 503, reason: 'verifier_unconfigured' };
  }
  const token = extractBearer(request);
  if (!token) {
    return { ok: false, status: 401, reason: 'missing_bearer' };
  }
  return verifyChatToken(token, getRemoteJwks(), audiences);
}

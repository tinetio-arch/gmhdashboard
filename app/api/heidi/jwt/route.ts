import { NextResponse } from 'next/server';
import { createHeidiClient } from '@/lib/heidi';

const INTERNAL_SECRET = process.env.INTERNAL_AUTH_SECRET;
const DEFAULT_EMAIL = process.env.HEIDI_DEFAULT_USER_EMAIL;
const DEFAULT_INTERNAL_ID = process.env.HEIDI_DEFAULT_USER_ID || DEFAULT_EMAIL;

function isAuthorized(request: Request): boolean {
  if (!INTERNAL_SECRET) {
    return true;
  }

  const headerSecret =
    request.headers.get('x-internal-secret') ||
    request.headers.get('x-internal-auth') ||
    request.headers.get('authorization');

  if (!headerSecret) {
    return false;
  }

  if (headerSecret === INTERNAL_SECRET) {
    return true;
  }

  if (headerSecret.startsWith('Bearer ')) {
    return headerSecret.slice('Bearer '.length) === INTERNAL_SECRET;
  }

  return false;
}

async function handleRequest(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let email: string | undefined;
  let internalId: string | undefined;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    email = url.searchParams.get('email') ?? undefined;
    internalId = url.searchParams.get('internalId') ?? undefined;
  } else {
    try {
      const body = (await request.json()) as {
        email?: string;
        internalId?: string;
      };
      email = body.email;
      internalId = body.internalId;
    } catch {
      // no body provided
    }
  }

  if (!email) {
    email = DEFAULT_EMAIL ?? undefined;
  }
  if (!internalId) {
    internalId = DEFAULT_INTERNAL_ID ?? email;
  }

  if (!email || !internalId) {
    return NextResponse.json(
      { success: false, error: 'Missing email or internalId parameters' },
      { status: 400 }
    );
  }

  const heidiClient = createHeidiClient();
  if (!heidiClient) {
    return NextResponse.json(
      { success: false, error: 'Heidi API key not configured' },
      { status: 500 }
    );
  }

  try {
    const jwt = await heidiClient.requestJwtToken({
      email,
      internalId,
    });
    return NextResponse.json({
      success: true,
      token: jwt.token,
      expirationTime: jwt.expiration_time,
      email,
      internalId,
    });
  } catch (error) {
    console.error('[Heidi] JWT fetch failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve Heidi token',
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request);
}


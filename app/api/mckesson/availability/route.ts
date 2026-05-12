import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import {
  checkItemAvailability,
  isMcKessonConfigured,
  getMcKessonAccountId,
  getMcKessonShipToAccountId,
} from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mckesson/availability
 *
 * Body: {
 *   items: [{ itemId, quantity, unitOfMeasure? }],
 *   accountId?: string,         // bill-to (path) — defaults to MCKESSON_ACCOUNT_ID
 *   shipToAccountId?: string,   // body — defaults to MCKESSON_SHIP_TO_ACCOUNT_ID, then to bill-to
 * }
 */
export async function POST(request: NextRequest) {
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  try {
    if (!isMcKessonConfigured()) {
      return NextResponse.json({ error: 'McKesson not configured' }, { status: 503 });
    }

    const body = await request.json();
    const accountId = body.accountId || getMcKessonAccountId();
    const shipToAccountId = body.shipToAccountId || getMcKessonShipToAccountId();
    const items = body.items;

    if (!accountId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'accountId and items[] are required' }, { status: 400 });
    }

    const availability = await checkItemAvailability(accountId, items, shipToAccountId);
    return NextResponse.json({ success: true, data: availability });
  } catch (error: any) {
    console.error('[MCKESSON] Availability check failed:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

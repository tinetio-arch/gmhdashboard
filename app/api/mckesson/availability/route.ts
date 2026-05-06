import { NextRequest, NextResponse } from 'next/server';
import { checkItemAvailability, isMcKessonConfigured } from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mckesson/availability
 * Check item availability on McKesson for given item IDs.
 *
 * Body: { accountId: string, items: [{ itemId: number, quantity: number, unitOfMeasure?: string }], shipToAccountId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    if (!isMcKessonConfigured()) {
      return NextResponse.json({ error: 'McKesson not configured' }, { status: 503 });
    }

    const body = await request.json();
    const { accountId, items, shipToAccountId } = body;

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

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import {
  placeAndRecordOrder,
  fetchMcKessonOrders,
  isMcKessonConfigured,
  getMcKessonEnvironment,
  getMcKessonAccountId,
  getMcKessonShipToAccountId,
} from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mckesson/orders
 * List McKesson orders from our database.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const orders = await fetchMcKessonOrders(limit);
    return NextResponse.json({ success: true, data: orders, environment: getMcKessonEnvironment() });
  } catch (error: any) {
    console.error('[MCKESSON] Failed to fetch orders:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/mckesson/orders
 * Place a new order on McKesson (sandbox only) and record in database.
 *
 * Body: {
 *   accountId: string,
 *   shipToAccountId: string,
 *   poNumber?: string,
 *   items: [{ supplyItemId?: number, mckItemId: string, quantity: number, unitOfMeasure?: string }]
 * }
 */
export async function POST(request: NextRequest) {
  try { await requireApiUser(request, 'write'); }
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
    const { poNumber, items } = body;

    if (!accountId || !shipToAccountId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'accountId, shipToAccountId (or env defaults), and items[] are required' },
        { status: 400 }
      );
    }

    for (const item of items) {
      if (!item.mckItemId || !item.quantity || item.quantity < 1) {
        return NextResponse.json(
          { error: 'Each item needs mckItemId and quantity >= 1' },
          { status: 400 }
        );
      }
    }

    const result = await placeAndRecordOrder(
      accountId,
      items,
      shipToAccountId,
      poNumber,
      'dashboard'
    );

    return NextResponse.json({
      success: true,
      accepted: result.mckResponse.accepted,
      orderId: result.mckResponse.orderId,
      dbOrderId: result.dbOrder.id,
      validation: result.mckResponse.validation,
      environment: getMcKessonEnvironment(),
    });
  } catch (error: any) {
    console.error('[MCKESSON] Order submission failed:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

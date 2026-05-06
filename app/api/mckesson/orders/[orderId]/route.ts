import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMcKessonOrderById,
  refreshOrderStatus,
  getMcKessonEnvironment,
} from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mckesson/orders/[orderId]
 * Get order details from our database. Pass ?refresh=true to also refresh from McKesson API.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = await params;
    const dbId = parseInt(orderId, 10);
    if (isNaN(dbId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const shouldRefresh = url.searchParams.get('refresh') === 'true';
    const accountId = url.searchParams.get('accountId');

    let order = await fetchMcKessonOrderById(dbId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (shouldRefresh && accountId) {
      const refreshed = await refreshOrderStatus(dbId, accountId);
      if (refreshed) order = refreshed;
    }

    return NextResponse.json({
      success: true,
      data: order,
      environment: getMcKessonEnvironment(),
    });
  } catch (error: any) {
    console.error('[MCKESSON] Failed to fetch order details:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

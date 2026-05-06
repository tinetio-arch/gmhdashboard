import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchMappedSupplyItems, mapSupplyToMcKesson } from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mckesson/mapping
 * List supply items that have a McKesson item ID mapped.
 */
export async function GET() {
  try {
    const items = await fetchMappedSupplyItems();
    return NextResponse.json({ success: true, data: items });
  } catch (error: any) {
    console.error('[MCKESSON] Failed to fetch mapped items:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/mckesson/mapping
 * Map a supply item to a McKesson item ID.
 *
 * Body: { supplyItemId: number, mckItemId: string, unitOfMeasure?: string }
 */
export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request, 'write');

    const body = await request.json();
    const { supplyItemId, mckItemId, unitOfMeasure } = body;

    if (!supplyItemId || !mckItemId) {
      return NextResponse.json({ error: 'supplyItemId and mckItemId are required' }, { status: 400 });
    }

    await mapSupplyToMcKesson(supplyItemId, mckItemId, unitOfMeasure || 'EA');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[MCKESSON] Failed to map item:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

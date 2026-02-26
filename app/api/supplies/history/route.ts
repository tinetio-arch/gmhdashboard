import { NextResponse } from 'next/server';
import { fetchSupplyHistory } from '@/lib/supplyQueries';

export const dynamic = 'force-dynamic';

// GET /api/supplies/history — supply change history
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const itemId = searchParams.get('item_id');
        const limit = parseInt(searchParams.get('limit') || '50', 10);

        const history = await fetchSupplyHistory(
            itemId ? parseInt(itemId, 10) : undefined,
            limit
        );
        return NextResponse.json({ history });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

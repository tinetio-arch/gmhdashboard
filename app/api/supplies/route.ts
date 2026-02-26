import { NextResponse } from 'next/server';
import { fetchSupplyItems, createSupplyItem, fetchSupplyCategories, fetchSupplyAlerts } from '@/lib/supplyQueries';

export const dynamic = 'force-dynamic';

// GET /api/supplies — list all supply items with counts
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get('category') || undefined;
        const location = searchParams.get('location') || undefined;
        const alertsOnly = searchParams.get('alerts') === 'true';

        if (alertsOnly) {
            const alerts = await fetchSupplyAlerts(location);
            return NextResponse.json({ items: alerts });
        }

        const [items, categories] = await Promise.all([
            fetchSupplyItems(location, category),
            fetchSupplyCategories(),
        ]);
        return NextResponse.json({ items, categories });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// POST /api/supplies — create a new supply item
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, category, unit, par_level, reorder_qty, notes } = body;

        if (!name || !category) {
            return NextResponse.json({ error: 'name and category are required' }, { status: 400 });
        }

        const id = await createSupplyItem(name, category, unit, par_level, reorder_qty, notes);
        return NextResponse.json({ id }, { status: 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

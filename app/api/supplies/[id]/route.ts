import { NextResponse } from 'next/server';
import { updateSupplyItem } from '@/lib/supplyQueries';

// PATCH /api/supplies/[id] — update a supply item's details
export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        }

        const body = await request.json();
        const allowed = [
            'name', 'category', 'unit', 'par_level', 'reorder_qty', 'notes', 'active',
            'supplier_name', 'unit_cost', 'unit_cost_uom', 'unit_cost_source',
            'supplier_part_number', 'supplier_url',
        ];
        const updates: Record<string, unknown> = {};
        for (const key of allowed) {
            if (key in body) updates[key] = body[key];
        }

        await updateSupplyItem(id, updates as any);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

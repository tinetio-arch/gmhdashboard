import { NextResponse } from 'next/server';
import { recordSupplyUse } from '@/lib/supplyQueries';

// POST /api/supplies/use — use/decrement supplies, optionally linked to a patient visit
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items, recorded_by } = body;

        // items: Array<{ item_id, qty_used, healthie_patient_id?, healthie_patient_name?, notes? }>
        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'items array is required' }, { status: 400 });
        }

        for (const item of items) {
            if (!item.item_id || !item.qty_used || item.qty_used < 1) {
                return NextResponse.json({ error: 'Each item needs item_id and qty_used >= 1' }, { status: 400 });
            }
            await recordSupplyUse(item, recorded_by);
        }

        return NextResponse.json({ ok: true, count: items.length });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

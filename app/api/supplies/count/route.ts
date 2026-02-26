import { NextResponse } from 'next/server';
import { bulkRecordCounts } from '@/lib/supplyQueries';

// POST /api/supplies/count — bulk count submission
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { entries, recorded_by } = body;

        if (!Array.isArray(entries) || entries.length === 0) {
            return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
        }

        await bulkRecordCounts(entries, recorded_by);
        return NextResponse.json({ ok: true, count: entries.length });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

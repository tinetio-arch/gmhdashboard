import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { expoToken } = await req.json();
        if (!expoToken) {
            return NextResponse.json({ error: 'expoToken required' }, { status: 400 });
        }

        await query(
            `UPDATE patient_push_tokens
             SET active = FALSE, updated_at = NOW()
             WHERE expo_token = $1`,
            [expoToken]
        );

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[push-tokens/unregister] Error:', err.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

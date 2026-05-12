import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const ALLOWED_KEYS = new Set([
    'appointments', 'messages', 'results', 'billing', 'announcements', 'promotions',
]);

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { expoToken, preferences } = await req.json();
        if (!expoToken || !preferences || typeof preferences !== 'object') {
            return NextResponse.json({ error: 'expoToken and preferences required' }, { status: 400 });
        }

        const clean: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(preferences)) {
            if (ALLOWED_KEYS.has(k)) clean[k] = !!v;
        }

        await query(
            `UPDATE patient_push_tokens
             SET preferences = preferences || $2::jsonb,
                 last_seen_at = NOW(),
                 updated_at = NOW()
             WHERE expo_token = $1`,
            [expoToken, JSON.stringify(clean)]
        );

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[push-tokens/preferences] Error:', err.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

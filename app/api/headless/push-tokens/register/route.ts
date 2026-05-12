import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const DEFAULT_PREFS = {
    appointments: true,
    messages: true,
    results: true,
    billing: true,
    announcements: true,
    promotions: false,
};

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { healthieId, expoToken, platform, userGroupId, preferences } = await req.json();
        if (!healthieId || !expoToken || !platform) {
            return NextResponse.json({ error: 'healthieId, expoToken, platform required' }, { status: 400 });
        }

        const prefs = { ...DEFAULT_PREFS, ...(preferences || {}) };

        await query(
            `INSERT INTO patient_push_tokens (expo_token, healthie_client_id, user_group_id, platform, preferences, active, last_seen_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, NOW(), NOW())
             ON CONFLICT (expo_token) DO UPDATE SET
                healthie_client_id = EXCLUDED.healthie_client_id,
                user_group_id      = EXCLUDED.user_group_id,
                platform           = EXCLUDED.platform,
                preferences        = EXCLUDED.preferences,
                active             = TRUE,
                last_seen_at       = NOW(),
                updated_at         = NOW()`,
            [expoToken, String(healthieId), userGroupId ? String(userGroupId) : null, platform, JSON.stringify(prefs)]
        );

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[push-tokens/register] Error:', err.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

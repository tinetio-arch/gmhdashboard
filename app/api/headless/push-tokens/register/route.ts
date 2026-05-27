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

// Accept "2", "2.2", "2.2.0", "2.2.0-beta.1" — reject anything wild so we
// never store garbage that the gate's compareSemver will choke on. The
// app-version gate treats unparsable strings as `unknown` (do not nudge),
// but cleaner to reject at the boundary.
const APP_VERSION_RE = /^[0-9]+(\.[0-9]+){0,3}(-[A-Za-z0-9.+-]+)?$/;

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { healthieId, expoToken, platform, userGroupId, preferences, appVersion } = await req.json();
        if (!healthieId || !expoToken || !platform) {
            return NextResponse.json({ error: 'healthieId, expoToken, platform required' }, { status: 400 });
        }

        const prefs = { ...DEFAULT_PREFS, ...(preferences || {}) };

        // Optional. If the mobile client sends a string but it's malformed,
        // store NULL — the gate's `unknown` branch handles that correctly.
        const cleanAppVersion: string | null =
            typeof appVersion === 'string' && APP_VERSION_RE.test(appVersion.trim())
                ? appVersion.trim()
                : null;

        await query(
            `INSERT INTO patient_push_tokens (expo_token, healthie_client_id, user_group_id, platform, preferences, app_version, active, last_seen_at, last_heartbeat_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, NOW(), NOW(), NOW())
             ON CONFLICT (expo_token) DO UPDATE SET
                healthie_client_id = EXCLUDED.healthie_client_id,
                user_group_id      = EXCLUDED.user_group_id,
                platform           = EXCLUDED.platform,
                preferences        = EXCLUDED.preferences,
                app_version        = COALESCE(EXCLUDED.app_version, patient_push_tokens.app_version),
                active             = TRUE,
                last_seen_at       = NOW(),
                last_heartbeat_at  = NOW(),
                updated_at         = NOW()`,
            [
                expoToken,
                String(healthieId),
                userGroupId ? String(userGroupId) : null,
                platform,
                JSON.stringify(prefs),
                cleanAppVersion,
            ]
        );

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[push-tokens/register] Error:', err.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

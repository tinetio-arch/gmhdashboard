import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, verifyPassword } from '@/lib/auth';
import { query } from '@/lib/db';

// Rate limiting: track unlock attempts per IP
const unlockAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = unlockAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        unlockAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    if (entry.count >= MAX_ATTEMPTS) return false;
    entry.count++;
    return true;
}

/**
 * POST /api/ipad/kiosk/unlock
 * Validates PIN to exit kiosk mode. Updates audit log.
 * Body: { pin: "1234", kiosk_session_ids?: string[] }
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'read');
        const body = await request.json();
        const { pin, kiosk_session_ids } = body;

        if (!pin || typeof pin !== 'string') {
            return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
        }

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (!checkRateLimit(ip)) {
            return NextResponse.json({ error: 'Too many attempts. Wait 1 minute.' }, { status: 429 });
        }

        const rows = await query<{ pin_hash: string }>('SELECT pin_hash FROM kiosk_config LIMIT 1');
        if (rows.length === 0) {
            return NextResponse.json({ error: 'No kiosk PIN configured' }, { status: 404 });
        }

        const valid = await verifyPassword(pin, rows[0].pin_hash);
        if (!valid) {
            return NextResponse.json({ valid: false });
        }

        // Update audit records — mark who unlocked
        if (kiosk_session_ids && Array.isArray(kiosk_session_ids) && kiosk_session_ids.length > 0) {
            for (const sid of kiosk_session_ids) {
                await query(
                    `UPDATE kiosk_form_sessions SET unlocked_by = $1
                     WHERE session_id = $2 AND unlocked_by IS NULL`,
                    [user.userId, sid]
                );
            }
            // Mark any in_progress sessions as abandoned
            for (const sid of kiosk_session_ids) {
                await query(
                    `UPDATE kiosk_form_sessions SET status = 'abandoned', completed_at = NOW()
                     WHERE session_id = $1 AND status = 'in_progress'`,
                    [sid]
                );
            }
        }

        return NextResponse.json({ valid: true });
    } catch (error) {
        console.error('[Kiosk Unlock] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, hashPassword, verifyPassword } from '@/lib/auth';
import { query } from '@/lib/db';

// Rate limiting: track PIN validation attempts per IP
const pinAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = pinAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        pinAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    if (entry.count >= MAX_ATTEMPTS) return false;
    entry.count++;
    return true;
}

/**
 * GET /api/ipad/kiosk/pin — Check if a kiosk PIN is configured
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const rows = await query<{ config_id: string }>('SELECT config_id FROM kiosk_config LIMIT 1');
        return NextResponse.json({ configured: rows.length > 0 });
    } catch (error: any) {
        if (error?.status === 401 || error?.message === 'Unauthorized') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[Kiosk PIN] GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/ipad/kiosk/pin — Set or validate PIN
 * Body: { action: "set" | "validate", pin: "1234" }
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'read');
        const body = await request.json();
        const { action, pin } = body;

        if (!pin || typeof pin !== 'string') {
            return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
        }

        if (action === 'set') {
            // Admin only for setting PIN
            const adminUser = await requireApiUser(request, 'admin');
            if (!/^\d{4}$/.test(pin)) {
                return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
            }

            const pinHash = await hashPassword(pin);

            // Upsert: delete existing, insert new
            await query('DELETE FROM kiosk_config');
            await query(
                'INSERT INTO kiosk_config (pin_hash, set_by) VALUES ($1, $2)',
                [pinHash, adminUser.userId]
            );

            return NextResponse.json({ success: true, message: 'Kiosk PIN set' });
        }

        if (action === 'validate') {
            const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
            if (!checkRateLimit(ip)) {
                return NextResponse.json({ error: 'Too many attempts. Wait 1 minute.' }, { status: 429 });
            }

            const rows = await query<{ pin_hash: string }>('SELECT pin_hash FROM kiosk_config LIMIT 1');
            if (rows.length === 0) {
                return NextResponse.json({ error: 'No kiosk PIN configured' }, { status: 404 });
            }

            const valid = await verifyPassword(pin, rows[0].pin_hash);
            return NextResponse.json({ valid });
        }

        return NextResponse.json({ error: 'Invalid action. Use "set" or "validate".' }, { status: 400 });
    } catch (error: any) {
        if (error?.status === 401 || error?.message === 'Unauthorized') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[Kiosk PIN] POST error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

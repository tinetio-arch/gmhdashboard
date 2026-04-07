import { NextRequest, NextResponse } from 'next/server';

const GHL_WEBHOOK_URL = 'http://localhost:3001';

/**
 * POST /api/jarvis/balance
 * Proxies to the GHL webhook server's patient-balance endpoint.
 * Auth: x-jarvis-secret header
 */
export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        const response = await fetch(`${GHL_WEBHOOK_URL}/api/ghl/patient-balance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': process.env.GHL_WEBHOOK_SECRET || '',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('[Jarvis Balance Proxy] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 502 });
    }
}

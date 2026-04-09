import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// FIX(2026-04-09): Added x-jarvis-secret auth — endpoint was previously unauthenticated
// POST: Record first app login timestamp for a patient
// Called by Lambda on every get_dashboard_stats — only stamps once (first time)
export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { healthie_user_id } = await req.json();
        if (!healthie_user_id) {
            return NextResponse.json({ error: 'healthie_user_id required' }, { status: 400 });
        }

        // Only set first_app_login if it's currently NULL
        const result = await query(
            `UPDATE patients SET first_app_login = NOW()
       WHERE healthie_client_id = $1 AND first_app_login IS NULL
       RETURNING patient_id, first_app_login`,
            [healthie_user_id]
        );

        // Also try via healthie_clients mapping table
        if (result.length === 0) {
            await query(
                `UPDATE patients SET first_app_login = NOW()
         WHERE patient_id IN (
           SELECT patient_id::uuid FROM healthie_clients WHERE healthie_client_id = $1 AND is_active = true
         ) AND first_app_login IS NULL`,
                [healthie_user_id]
            );
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[record-app-login] Error:', err.message);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}

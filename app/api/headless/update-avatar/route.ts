import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/headless/update-avatar
 * 
 * Called by the headless mobile app Lambda after a patient uploads
 * an avatar to Healthie. Stores the Healthie-hosted avatar URL
 * in the GMH Dashboard patients table.
 * 
 * Body: { healthie_id: string, avatar_url: string }
 *
 * Auth: x-jarvis-secret header (matches other headless endpoints).
 */
export async function POST(request: NextRequest) {
    // FIX(2026-04-15): Added x-jarvis-secret auth — endpoint was previously unauthenticated,
    // allowing anyone to overwrite a patient's avatar URL by spoofing healthie_id
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthie_id, avatar_url } = body;

        if (!healthie_id || !avatar_url) {
            return NextResponse.json(
                { error: 'healthie_id and avatar_url are required' },
                { status: 400 }
            );
        }

        console.log(`[headless/update-avatar] Updating avatar for healthie_id=${healthie_id}`);

        // FIX(2026-04-09): Check both patients.healthie_client_id AND healthie_clients table
        let result = await query(
            `UPDATE patients
       SET avatar_url = $1, updated_at = NOW()
       WHERE healthie_client_id = $2
       RETURNING patient_id, full_name, avatar_url`,
            [avatar_url, healthie_id]
        );

        // Fallback: check healthie_clients join table
        if (result.length === 0) {
            result = await query(
                `UPDATE patients
           SET avatar_url = $1, updated_at = NOW()
           WHERE patient_id = (SELECT patient_id::uuid FROM healthie_clients WHERE healthie_client_id = $2 AND is_active = true LIMIT 1)
           RETURNING patient_id, full_name, avatar_url`,
                [avatar_url, healthie_id]
            );
        }

        if (result.length === 0) {
            console.log(`[headless/update-avatar] No patient found with healthie_id=${healthie_id}`);
            return NextResponse.json(
                { success: false, error: 'Patient not found' },
                { status: 404 }
            );
        }

        console.log(`[headless/update-avatar] ✅ Updated avatar for ${result[0].full_name} (${result[0].patient_id})`);

        return NextResponse.json({
            success: true,
            patient_id: result[0].patient_id,
            patient_name: result[0].full_name
        });
    } catch (error) {
        console.error('[headless/update-avatar] Error:', error);
        return NextResponse.json(
            { error: 'Failed to update avatar' },
            { status: 500 }
        );
    }
}

// Also support GET for health check / debugging
export async function GET() {
    return NextResponse.json({
        endpoint: 'headless/update-avatar',
        status: 'active',
        method: 'POST',
        required_fields: ['healthie_id', 'avatar_url']
    });
}

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
 * No auth required — internal endpoint called by Lambda only.
 * Follows the same pattern as the lab-status headless endpoint.
 */
export async function POST(request: NextRequest) {
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

        const result = await query(
            `UPDATE patients 
       SET avatar_url = $1, updated_at = NOW() 
       WHERE healthie_client_id = $2
       RETURNING patient_id, full_name, avatar_url`,
            [avatar_url, healthie_id]
        );

        if (result.length === 0) {
            console.log(`[headless/update-avatar] No patient found with healthie_client_id=${healthie_id}`);
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

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// FIX(2026-04-09): Added x-jarvis-secret auth — endpoint was previously unauthenticated
// GET: Returns patient tags and unlocked appointment type IDs
// Called by the Lambda to determine what services a patient can book
export async function GET(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieUserId = req.nextUrl.searchParams.get('healthie_user_id');
    const patientId = req.nextUrl.searchParams.get('patient_id');

    if (!healthieUserId && !patientId) {
        return NextResponse.json({ error: 'healthie_user_id or patient_id required' }, { status: 400 });
    }

    // Get patient tags
    // FIX(2026-04-09): query() returns rows directly (not {rows}), was causing crash
    const tagRows = healthieUserId
        ? await query<{ tag: string }>(`SELECT tag FROM patient_service_tags WHERE healthie_user_id = $1`, [healthieUserId])
        : await query<{ tag: string }>(`SELECT tag FROM patient_service_tags WHERE patient_id = $1`, [patientId]);

    const tags = tagRows.map((r) => r.tag);

    // Get unlocked appointment type IDs from those tags
    const configRows = tags.length > 0
        ? await query<{ appointment_type_id: string }>(
            `SELECT DISTINCT appointment_type_id FROM service_tag_config WHERE tag = ANY($1) AND appointment_type_id IS NOT NULL AND active = true`,
            [tags]
        )
        : [];

    const unlockedAppointmentTypeIds = configRows.map((r) => r.appointment_type_id);

    return NextResponse.json({
        tags,
        unlockedAppointmentTypeIds,
    });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: List recent scribe sessions with note data
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const patientId = url.searchParams.get('patient_id');

        let whereClause = '';
        const params: any[] = [limit];

        if (patientId) {
            whereClause = 'WHERE ss.patient_id = $2';
            params.push(patientId);
        }

        const sessions = await query<any>(`
            SELECT 
                ss.session_id,
                ss.patient_id,
                p.full_name as patient_name,
                ss.visit_type,
                ss.status,
                ss.transcript_source,
                ss.created_at,
                ss.updated_at,
                CASE WHEN ss.transcript IS NOT NULL THEN LENGTH(ss.transcript) ELSE 0 END as transcript_length,
                sn.note_id,
                sn.healthie_status,
                sn.healthie_note_id,
                CASE WHEN sn.soap_subjective IS NOT NULL THEN true ELSE false END as has_note
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id::text = p.patient_id::text
            LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
            ${whereClause}
            ORDER BY ss.created_at DESC
            LIMIT $1
        `, params);

        return NextResponse.json({
            success: true,
            data: sessions,
        });
    } catch (error) {
        console.error('[Scribe Sessions] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

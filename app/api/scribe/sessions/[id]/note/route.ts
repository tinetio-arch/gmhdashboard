import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scribe/sessions/[id]/note
 * Fetch existing note for a session (avoid regenerating)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        await requireApiUser(request, 'read');
        const sessionId = params.id;

        // Fetch the most recent note for this session
        const notes = await query<any>(`
            SELECT
                sn.note_id,
                sn.session_id,
                sn.patient_id,
                sn.visit_type,
                sn.soap_subjective,
                sn.soap_objective,
                sn.soap_assessment,
                sn.soap_plan,
                sn.icd10_codes,
                sn.cpt_codes,
                sn.full_note_text,
                sn.ai_model,
                sn.healthie_note_id,
                sn.healthie_status,
                sn.reviewed_by,
                sn.reviewed_at,
                sn.created_at,
                sn.updated_at,
                sn.supplementary_docs,
                ss.transcript,
                ss.patient_id as session_patient_id
            FROM scribe_notes sn
            JOIN scribe_sessions ss ON sn.session_id = ss.session_id
            WHERE sn.session_id = $1
            ORDER BY sn.created_at DESC
            LIMIT 1
        `, [sessionId]);

        if (notes.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No note found for this session'
            }, { status: 404 });
        }

        const note = notes[0];

        // Format response to match generate-note structure
        return NextResponse.json({
            success: true,
            data: {
                note_id: note.note_id,
                session_id: note.session_id,
                patient_id: note.patient_id,
                visit_type: note.visit_type,
                soap: {
                    subjective: note.soap_subjective || '',
                    objective: note.soap_objective || '',
                    assessment: note.soap_assessment || '',
                    plan: note.soap_plan || '',
                },
                soap_subjective: note.soap_subjective || '',
                soap_objective: note.soap_objective || '',
                soap_assessment: note.soap_assessment || '',
                soap_plan: note.soap_plan || '',
                icd10_codes: note.icd10_codes || [],
                cpt_codes: note.cpt_codes || [],
                full_note_text: note.full_note_text || '',
                ai_model: note.ai_model,
                healthie_note_id: note.healthie_note_id,
                healthie_status: note.healthie_status,
                reviewed_by: note.reviewed_by,
                reviewed_at: note.reviewed_at,
                created_at: note.created_at,
                updated_at: note.updated_at,
                supplementary_docs: note.supplementary_docs || {},
                transcript: note.transcript,
            }
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[Scribe:GetNote] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to fetch note' },
            { status: 500 }
        );
    }
}

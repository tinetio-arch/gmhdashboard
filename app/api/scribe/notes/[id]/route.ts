import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: Fetch full note
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const [note] = await query<any>(
            `SELECT sn.*, p.full_name as patient_name, p.dob as patient_dob
             FROM scribe_notes sn
             LEFT JOIN patients p ON sn.patient_id::text = p.patient_id::text
             WHERE sn.note_id = $1`,
            [params.id]
        );

        if (!note) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: note });
    } catch (error) {
        console.error('[Scribe:Note] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// PATCH: Direct edit of note fields (SOAP sections, codes, etc.)
export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const noteId = params.id;
        const body = await request.json();

        // Only allow editing specific fields
        const editableFields: Record<string, string> = {
            soap_subjective: 'soap_subjective',
            soap_objective: 'soap_objective',
            soap_assessment: 'soap_assessment',
            soap_plan: 'soap_plan',
            icd10_codes: 'icd10_codes',
            cpt_codes: 'cpt_codes',
            full_note_text: 'full_note_text',
            visit_type: 'visit_type',
        };

        const setClauses: string[] = ['updated_at = NOW()'];
        const values: any[] = [];
        let paramIdx = 1;

        for (const [inputKey, dbColumn] of Object.entries(editableFields)) {
            if (body[inputKey] !== undefined) {
                setClauses.push(`${dbColumn} = $${paramIdx++}`);
                // Serialize arrays/objects as JSON strings for JSONB columns
                const val = (inputKey === 'icd10_codes' || inputKey === 'cpt_codes')
                    ? JSON.stringify(body[inputKey])
                    : body[inputKey];
                values.push(val);
            }
        }

        if (values.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No editable fields provided' },
                { status: 400 }
            );
        }

        values.push(noteId);

        const [updated] = await query<any>(`
            UPDATE scribe_notes
            SET ${setClauses.join(', ')}
            WHERE note_id = $${paramIdx}
            RETURNING *
        `, values);

        if (!updated) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error('[Scribe:Note:Patch] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

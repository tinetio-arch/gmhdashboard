import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: Fetch single session with full note data
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
        const sessionId = params.id;

        const [session] = await query<any>(`
            SELECT 
                ss.*,
                p.full_name as patient_name,
                p.dob as patient_dob,
                p.healthie_client_id,
                sn.note_id,
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
                sn.reviewed_at
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id = p.patient_id
            LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
            WHERE ss.session_id = $1
        `, [sessionId]);

        if (!session) {
            return NextResponse.json(
                { success: false, error: 'Session not found' }, { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: session,
        });
    } catch (error) {
        console.error('[Scribe:Session] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// PATCH: Update session (status, reopen, discard)
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
        const sessionId = params.id;
        const body = await request.json();
        const { status, visit_type } = body;

        // Validate status if provided
        const validStatuses = ['recording', 'transcribed', 'note_generated', 'submitted', 'signed'];
        if (status && !validStatuses.includes(status)) {
            return NextResponse.json(
                { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
                { status: 400 }
            );
        }

        // Build dynamic update
        const setClauses: string[] = ['updated_at = NOW()'];
        const values: any[] = [];
        let paramIdx = 1;

        if (status) {
            setClauses.push(`status = $${paramIdx++}`);
            values.push(status);
        }
        if (visit_type) {
            setClauses.push(`visit_type = $${paramIdx++}`);
            values.push(visit_type);
        }

        values.push(sessionId);

        const [updated] = await query<any>(`
            UPDATE scribe_sessions
            SET ${setClauses.join(', ')}
            WHERE session_id = $${paramIdx}
            RETURNING *
        `, values);

        if (!updated) {
            return NextResponse.json(
                { success: false, error: 'Session not found' }, { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        console.error('[Scribe:Session:Patch] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// DELETE: Discard a session (soft-delete via status change)
export async function DELETE(
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
        const sessionId = params.id;

        // Delete notes first (FK constraint)
        await query('DELETE FROM scribe_notes WHERE session_id = $1', [sessionId]);

        // Delete session
        const result = await query<any>(
            'DELETE FROM scribe_sessions WHERE session_id = $1 RETURNING session_id',
            [sessionId]
        );

        if (!result.length) {
            return NextResponse.json(
                { success: false, error: 'Session not found' }, { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: { deleted: true, session_id: sessionId },
        });
    } catch (error) {
        console.error('[Scribe:Session:Delete] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

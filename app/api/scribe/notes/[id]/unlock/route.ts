import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/scribe/notes/[id]/unlock
 * Unlock a locked/signed note for editing (admin/provider only)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const user = await requireApiUser(request, 'write');
        const noteId = params.id;

        // Only admin or providers can unlock notes
        if (user.role !== 'admin' && !user.is_provider) {
            return NextResponse.json({
                success: false,
                error: 'Only admins and providers can unlock notes'
            }, { status: 403 });
        }

        // Get current note status
        const [note] = await query<any>(`
            SELECT note_id, healthie_status, session_id
            FROM scribe_notes
            WHERE note_id = $1
        `, [noteId]);

        if (!note) {
            return NextResponse.json({
                success: false,
                error: 'Note not found'
            }, { status: 404 });
        }

        // Update status to draft
        await query(`
            UPDATE scribe_notes
            SET healthie_status = 'draft',
                updated_at = NOW()
            WHERE note_id = $1
        `, [noteId]);

        // Log to audit trail (create table if doesn't exist)
        try {
            await query(`
                CREATE TABLE IF NOT EXISTS audit_log (
                    log_id SERIAL PRIMARY KEY,
                    action TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    user_id UUID REFERENCES users(user_id),
                    user_email TEXT,
                    details JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            await query(`
                INSERT INTO audit_log (action, entity_type, entity_id, user_id, user_email, details)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                'unlock_note',
                'scribe_note',
                noteId,
                user.user_id,
                user.email,
                JSON.stringify({
                    previous_status: note.healthie_status,
                    new_status: 'draft',
                    session_id: note.session_id,
                    timestamp: new Date().toISOString()
                })
            ]);
        } catch (auditError) {
            console.warn('[Scribe:Unlock] Audit log failed:', auditError);
            // Continue even if audit fails
        }

        console.log(`[Scribe:Unlock] Note ${noteId} unlocked by ${user.email} (was: ${note.healthie_status})`);

        return NextResponse.json({
            success: true,
            message: 'Note unlocked for editing',
            previous_status: note.healthie_status,
            new_status: 'draft'
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[Scribe:Unlock] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to unlock note' },
            { status: 500 }
        );
    }
}

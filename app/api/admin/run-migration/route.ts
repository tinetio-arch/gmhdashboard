import { NextRequest, NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Temporary migration endpoint — delete after use
export async function GET(request: NextRequest) {
    const secret = request.nextUrl.searchParams.get('secret');
    if (secret !== 'run-scribe-migration-2026') {
        return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
    }

    try {
        // Check if tables exist
        const check = await query<any>(
            `SELECT table_name FROM information_schema.tables WHERE table_name IN ('scribe_sessions', 'scribe_notes')`
        );
        const existing = check.map((r: any) => r.table_name);

        if (existing.length >= 2) {
            const sessions = await query<any>('SELECT count(*) as cnt FROM scribe_sessions');
            const notes = await query<any>('SELECT count(*) as cnt FROM scribe_notes');
            return NextResponse.json({
                message: 'Tables already exist',
                tables: existing,
                sessions: sessions[0]?.cnt || 0,
                notes: notes[0]?.cnt || 0,
            });
        }

        // Run migration
        const pool = getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scribe_sessions (
                session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                patient_id UUID REFERENCES patients(patient_id),
                appointment_id TEXT,
                visit_type TEXT NOT NULL DEFAULT 'follow_up',
                audio_s3_key TEXT,
                transcript TEXT,
                transcript_source TEXT DEFAULT 'deepgram',
                status TEXT NOT NULL DEFAULT 'recording'
                    CHECK (status IN ('recording','transcribed','note_generated','submitted','signed')),
                created_by UUID REFERENCES users(user_id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS scribe_notes (
                note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id UUID NOT NULL REFERENCES scribe_sessions(session_id),
                patient_id UUID REFERENCES patients(patient_id),
                visit_type TEXT NOT NULL,
                soap_subjective TEXT,
                soap_objective TEXT,
                soap_assessment TEXT,
                soap_plan TEXT,
                icd10_codes JSONB DEFAULT '[]',
                cpt_codes JSONB DEFAULT '[]',
                full_note_text TEXT,
                ai_model TEXT DEFAULT 'claude-3-sonnet',
                ai_prompt_version TEXT DEFAULT 'v1',
                healthie_note_id TEXT,
                healthie_status TEXT DEFAULT 'draft'
                    CHECK (healthie_status IN ('draft','submitted','locked','signed','error')),
                reviewed_by UUID REFERENCES users(user_id),
                reviewed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_scribe_sessions_patient ON scribe_sessions(patient_id);
            CREATE INDEX IF NOT EXISTS idx_scribe_sessions_status ON scribe_sessions(status);
            CREATE INDEX IF NOT EXISTS idx_scribe_notes_session ON scribe_notes(session_id);
            CREATE INDEX IF NOT EXISTS idx_scribe_notes_patient ON scribe_notes(patient_id);
            CREATE INDEX IF NOT EXISTS idx_scribe_notes_healthie_status ON scribe_notes(healthie_status);
        `);

        // Verify
        const verify = await query<any>(
            `SELECT table_name FROM information_schema.tables WHERE table_name IN ('scribe_sessions', 'scribe_notes')`
        );

        return NextResponse.json({
            message: 'Migration complete',
            tables: verify.map((r: any) => r.table_name),
        });
    } catch (error) {
        console.error('[Migration] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Migration failed' },
            { status: 500 }
        );
    }
}

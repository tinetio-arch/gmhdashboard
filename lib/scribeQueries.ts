/**
 * Scribe Query Module
 *
 * Full CRUD for scribe_sessions and scribe_notes.
 * Uses the dynamic update pattern from peptideQueries.ts.
 */

import { query } from './db';

// ■■■ Types ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

export interface ScribeSession {
    session_id: string;
    patient_id: string;
    appointment_id: string | null;
    visit_type: string;
    audio_s3_key: string | null;
    transcript: string | null;
    transcript_source: string;
    status: 'recording' | 'transcribed' | 'note_generated' | 'submitted' | 'signed';
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface ScribeNote {
    note_id: string;
    session_id: string;
    patient_id: string;
    visit_type: string;
    soap_subjective: string | null;
    soap_objective: string | null;
    soap_assessment: string | null;
    soap_plan: string | null;
    icd10_codes: any[];
    cpt_codes: any[];
    full_note_text: string | null;
    ai_model: string;
    ai_prompt_version: string;
    healthie_note_id: string | null;
    healthie_status: 'draft' | 'submitted' | 'locked' | 'signed' | 'error';
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
}

// ■■■ Scribe Sessions ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

export async function createScribeSession(data: {
    patient_id: string;
    appointment_id?: string;
    visit_type?: string;
    audio_s3_key?: string;
    transcript?: string;
    transcript_source?: string;
    created_by: string;
}): Promise<ScribeSession> {
    const [session] = await query<ScribeSession>(`
    INSERT INTO scribe_sessions
      (patient_id, appointment_id, visit_type, audio_s3_key,
       transcript, transcript_source, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
        data.patient_id,
        data.appointment_id || null,
        data.visit_type || 'follow_up',
        data.audio_s3_key || null,
        data.transcript || null,
        data.transcript_source || 'deepgram',
        data.transcript ? 'transcribed' : 'recording',
        data.created_by,
    ]);
    return session;
}

export async function getScribeSession(sessionId: string): Promise<ScribeSession | null> {
    const [session] = await query<ScribeSession>(
        'SELECT * FROM scribe_sessions WHERE session_id = $1',
        [sessionId]
    );
    return session || null;
}

export async function listScribeSessions(options?: {
    patient_id?: string;
    status?: string;
    limit?: number;
}): Promise<ScribeSession[]> {
    const clauses: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (options?.patient_id) {
        clauses.push(`patient_id = $${idx++}`);
        vals.push(options.patient_id);
    }
    if (options?.status) {
        clauses.push(`status = $${idx++}`);
        vals.push(options.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    vals.push(limit);

    return query<ScribeSession>(`
    SELECT * FROM scribe_sessions
    ${where}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `, vals);
}

export async function updateScribeSession(
    sessionId: string,
    updates: Partial<Omit<ScribeSession, 'session_id' | 'created_at' | 'created_by'>>
): Promise<ScribeSession> {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (updates.patient_id !== undefined) { sets.push(`patient_id = $${idx++}`); vals.push(updates.patient_id); }
    if (updates.appointment_id !== undefined) { sets.push(`appointment_id = $${idx++}`); vals.push(updates.appointment_id); }
    if (updates.visit_type !== undefined) { sets.push(`visit_type = $${idx++}`); vals.push(updates.visit_type); }
    if (updates.audio_s3_key !== undefined) { sets.push(`audio_s3_key = $${idx++}`); vals.push(updates.audio_s3_key); }
    if (updates.transcript !== undefined) { sets.push(`transcript = $${idx++}`); vals.push(updates.transcript); }
    if (updates.transcript_source !== undefined) { sets.push(`transcript_source = $${idx++}`); vals.push(updates.transcript_source); }
    if (updates.status !== undefined) { sets.push(`status = $${idx++}`); vals.push(updates.status); }

    if (sets.length === 0) {
        const existing = await getScribeSession(sessionId);
        if (!existing) throw new Error('Session not found');
        return existing;
    }

    sets.push(`updated_at = NOW()`);
    vals.push(sessionId);

    const [session] = await query<ScribeSession>(
        `UPDATE scribe_sessions SET ${sets.join(', ')} WHERE session_id = $${idx} RETURNING *`,
        vals
    );

    if (!session) throw new Error('Session not found');
    return session;
}

export async function deleteScribeSession(sessionId: string): Promise<{ deleted: boolean }> {
    // Delete associated notes first
    await query('DELETE FROM scribe_notes WHERE session_id = $1', [sessionId]);

    const result = await query<{ session_id: string }>(
        'DELETE FROM scribe_sessions WHERE session_id = $1 RETURNING session_id',
        [sessionId]
    );

    return { deleted: result.length > 0 };
}

// ■■■ Scribe Notes ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

export async function createScribeNote(data: {
    session_id: string;
    patient_id: string;
    visit_type: string;
    soap_subjective?: string;
    soap_objective?: string;
    soap_assessment?: string;
    soap_plan?: string;
    icd10_codes?: any[];
    cpt_codes?: any[];
    full_note_text?: string;
    ai_model?: string;
    ai_prompt_version?: string;
}): Promise<ScribeNote> {
    const [note] = await query<ScribeNote>(`
    INSERT INTO scribe_notes
      (session_id, patient_id, visit_type,
       soap_subjective, soap_objective, soap_assessment, soap_plan,
       icd10_codes, cpt_codes, full_note_text,
       ai_model, ai_prompt_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
        data.session_id,
        data.patient_id,
        data.visit_type,
        data.soap_subjective || null,
        data.soap_objective || null,
        data.soap_assessment || null,
        data.soap_plan || null,
        JSON.stringify(data.icd10_codes || []),
        JSON.stringify(data.cpt_codes || []),
        data.full_note_text || null,
        data.ai_model || 'claude-3-sonnet',
        data.ai_prompt_version || 'v1',
    ]);
    return note;
}

export async function getScribeNote(noteId: string): Promise<ScribeNote | null> {
    const [note] = await query<ScribeNote>(
        'SELECT * FROM scribe_notes WHERE note_id = $1',
        [noteId]
    );
    return note || null;
}

export async function getScribeNoteBySession(sessionId: string): Promise<ScribeNote | null> {
    const [note] = await query<ScribeNote>(
        'SELECT * FROM scribe_notes WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
        [sessionId]
    );
    return note || null;
}

export async function listScribeNotes(options?: {
    patient_id?: string;
    session_id?: string;
    healthie_status?: string;
    limit?: number;
}): Promise<ScribeNote[]> {
    const clauses: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (options?.patient_id) {
        clauses.push(`patient_id = $${idx++}`);
        vals.push(options.patient_id);
    }
    if (options?.session_id) {
        clauses.push(`session_id = $${idx++}`);
        vals.push(options.session_id);
    }
    if (options?.healthie_status) {
        clauses.push(`healthie_status = $${idx++}`);
        vals.push(options.healthie_status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    vals.push(limit);

    return query<ScribeNote>(`
    SELECT * FROM scribe_notes
    ${where}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `, vals);
}

export async function updateScribeNote(
    noteId: string,
    updates: Partial<Omit<ScribeNote, 'note_id' | 'session_id' | 'created_at'>>
): Promise<ScribeNote> {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (updates.patient_id !== undefined) { sets.push(`patient_id = $${idx++}`); vals.push(updates.patient_id); }
    if (updates.visit_type !== undefined) { sets.push(`visit_type = $${idx++}`); vals.push(updates.visit_type); }
    if (updates.soap_subjective !== undefined) { sets.push(`soap_subjective = $${idx++}`); vals.push(updates.soap_subjective); }
    if (updates.soap_objective !== undefined) { sets.push(`soap_objective = $${idx++}`); vals.push(updates.soap_objective); }
    if (updates.soap_assessment !== undefined) { sets.push(`soap_assessment = $${idx++}`); vals.push(updates.soap_assessment); }
    if (updates.soap_plan !== undefined) { sets.push(`soap_plan = $${idx++}`); vals.push(updates.soap_plan); }
    if (updates.icd10_codes !== undefined) { sets.push(`icd10_codes = $${idx++}`); vals.push(JSON.stringify(updates.icd10_codes)); }
    if (updates.cpt_codes !== undefined) { sets.push(`cpt_codes = $${idx++}`); vals.push(JSON.stringify(updates.cpt_codes)); }
    if (updates.full_note_text !== undefined) { sets.push(`full_note_text = $${idx++}`); vals.push(updates.full_note_text); }
    if (updates.ai_model !== undefined) { sets.push(`ai_model = $${idx++}`); vals.push(updates.ai_model); }
    if (updates.ai_prompt_version !== undefined) { sets.push(`ai_prompt_version = $${idx++}`); vals.push(updates.ai_prompt_version); }
    if (updates.healthie_note_id !== undefined) { sets.push(`healthie_note_id = $${idx++}`); vals.push(updates.healthie_note_id); }
    if (updates.healthie_status !== undefined) { sets.push(`healthie_status = $${idx++}`); vals.push(updates.healthie_status); }
    if (updates.reviewed_by !== undefined) { sets.push(`reviewed_by = $${idx++}`); vals.push(updates.reviewed_by); }
    if (updates.reviewed_at !== undefined) { sets.push(`reviewed_at = $${idx++}`); vals.push(updates.reviewed_at); }

    if (sets.length === 0) {
        const existing = await getScribeNote(noteId);
        if (!existing) throw new Error('Note not found');
        return existing;
    }

    sets.push(`updated_at = NOW()`);
    vals.push(noteId);

    const [note] = await query<ScribeNote>(
        `UPDATE scribe_notes SET ${sets.join(', ')} WHERE note_id = $${idx} RETURNING *`,
        vals
    );

    if (!note) throw new Error('Note not found');
    return note;
}

export async function deleteScribeNote(noteId: string): Promise<{ deleted: boolean }> {
    const result = await query<{ note_id: string }>(
        'DELETE FROM scribe_notes WHERE note_id = $1 RETURNING note_id',
        [noteId]
    );
    return { deleted: result.length > 0 };
}

// ■■■ Convenience Queries ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

/**
 * Fetch a full session with its latest note
 */
export async function getSessionWithNote(sessionId: string): Promise<{
    session: ScribeSession;
    note: ScribeNote | null;
} | null> {
    const session = await getScribeSession(sessionId);
    if (!session) return null;

    const note = await getScribeNoteBySession(sessionId);
    return { session, note };
}

/**
 * Fetch recent sessions for a patient with note status
 */
export async function getPatientScribeHistory(
    patientId: string,
    limit = 20
): Promise<Array<ScribeSession & { note_id: string | null; healthie_status: string | null }>> {
    return query<ScribeSession & { note_id: string | null; healthie_status: string | null }>(`
    SELECT
      s.*,
      n.note_id,
      n.healthie_status
    FROM scribe_sessions s
    LEFT JOIN scribe_notes n ON n.session_id = s.session_id
    WHERE s.patient_id = $1
    ORDER BY s.created_at DESC
    LIMIT $2
  `, [patientId, limit]);
}

/**
 * Summary stats for scribe dashboard
 */
export async function getScribeSummary(): Promise<{
    total_sessions: number;
    recording: number;
    transcribed: number;
    note_generated: number;
    submitted: number;
    signed: number;
    notes_draft: number;
    notes_submitted: number;
    notes_error: number;
}> {
    const [stats] = await query<{
        total_sessions: string;
        recording: string;
        transcribed: string;
        note_generated: string;
        submitted: string;
        signed: string;
        notes_draft: string;
        notes_submitted: string;
        notes_error: string;
    }>(`
    SELECT
      (SELECT COUNT(*) FROM scribe_sessions)::text as total_sessions,
      (SELECT COUNT(*) FROM scribe_sessions WHERE status = 'recording')::text as recording,
      (SELECT COUNT(*) FROM scribe_sessions WHERE status = 'transcribed')::text as transcribed,
      (SELECT COUNT(*) FROM scribe_sessions WHERE status = 'note_generated')::text as note_generated,
      (SELECT COUNT(*) FROM scribe_sessions WHERE status = 'submitted')::text as submitted,
      (SELECT COUNT(*) FROM scribe_sessions WHERE status = 'signed')::text as signed,
      (SELECT COUNT(*) FROM scribe_notes WHERE healthie_status = 'draft')::text as notes_draft,
      (SELECT COUNT(*) FROM scribe_notes WHERE healthie_status IN ('submitted','locked','signed'))::text as notes_submitted,
      (SELECT COUNT(*) FROM scribe_notes WHERE healthie_status = 'error')::text as notes_error
  `);

    return {
        total_sessions: parseInt(stats?.total_sessions || '0'),
        recording: parseInt(stats?.recording || '0'),
        transcribed: parseInt(stats?.transcribed || '0'),
        note_generated: parseInt(stats?.note_generated || '0'),
        submitted: parseInt(stats?.submitted || '0'),
        signed: parseInt(stats?.signed || '0'),
        notes_draft: parseInt(stats?.notes_draft || '0'),
        notes_submitted: parseInt(stats?.notes_submitted || '0'),
        notes_error: parseInt(stats?.notes_error || '0'),
    };
}

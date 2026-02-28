import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

// POST: Reassign patient to a scribe session
// Matches Telegram bot's "Change Patient" (select_patient callback)
export async function POST(
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
        const { healthie_patient_id } = await request.json();

        if (!healthie_patient_id) {
            return NextResponse.json(
                { success: false, error: 'healthie_patient_id is required' },
                { status: 400 }
            );
        }

        // 1. Verify session exists
        const [session] = await query<any>(
            'SELECT * FROM scribe_sessions WHERE session_id = $1',
            [sessionId]
        );
        if (!session) {
            return NextResponse.json(
                { success: false, error: 'Session not found' }, { status: 404 }
            );
        }

        // 2. Fetch patient details from Healthie
        let patientName = 'Unknown';
        try {
            const result = await healthieGraphQL<any>(
                `query { user(id: "${healthie_patient_id}") { id first_name last_name dob } }`
            );
            const user = result?.user;
            if (user) {
                patientName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            }
        } catch (err) {
            console.warn('[Scribe:ChangePatient] Healthie lookup failed, continuing with ID only:', err);
        }

        // 3. Try to find local patient record
        let localPatientId = session.patient_id;
        const [localPatient] = await query<any>(
            'SELECT patient_id, full_name FROM patients WHERE healthie_client_id = $1',
            [healthie_patient_id]
        );
        if (localPatient) {
            localPatientId = localPatient.patient_id;
            patientName = localPatient.full_name || patientName;
        }

        // 4. Get old patient name for SOAP content replacement
        const [oldPatient] = await query<any>(
            'SELECT full_name FROM patients WHERE patient_id = $1',
            [session.patient_id]
        );
        const oldPatientName = oldPatient?.full_name;

        // 5. Update session patient_id
        await query(
            `UPDATE scribe_sessions SET patient_id = $1, updated_at = NOW() WHERE session_id = $2`,
            [localPatientId, sessionId]
        );

        // 6. Update note patient_id and replace patient name in SOAP content
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE session_id = $1',
            [sessionId]
        );

        if (note) {
            const updates: string[] = ['patient_id = $1', 'updated_at = NOW()'];
            const vals: any[] = [localPatientId];
            let idx = 2;

            // Replace old patient name in SOAP sections if names differ
            if (oldPatientName && oldPatientName !== patientName) {
                const replaceInSoap = (text: string | null) =>
                    text ? text.replace(new RegExp(oldPatientName, 'gi'), patientName) : text;

                const updatedSubjective = replaceInSoap(note.soap_subjective);
                const updatedObjective = replaceInSoap(note.soap_objective);
                const updatedAssessment = replaceInSoap(note.soap_assessment);
                const updatedPlan = replaceInSoap(note.soap_plan);
                const updatedFull = replaceInSoap(note.full_note_text);

                updates.push(`soap_subjective = $${idx++}`); vals.push(updatedSubjective);
                updates.push(`soap_objective = $${idx++}`); vals.push(updatedObjective);
                updates.push(`soap_assessment = $${idx++}`); vals.push(updatedAssessment);
                updates.push(`soap_plan = $${idx++}`); vals.push(updatedPlan);
                updates.push(`full_note_text = $${idx++}`); vals.push(updatedFull);
            }

            vals.push(note.note_id);
            await query(
                `UPDATE scribe_notes SET ${updates.join(', ')} WHERE note_id = $${idx}`,
                vals
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                session_id: sessionId,
                new_patient_id: localPatientId,
                new_patient_name: patientName,
                healthie_patient_id: healthie_patient_id,
                old_patient_name: oldPatientName || null,
                soap_updated: !!(oldPatientName && oldPatientName !== patientName && note),
            },
        });
    } catch (error) {
        console.error('[Scribe:ChangePatient] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

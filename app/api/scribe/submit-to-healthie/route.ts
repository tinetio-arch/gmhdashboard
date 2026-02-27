import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { createHealthieClient } from '@/lib/healthie';
import { sendMessage } from '@/lib/telegram-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { note_id, appointment_id } = await request.json();

    if (!note_id) {
        return NextResponse.json({ success: false, error: 'note_id is required' }, { status: 400 });
    }

    try {
        // 1. Fetch note
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [note_id]
        );
        if (!note) {
            return NextResponse.json(
                { success: false, error: 'Note not found' }, { status: 404 }
            );
        }

        if (note.healthie_status === 'submitted' || note.healthie_status === 'locked') {
            return NextResponse.json({
                success: false,
                error: `Note already ${note.healthie_status} (Healthie ID: ${note.healthie_note_id})`,
            }, { status: 400 });
        }

        // Fetch patient's Healthie ID
        const [patient] = await query<any>(
            'SELECT patient_id, full_name, healthie_client_id FROM patients WHERE patient_id = $1',
            [note.patient_id]
        );
        if (!patient?.healthie_client_id) {
            return NextResponse.json(
                { success: false, error: 'Patient has no Healthie client ID' }, { status: 400 }
            );
        }

        const healthie = createHealthieClient();

        // 2. Create chart note in Healthie
        const chartNote = await healthie.createChartNote({
            client_id: patient.healthie_client_id,
            title: `${note.visit_type} Visit Note — ${new Date().toLocaleDateString()}`,
            body: formatHealthieNoteBody(note),
            status: 'draft',
        });

        const healthieNoteId = chartNote.id;

        // 3. Link note to appointment if provided
        if (appointment_id) {
            try {
                await healthie.graphql(`
          mutation UpdateAppointment($id: ID!, $input: updateAppointmentInput!) {
            updateAppointment(id: $id, input: $input) {
              appointment { id }
            }
          }
        `, {
                    id: appointment_id,
                    input: { form_answer_group_id: healthieNoteId },
                });
            } catch (linkErr) {
                console.warn('[Scribe:Submit] Appointment linking failed:', linkErr instanceof Error ? linkErr.message : linkErr);
                // Non-fatal — continue even if linking fails
            }
        }

        // 4. Lock the chart note
        let locked = false;
        try {
            await healthie.graphql(`
        mutation LockFormAnswerGroup($id: ID!) {
          lockFormAnswerGroup(id: $id) {
            form_answer_group { id locked }
          }
        }
      `, { id: healthieNoteId });
            locked = true;
        } catch (lockErr) {
            console.warn('[Scribe:Submit] Note locking failed:', lockErr instanceof Error ? lockErr.message : lockErr);
            // Non-fatal
        }

        // 5. Update local records
        await query(`
      UPDATE scribe_notes
      SET healthie_note_id = $1,
          healthie_status = $2,
          reviewed_by = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE note_id = $4
    `, [
            healthieNoteId,
            locked ? 'locked' : 'submitted',
            user.user_id,
            note_id,
        ]);

        // Update session status
        const [session] = await query<any>(
            'SELECT session_id FROM scribe_sessions WHERE session_id = $1',
            [note.session_id]
        );
        if (session) {
            await query(
                `UPDATE scribe_sessions SET status = 'submitted', updated_at = NOW() WHERE session_id = $1`,
                [note.session_id]
            );
        }

        // 6. Send Telegram confirmation
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (chatId) {
            try {
                const msg = [
                    `📋 *AI Scribe Note Submitted*`,
                    ``,
                    `👤 Patient: ${patient.full_name}`,
                    `📝 Visit: ${note.visit_type}`,
                    `🏥 Healthie Note: ${healthieNoteId}`,
                    locked ? `🔒 Status: Locked` : `📤 Status: Submitted (not locked)`,
                    appointment_id ? `📅 Appointment: ${appointment_id}` : '',
                    ``,
                    `_Submitted by ${user.display_name || user.email}_`,
                ].filter(Boolean).join('\n');

                await sendMessage(chatId, msg, { parseMode: 'Markdown' });
            } catch (tgErr) {
                console.warn('[Scribe:Submit] Telegram notification failed:', tgErr);
                // Non-fatal
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                note_id,
                healthie_note_id: healthieNoteId,
                healthie_status: locked ? 'locked' : 'submitted',
                appointment_linked: !!appointment_id,
            },
        });
    } catch (error) {
        // Mark note as error state
        try {
            await query(
                `UPDATE scribe_notes SET healthie_status = 'error', updated_at = NOW() WHERE note_id = $1`,
                [note_id]
            );
        } catch (updateErr) {
            console.error('[Scribe:Submit] Failed to update error status:', updateErr);
        }

        console.error('[Scribe:Submit] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// ==================== HELPERS ====================
function formatHealthieNoteBody(note: any): string {
    const sections: string[] = [];

    if (note.soap_subjective) {
        sections.push(`## Subjective\n${note.soap_subjective}`);
    }
    if (note.soap_objective) {
        sections.push(`## Objective\n${note.soap_objective}`);
    }
    if (note.soap_assessment) {
        sections.push(`## Assessment\n${note.soap_assessment}`);
    }
    if (note.soap_plan) {
        sections.push(`## Plan\n${note.soap_plan}`);
    }

    // ICD-10 codes
    const icd10 = note.icd10_codes || [];
    if (Array.isArray(icd10) && icd10.length > 0) {
        sections.push(
            `## ICD-10 Codes\n${icd10.map((c: any) => `- [${c.code}] ${c.description}`).join('\n')}`
        );
    }

    // CPT codes
    const cpt = note.cpt_codes || [];
    if (Array.isArray(cpt) && cpt.length > 0) {
        sections.push(
            `## CPT Codes\n${cpt.map((c: any) => `- ${c.code}: ${c.description}`).join('\n')}`
        );
    }

    sections.push(`\n---\n_Generated by AI Scribe (${note.ai_model || 'claude'}) — ${new Date().toLocaleDateString()}_`);

    return sections.join('\n\n');
}

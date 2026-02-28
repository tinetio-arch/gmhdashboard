import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { sendMessage } from '@/lib/telegram-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ==================== CONSTANTS (match Telegram bot) ====================
const SOAP_FORM_ID = '2898601';
const FIELD_IDS = {
    subjective: '37256657',
    objective: '37256658',
    assessment: '37256659',
    plan: '37256660',
};

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

        // Duplicate submission protection (30-second window)
        if (note.healthie_status === 'submitted' || note.healthie_status === 'locked') {
            const submittedAt = note.reviewed_at ? new Date(note.reviewed_at).getTime() : 0;
            const elapsed = Date.now() - submittedAt;
            if (elapsed < 30000) {
                return NextResponse.json({
                    success: false,
                    error: `Note already ${note.healthie_status} ${Math.round(elapsed / 1000)}s ago (Healthie ID: ${note.healthie_note_id})`,
                }, { status: 409 });
            }
            // Allow re-submission if > 30s (user intentionally retrying)
        }

        // 2. Fetch patient's Healthie ID
        const [patient] = await query<any>(
            'SELECT patient_id, full_name, healthie_client_id FROM patients WHERE patient_id = $1',
            [note.patient_id]
        );
        if (!patient?.healthie_client_id) {
            return NextResponse.json(
                { success: false, error: 'Patient has no Healthie client ID. Link patient to Healthie first.' },
                { status: 400 }
            );
        }

        // 3. Format SOAP sections as HTML (matching Telegram bot formatSectionHtml)
        const formatSectionHtml = (text: string): string => {
            if (!text || !text.trim()) return ' ';
            let html = text;
            // Bullet points
            html = html.replace(/^\s*[-*]\s+/gm, '<br/>&nbsp;&nbsp;• ');
            // Bold headers with colons
            html = html.replace(/\*\*(.*?)\*\*:/g, '<br/><span style="font-size:15px; font-weight:bold; color:#34495e;">$1:</span>');
            // Label: value patterns
            html = html.replace(/^\s*([A-Za-z][A-Za-z\s/]+):/gm, '<br/><strong>$1:</strong>');
            // Newlines to breaks
            html = html.replace(/\n/g, '<br/>');
            // Clean up triple breaks
            html = html.replace(/<br\/><br\/><br\/>/g, '<br/><br/>');
            return html;
        };

        const formAnswers = [
            { custom_module_id: FIELD_IDS.subjective, answer: formatSectionHtml(note.soap_subjective || ''), user_id: patient.healthie_client_id },
            { custom_module_id: FIELD_IDS.objective, answer: formatSectionHtml(note.soap_objective || ''), user_id: patient.healthie_client_id },
            { custom_module_id: FIELD_IDS.assessment, answer: formatSectionHtml(note.soap_assessment || ''), user_id: patient.healthie_client_id },
            { custom_module_id: FIELD_IDS.plan, answer: formatSectionHtml(note.soap_plan || ''), user_id: patient.healthie_client_id },
        ];

        // 4. Create or Update FormAnswerGroup in Healthie (matching Telegram bot)
        let healthieNoteId: string | null = null;
        const isResubmit = !!note.healthie_note_id;

        if (isResubmit) {
            // Update existing form answer group
            const updateResult = await healthieGraphQL<any>(`
                mutation UpdateFormAnswerGroup($input: updateFormAnswerGroupInput!) {
                    updateFormAnswerGroup(input: $input) {
                        form_answer_group { id }
                        messages { field message }
                    }
                }
            `, {
                input: {
                    id: note.healthie_note_id,
                    finished: true,
                    form_answers: formAnswers,
                },
            });

            healthieNoteId = updateResult?.updateFormAnswerGroup?.form_answer_group?.id;

            // Fallback: if update fails (e.g. deleted in Healthie), create new
            if (!healthieNoteId) {
                console.warn('[Scribe:Submit] Update failed, falling back to create new');
                const createResult = await healthieGraphQL<any>(`
                    mutation CreateFormAnswerGroup($input: createFormAnswerGroupInput!) {
                        createFormAnswerGroup(input: $input) {
                            form_answer_group { id }
                        }
                    }
                `, {
                    input: {
                        custom_module_form_id: SOAP_FORM_ID,
                        user_id: patient.healthie_client_id,
                        finished: true,
                        form_answers: formAnswers,
                    },
                });
                healthieNoteId = createResult?.createFormAnswerGroup?.form_answer_group?.id;
            }
        } else {
            // Create new form answer group
            const createResult = await healthieGraphQL<any>(`
                mutation CreateFormAnswerGroup($input: createFormAnswerGroupInput!) {
                    createFormAnswerGroup(input: $input) {
                        form_answer_group { id }
                    }
                }
            `, {
                input: {
                    custom_module_form_id: SOAP_FORM_ID,
                    user_id: patient.healthie_client_id,
                    finished: true,
                    form_answers: formAnswers,
                },
            });
            healthieNoteId = createResult?.createFormAnswerGroup?.form_answer_group?.id;
        }

        if (!healthieNoteId) {
            throw new Error('Failed to create/update SOAP form in Healthie — no ID returned');
        }

        // 5. Lock the form answer group
        let locked = false;
        try {
            await healthieGraphQL(`
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

        // 6. Update local records
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
        await query(
            `UPDATE scribe_sessions SET status = 'submitted', updated_at = NOW() WHERE session_id = $1`,
            [note.session_id]
        );

        // 7. Send Telegram confirmation (non-fatal)
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (chatId) {
            try {
                const verb = isResubmit ? 'Updated' : 'Submitted';
                const msg = [
                    `📋 *AI Scribe Note ${verb} (iPad)*`,
                    ``,
                    `👤 Patient: ${patient.full_name}`,
                    `📝 Visit: ${note.visit_type}`,
                    `🏥 Healthie SOAP Form: ${healthieNoteId}`,
                    locked ? `🔒 Status: Locked` : `📤 Status: Submitted (not locked)`,
                    ``,
                    `_${verb} by ${user.display_name || user.email} via iPad_`,
                ].filter(Boolean).join('\n');

                await sendMessage(chatId, msg, { parseMode: 'Markdown' });
            } catch (tgErr) {
                console.warn('[Scribe:Submit] Telegram notification failed:', tgErr);
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                note_id,
                healthie_note_id: healthieNoteId,
                healthie_status: locked ? 'locked' : 'submitted',
                is_resubmit: isResubmit,
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

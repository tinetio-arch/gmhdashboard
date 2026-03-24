import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { sendMessage } from '@/lib/telegram-client';
import { generateSoapPdf } from '@/lib/pdf/soapPdfGenerator';
import { generateDocPdf } from '@/lib/pdf/docPdfGenerator';

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
        if (note.healthie_status === 'submitted' || note.healthie_status === 'locked' || note.healthie_status === 'signed') {
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

        // 2. Fetch patient + Healthie ID
        // First try local patients table with healthie_clients mapping
        let patient: any = null;
        let healthiePatientId: string | null = null;

        // Check if patient_id is a UUID (local patient) or a Healthie numeric ID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.patient_id);
        
        if (isUuid) {
            const [localPatient] = await query<any>(
                'SELECT p.patient_id, p.full_name, p.dob, p.clinic, hc.healthie_client_id FROM patients p LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id AND hc.is_active = true WHERE p.patient_id = $1',
                [note.patient_id]
            );
            if (localPatient) {
                patient = localPatient;
                healthiePatientId = localPatient.healthie_client_id;
            }
        }

        // Try lookup by healthie_client_id if not found by UUID
        if (!patient) {
            const [byHealthie] = await query<any>(
                'SELECT p.patient_id, p.full_name, p.dob, p.clinic, hc.healthie_client_id FROM patients p JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id AND hc.is_active = true WHERE hc.healthie_client_id = $1',
                [note.patient_id]
            );
            if (byHealthie) {
                patient = byHealthie;
                healthiePatientId = byHealthie.healthie_client_id;
            }
        }

        // FALLBACK: If patient not in local DB, use note.patient_id as Healthie ID directly
        // This supports the 4000+ Healthie patients not synced to local patients table
        if (!healthiePatientId) {
            healthiePatientId = note.patient_id;
            console.log(`[Scribe:Submit] Patient not in local DB, using patient_id as Healthie ID: ${healthiePatientId}`);
            
            // Fetch patient name from Healthie API for PDF generation
            try {
                const healthieUser = await healthieGraphQL<any>(`
                    query GetUser($id: ID!) {
                        user(id: $id) { id first_name last_name dob }
                    }
                `, { id: healthiePatientId });
                if (healthieUser?.user) {
                    patient = {
                        full_name: `${healthieUser.user.first_name || ''} ${healthieUser.user.last_name || ''}`.trim(),
                        dob: healthieUser.user.dob,
                    };
                }
            } catch (healthieErr) {
                console.warn('[Scribe:Submit] Failed to fetch patient from Healthie:', healthieErr);
                patient = { full_name: 'Unknown Patient', dob: null };
            }
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
            { custom_module_id: FIELD_IDS.subjective, answer: formatSectionHtml(note.soap_subjective || ''), user_id: healthiePatientId },
            { custom_module_id: FIELD_IDS.objective, answer: formatSectionHtml(note.soap_objective || ''), user_id: healthiePatientId },
            { custom_module_id: FIELD_IDS.assessment, answer: formatSectionHtml(note.soap_assessment || ''), user_id: healthiePatientId },
            { custom_module_id: FIELD_IDS.plan, answer: formatSectionHtml(note.soap_plan || ''), user_id: healthiePatientId },
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
                        user_id: healthiePatientId,
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
                    user_id: healthiePatientId,
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
        let signed = false;
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

        // 5.1. Sign the form answer group (provider signature)
        if (locked) {
            try {
                await healthieGraphQL(`
                    mutation SignFormAnswerGroup($input: signFormAnswerGroupInput!) {
                        signFormAnswerGroup(input: $input) {
                            form_answer_group {
                                id
                                locked
                                form_answer_group_signings {
                                    id
                                    signed_at
                                }
                            }
                        }
                    }
                `, {
                    input: {
                        id: healthieNoteId,
                    },
                });
                signed = true;
                console.log(`[Scribe:Submit] Chart signed in Healthie: ${healthieNoteId}`);
            } catch (signErr) {
                console.warn('[Scribe:Submit] Chart signing failed:', signErr instanceof Error ? signErr.message : signErr);
                // Non-fatal — chart is still locked even if signing fails
            }
        }

        // 5.5. Generate PDF and upload to Healthie as a document
        let pdfDocumentId: string | null = null;
        try {
            // Use encounter_date from session if available, fallback to note.created_at
            const [session] = await query<any>(
                'SELECT encounter_date FROM scribe_sessions WHERE session_id = $1',
                [note.session_id]
            );
            const encounterDateRaw = session?.encounter_date;
            // encounter_date is a DATE column returned as 'YYYY-MM-DD' string
            const visitDateObj = encounterDateRaw
                ? new Date(encounterDateRaw + 'T12:00:00') // noon to avoid timezone shift
                : new Date(note.created_at || Date.now());
            const visitDate = visitDateObj.toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            const pdfBuffer = await generateSoapPdf({
                patientName: patient.full_name || 'Unknown',
                patientDob: patient.dob ? new Date(patient.dob).toLocaleDateString() : null,
                visitDate,
                visitType: note.visit_type || 'follow_up',
                provider: 'Phil Schafer, NP',
                subjective: note.soap_subjective || '',
                objective: note.soap_objective || '',
                assessment: note.soap_assessment || '',
                plan: note.soap_plan || '',
                icd10Codes: note.icd10_codes ? (typeof note.icd10_codes === 'string' ? JSON.parse(note.icd10_codes) : note.icd10_codes) : [],
                cptCodes: note.cpt_codes ? (typeof note.cpt_codes === 'string' ? JSON.parse(note.cpt_codes) : note.cpt_codes) : [],
                patientClinic: patient.clinic || null,
            });

            const base64Content = pdfBuffer.toString('base64');
            const dataUrl = `data:application/pdf;base64,${base64Content}`;
            const pdfFilename = `SOAP_${(patient.full_name || 'patient').replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf`;

            const docResult = await healthieGraphQL(`
                mutation CreateDocument($input: createDocumentInput!) {
                    createDocument(input: $input) {
                        document { id display_name }
                        messages { field message }
                    }
                }
            `, {
                input: {
                    rel_user_id: String(healthiePatientId),
                    display_name: pdfFilename,
                    file_string: dataUrl,
                    include_in_charting: true,
                    description: `SOAP Note - ${note.visit_type || 'Visit'} - ${visitDate}`,
                }
            });

            pdfDocumentId = docResult?.createDocument?.document?.id || null;
            if (pdfDocumentId) {
                console.log(`[Scribe:Submit] PDF uploaded to Healthie: ${pdfDocumentId}`);
            }
        } catch (pdfErr) {
            console.warn('[Scribe:Submit] PDF upload to Healthie failed (non-fatal):', pdfErr instanceof Error ? pdfErr.message : pdfErr);
        }

        // 5.6. Upload supplementary docs (work notes, discharge instructions, etc.) to Healthie
        const docLabels: Record<string, string> = {
            work_note: 'Work Excuse Note',
            school_note: 'School Excuse Note',
            discharge_instructions: 'Discharge Instructions',
            care_plan: 'Care Plan',
        };
        let docsUploaded = 0;
        try {
            const suppDocs = note.supplementary_docs || {};
            for (const [docType, docEntry] of Object.entries(suppDocs) as [string, any][]) {
                if (!docEntry?.content || !docEntry?.selected) continue;

                try {
                    const docPdfBuffer = await generateDocPdf({
                        patientName: patient.full_name || 'Unknown',
                        patientDob: patient.dob ? new Date(patient.dob).toLocaleDateString() : null,
                        visitDate,
                        provider: 'Phil Schafer, NP',
                        docType: docType as any,
                        content: docEntry.content,
                        patientClinic: patient.clinic || null,
                    });

                    const docBase64 = docPdfBuffer.toString('base64');
                    const docDataUrl = `data:application/pdf;base64,${docBase64}`;
                    const docLabel = docLabels[docType] || docType;
                    const docFilename = `${docLabel.replace(/\s+/g, '_')}_${(patient.full_name || 'patient').replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf`;

                    const docResult = await healthieGraphQL(`
                        mutation CreateDocument($input: createDocumentInput!) {
                            createDocument(input: $input) {
                                document { id display_name }
                                messages { field message }
                            }
                        }
                    `, {
                        input: {
                            rel_user_id: String(healthiePatientId),
                            display_name: docFilename,
                            file_string: docDataUrl,
                            include_in_charting: true,
                            share_with_rel: true,
                            description: `${docLabel} - ${visitDate}`,
                        }
                    });

                    const docId = docResult?.createDocument?.document?.id;
                    if (docId) {
                        docsUploaded++;
                        console.log(`[Scribe:Submit] ${docLabel} PDF uploaded to Healthie: ${docId} (shared with patient)`);
                    }
                } catch (docUploadErr) {
                    console.warn(`[Scribe:Submit] ${docType} upload failed (non-fatal):`, docUploadErr instanceof Error ? docUploadErr.message : docUploadErr);
                }
            }
            if (docsUploaded > 0) {
                console.log(`[Scribe:Submit] Uploaded ${docsUploaded} supplementary doc(s) to Healthie`);
            }
        } catch (suppErr) {
            console.warn('[Scribe:Submit] Supplementary doc upload failed (non-fatal):', suppErr instanceof Error ? suppErr.message : suppErr);
        }

        // 5.7. Write allergies to Healthie (from SOAP data)
        let allergiesCreated = 0;
        try {
            // Parse allergies from subjective text (look for "Allergies:" or "Allerg" patterns)
            const subjectiveText = note.soap_subjective || '';
            const allergyMatch = subjectiveText.match(/(?:Allergies|Known Allergies|Drug Allergies|Medication Allergies)[:\s]*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
            if (allergyMatch) {
                const allergyText = allergyMatch[1].trim();
                // Split by bullets, commas, or newlines
                const allergyItems = allergyText
                    .split(/[•\n,]/)
                    .map((a: string) => a.replace(/^[-*]\s*/, '').trim())
                    .filter((a: string) => a.length > 2 && !a.match(/^(none|no known|nkda|nka|denied|denies)/i));

                for (const allergyName of allergyItems) {
                    try {
                        await healthieGraphQL(`
                            mutation CreateAllergySensitivity($input: createAllergySensitivityInput!) {
                                createAllergySensitivity(input: $input) {
                                    allergy_sensitivity { id name }
                                    messages { field message }
                                }
                            }
                        `, {
                            input: {
                                user_id: String(healthiePatientId),
                                name: allergyName,
                            }
                        });
                        allergiesCreated++;
                    } catch (allergyErr) {
                        console.warn(`[Scribe:Submit] Allergy "${allergyName}" creation failed:`, allergyErr instanceof Error ? allergyErr.message : allergyErr);
                    }
                }
            }
            if (allergiesCreated > 0) {
                console.log(`[Scribe:Submit] Created ${allergiesCreated} allergies in Healthie`);
            }
        } catch (allergiesErr) {
            console.warn('[Scribe:Submit] Allergy write-back failed (non-fatal):', allergiesErr instanceof Error ? allergiesErr.message : allergiesErr);
        }

        // 5.7. Write vitals to Healthie (from Objective section)
        let vitalsCreated = 0;
        try {
            const objectiveText = note.soap_objective || '';
            const vitalPatterns: { type: string; regex: RegExp }[] = [
                { type: 'Blood Pressure - Systolic', regex: /(?:BP|Blood Pressure)[:\s]*(\d{2,3})\s*\/\s*(\d{2,3})/i },
                { type: 'Heart Rate', regex: /(?:HR|Heart Rate|Pulse)[:\s]*(\d{2,3})\s*(?:bpm|beats)?/i },
                { type: 'Temperature', regex: /(?:Temp|Temperature)[:\s]*(\d{2,3}(?:\.\d)?)\s*°?[FC]?/i },
                { type: 'Oxygen Saturation', regex: /(?:SpO2|O2 Sat|Oxygen Saturation)[:\s]*(\d{2,3})\s*%?/i },
                { type: 'Respiration Rate', regex: /(?:RR|Resp|Respiration Rate|Respiratory Rate)[:\s]*(\d{1,2})\s*(?:breaths)?/i },
                { type: 'Weight', regex: /(?:Weight|Wt)[:\s]*(\d{2,4}(?:\.\d)?)\s*(?:lbs?|kg|pounds)?/i },
            ];

            for (const { type, regex } of vitalPatterns) {
                const match = objectiveText.match(regex);
                if (match) {
                    const value = parseFloat(match[1]);
                    if (!isNaN(value)) {
                        try {
                            await healthieGraphQL(`
                                mutation CreateEntry($input: createEntryInput!) {
                                    createEntry(input: $input) {
                                        entry { id }
                                        messages { field message }
                                    }
                                }
                            `, {
                                input: {
                                    user_id: String(healthiePatientId),
                                    type: 'MetricEntry',
                                    category: type,
                                    metric_stat: String(value),
                                    created_at: visitDateObj.toISOString(),
                                }
                            });
                            vitalsCreated++;
                            console.log(`[Scribe:Submit] Vital "${type}" created: ${value}`);

                            // Also sync diastolic for BP
                            if (type === 'Blood Pressure - Systolic' && match[2]) {
                                const diastolic = parseFloat(match[2]);
                                if (!isNaN(diastolic)) {
                                    await healthieGraphQL(`
                                        mutation CreateEntry($input: createEntryInput!) {
                                            createEntry(input: $input) {
                                                entry { id }
                                                messages { field message }
                                            }
                                        }
                                    `, {
                                        input: {
                                            user_id: String(healthiePatientId),
                                            type: 'MetricEntry',
                                            category: 'Blood Pressure - Diastolic',
                                            metric_stat: String(diastolic),
                                            created_at: visitDateObj.toISOString(),
                                        }
                                    });
                                    vitalsCreated++;
                                    console.log(`[Scribe:Submit] Vital "Blood Pressure - Diastolic" created: ${diastolic}`);
                                }
                            }
                        } catch (vitalErr) {
                            console.warn(`[Scribe:Submit] Vital "${type}" creation failed:`, vitalErr instanceof Error ? vitalErr.message : vitalErr);
                        }
                    }
                }
            }
            if (vitalsCreated > 0) {
                console.log(`[Scribe:Submit] Created ${vitalsCreated} vital entries in Healthie`);
            }
        } catch (vitalsErr) {
            console.warn('[Scribe:Submit] Vitals write-back failed (non-fatal):', vitalsErr instanceof Error ? vitalsErr.message : vitalsErr);
        }

        // Note: ICD-10 codes are already embedded in the Assessment section of the SOAP form answer,
        // which is how Healthie stores diagnoses in chart notes.

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
            signed ? 'signed' : (locked ? 'locked' : 'submitted'),
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
                    signed ? `✍️ Status: Signed & Locked` : locked ? `🔒 Status: Locked` : `📤 Status: Submitted (not locked)`,
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
                healthie_status: signed ? 'signed' : (locked ? 'locked' : 'submitted'),
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

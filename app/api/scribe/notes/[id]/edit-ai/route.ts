import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Use Claude 3 Haiku for AI editing (fast and accurate)
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const CLAUDE_MODEL_ID = 'us.anthropic.claude-3-haiku-20240307-v1:0';

// POST: AI-powered note editing
// Matches Telegram bot's "Edit via AI" mode (L2067-2168)
// Send an edit instruction → Gemini returns updated content
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
        const noteId = params.id;
        const { edit_instruction, section } = await request.json();

        if (!edit_instruction) {
            return NextResponse.json(
                { success: false, error: 'edit_instruction is required' },
                { status: 400 }
            );
        }

        // Fetch current note
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [noteId]
        );
        if (!note) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        // Determine what to edit — specific section or full note
        const validSections = ['soap_subjective', 'soap_objective', 'soap_assessment', 'soap_plan', 'full_note_text'];
        const targetSection = section && validSections.includes(section) ? section : null;

        const sectionLabels: Record<string, string> = {
            soap_subjective: 'Subjective',
            soap_objective: 'Objective',
            soap_assessment: 'Assessment',
            soap_plan: 'Plan',
            full_note_text: 'Full Note',
        };

        let currentContent: string;
        let docLabel: string;

        if (targetSection) {
            currentContent = note[targetSection] || '';
            docLabel = sectionLabels[targetSection] || targetSection;
        } else {
            // Edit full SOAP note
            currentContent = [
                note.soap_subjective ? `SUBJECTIVE\n${note.soap_subjective}` : '',
                note.soap_objective ? `OBJECTIVE\n${note.soap_objective}` : '',
                note.soap_assessment ? `ASSESSMENT\n${note.soap_assessment}` : '',
                note.soap_plan ? `PLAN\n${note.soap_plan}` : '',
            ].filter(Boolean).join('\n\n');
            docLabel = 'SOAP Note';
        }

        if (!currentContent.trim()) {
            return NextResponse.json(
                { success: false, error: `No content to edit in ${docLabel}` },
                { status: 400 }
            );
        }

        // Call Claude 3 Haiku for intelligent editing
        const editPrompt = `You are a medical scribe editor for a clinical SOAP note at NowOptimal Network. Apply the provider's edit instruction EXACTLY as requested.

**RULES:**
1. **DO EXACTLY WHAT THE PROVIDER ASKS** — if they say remove something, remove it. If they say add something, add it. If they say change something, change it. Do not second-guess the provider's clinical judgment.
2. Keep the formatting structure (bold headers, bullet points, line breaks)
3. Preserve ICD-10 codes UNLESS the provider specifically says to remove or change a diagnosis
4. If the provider removes a diagnosis, also remove its ICD-10 code from the Assessment section
5. If the provider adds lot numbers, NDC numbers, or specific product details, include them exactly as stated
6. If the provider says a procedure was NOT performed by them (e.g., "I did not inject cortisone, that was another provider"), remove it from the Objective/procedures performed and note it only in the HPI as patient-reported history
7. Return ONLY the updated ${docLabel} — no commentary, no explanation, no preamble

**PROVIDER'S EDIT INSTRUCTION:** ${edit_instruction}

**CURRENT ${docLabel.toUpperCase()}:**
${currentContent}

**UPDATED ${docLabel.toUpperCase()}:**`;

        let updatedContent: string;
        try {
            const claudeRequest = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 8000,
                temperature: 0.1,  // Medical edits need to be precise
                messages: [
                    {
                        role: 'user',
                        content: editPrompt
                    }
                ]
            };

            const command = new InvokeModelCommand({
                modelId: CLAUDE_MODEL_ID,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(claudeRequest)
            });

            const response = await bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            if (!responseBody.content || responseBody.content.length === 0) {
                console.error('[Scribe:AI-Edit] Invalid Claude response:', responseBody);
                return NextResponse.json(
                    { success: false, error: 'AI editing failed — invalid response from Claude' },
                    { status: 502 }
                );
            }

            updatedContent = responseBody.content[0].text;
            console.log(`[Scribe:AI-Edit] Claude edited ${docLabel}: ${updatedContent.length} chars`);
        } catch (error: any) {
            console.error('[Scribe:AI-Edit] Claude error:', error);
            return NextResponse.json(
                { success: false, error: `AI editing failed: ${error.message}` },
                { status: 502 }
            );
        }

        // Save the updated content
        if (targetSection) {
            await query(
                `UPDATE scribe_notes SET ${targetSection} = $1, updated_at = NOW() WHERE note_id = $2`,
                [updatedContent, noteId]
            );
        } else {
            // Parse updated full SOAP back into sections
            // IMPORTANT: Use same parsing logic as generate-note to handle leading/trailing spaces
            const sections = updatedContent.split(/^\s*(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN|PRESCRIPTIONS|PATIENT INSTRUCTIONS|FOLLOW-UP)\s*$/gmi);

            const result = {
                subjective: '',
                objective: '',
                assessment: '',
                plan: ''
            };

            let currentSection = '';
            for (let i = 0; i < sections.length; i++) {
                const part = sections[i];
                if (!part) continue;

                const upper = part.trim().toUpperCase();
                if (upper === 'SUBJECTIVE') {
                    currentSection = 'subjective';
                } else if (upper === 'OBJECTIVE') {
                    currentSection = 'objective';
                } else if (upper === 'ASSESSMENT') {
                    currentSection = 'assessment';
                } else if (upper === 'PLAN') {
                    currentSection = 'plan';
                } else if (upper === 'PRESCRIPTIONS' || upper === 'PATIENT INSTRUCTIONS' || upper === 'FOLLOW-UP') {
                    if (currentSection === 'plan') {
                        result.plan += '\n\n**' + part.trim() + '**\n';
                    }
                    currentSection = 'plan';
                } else if (currentSection) {
                    result[currentSection] += part;
                }
            }

            // Clean up - remove signature blocks from plan
            if (result.plan) {
                result.plan = result.plan.replace(/---\s*\nElectronically signed by[\s\S]*$/i, '').trim();
            }

            await query(`
                UPDATE scribe_notes SET
                    soap_subjective = $1,
                    soap_objective = $2,
                    soap_assessment = $3,
                    soap_plan = $4,
                    full_note_text = $5,
                    updated_at = NOW()
                WHERE note_id = $6
            `, [
                result.subjective.trim() || note.soap_subjective,
                result.objective.trim() || note.soap_objective,
                result.assessment.trim() || note.soap_assessment,
                result.plan.trim() || note.soap_plan,
                updatedContent,
                noteId,
            ]);
        }

        // Fetch the updated note
        const [updatedNote] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [noteId]
        );

        return NextResponse.json({
            success: true,
            data: {
                note_id: noteId,
                section_edited: targetSection || 'full',
                edit_instruction,
                updated_note: updatedNote,
            },
        });
    } catch (error) {
        console.error('[Scribe:AI-Edit] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

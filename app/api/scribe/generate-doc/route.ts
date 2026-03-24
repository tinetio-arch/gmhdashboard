import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Use Claude 3.5 Haiku via Bedrock for fast doc generation
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const CLAUDE_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

// Supported supplementary document types (matching Telegram bot)
// Uses the EXACT templates from prompts_config.yaml (matching Python scribe)
const DOC_TYPES: Record<string, { label: string; promptTemplate: (ctx: DocContext) => string }> = {
    work_note: {
        label: 'Work Excuse Note',
        promptTemplate: (ctx) => `**Task**
Generate a brief, professional medical excuse note for patient ${ctx.patientName} who needs time off from work.

**Today's date:** ${ctx.today}
**Visit date:** ${ctx.visitDate}
${ctx.numDays ? `**Days off requested:** ${ctx.numDays} days (starting from the visit date: ${ctx.visitDate})` : ''}

**SOAP NOTE:**
${ctx.soapContext}

**Output Format:**

${ctx.visitDate}

To Whom It May Concern,

This letter confirms that ${ctx.patientName} was evaluated at our clinic on ${ctx.visitDate} for a medical condition.

Based on my clinical assessment, the patient requires ${ctx.numDays ? `${ctx.numDays} days` : 'time'} off from work for medical reasons, effective ${ctx.visitDate}.

**The patient is excused from work from ${ctx.visitDate} through [calculate: ${ctx.numDays || 'N'} days from ${ctx.visitDate}, write the exact end date]. The patient may return to work on [the day after the end date].**

If you have questions regarding this medical excuse, please contact our office.

Rules:
1. Keep the note to 4-6 sentences
2. Do NOT include specific diagnosis details (HIPAA compliant)
3. The return-to-work date line and the date range MUST be wrapped in **bold** markers
4. You MUST calculate and write out the exact calendar dates — never use brackets or placeholders
5. Do NOT include "Sincerely" or any signature block — that is added automatically
6. Do NOT include --- horizontal rules`,
    },
    school_note: {
        label: 'School Excuse Note',
        promptTemplate: (ctx) => `**Task**
Generate a brief, professional medical excuse note for student ${ctx.patientName} who needs time off from school.

**Today's date:** ${ctx.today}
**Visit date:** ${ctx.visitDate}
${ctx.numDays ? `**Days off requested:** ${ctx.numDays} days (starting from the visit date: ${ctx.visitDate})` : ''}

**SOAP NOTE:**
${ctx.soapContext}

**Output Format:**

${ctx.visitDate}

To Whom It May Concern,

This letter confirms that ${ctx.patientName} was evaluated at our medical office on ${ctx.visitDate}.

Based on my clinical assessment, the student requires ${ctx.numDays ? `${ctx.numDays} days` : 'time'} off from school for medical reasons, effective ${ctx.visitDate}.

**The student is excused from school from ${ctx.visitDate} through [calculate: ${ctx.numDays || 'N'} days from ${ctx.visitDate}, write the exact end date]. The student may return to school on [the day after the end date] without restrictions.**

Please contact our office if you require any additional documentation.

Rules:
1. Keep the note brief and age-appropriate
2. Do NOT include specific diagnosis details (HIPAA compliant)
3. The return-to-school date line and the date range MUST be wrapped in **bold** markers
4. You MUST calculate and write out the exact calendar dates — never use brackets or placeholders
5. Do NOT include "Sincerely" or any signature block — that is added automatically
6. Do NOT include --- horizontal rules`,
    },
    discharge_instructions: {
        label: 'Discharge Instructions',
        promptTemplate: (ctx) => `You are ${ctx.providerName} writing comprehensive discharge instructions for patient ${ctx.patientName}. These should be thorough, warm, and patient-friendly. Base everything on the SOAP note below.

**SOAP NOTE:**
${ctx.soapContext}

Write thorough discharge instructions covering ALL of the following sections. Write each section with detail — be comprehensive, not brief. Skip a section ONLY if it is completely irrelevant to this visit:

**DISCHARGE INSTRUCTIONS**

**Prescription & Pharmacy Information:**
If medications were prescribed or continued, explain what was sent, remind them to call/text if there are pharmacy issues. If no medications were discussed, skip this section.

**Medications:**
List every medication from the SOAP note. For each one, include: the name, dosage, how often to take it, and any special instructions in plain language the patient can follow at home. Be thorough — explain what each medication is for in simple terms.

**Probiotic Support:**
If antibiotics were prescribed, recommend a daily yogurt or probiotic supplement to support gut health. Otherwise skip.

**Symptom Monitoring:**
Detail specific symptoms the patient should watch for based on their diagnoses. Include warning signs that require immediate medical attention (e.g., ER-worthy symptoms). Be specific to their conditions.

**General Health Recommendations:**
Provide relevant lifestyle, diet, exercise, hydration, and wellness recommendations based on the diagnoses and plan. Include practical, actionable tips.

**Follow-Up:**
State when to return and what will be checked. Include any lab work or tests that need to be done before the next visit.

**Personal Note:**
Thank you for trusting the NowOptimal Network with your care. It's my privilege to help you feel better. Please don't hesitate to reach out if you have any questions or concerns.

Rules:
1. Write in second person ("you", "your") with warm, conversational tone
2. Use simple language a patient can understand — avoid medical jargon where possible
3. Be thorough and comprehensive — these should be detailed enough for the patient to reference at home
4. **CRITICAL: ONLY include information explicitly stated in the SOAP note. Do NOT add lab tests, follow-up timelines, medications, procedures, or recommendations that are not documented in the note. If the provider didn't mention lipid panels, don't add lipid panels. If the provider didn't say when to return, don't invent a return date. Stick strictly to what was documented.**
5. Do NOT invent pharmacy names or details not in the SOAP note — if a pharmacy isn't mentioned, say "your pharmacy"
6. Do NOT include brackets or placeholder text
7. Do NOT include provider contact information — that is added automatically by the PDF generator
8. Do NOT include --- horizontal rules or "Sincerely" signature blocks`,
    },
    care_plan: {
        label: 'Care Plan',
        promptTemplate: (ctx) => `Analyze the PLAN section of this SOAP note and extract specific, actionable goals for a Care Plan.

**SOAP NOTE:**
${ctx.soapContext}

**PATIENT NAME:** ${ctx.patientName}
**DATE:** ${ctx.visitDate}

Generate a structured care plan including:
- Problem list with ICD-10 codes
- Goals (short-term and long-term) with specific names and descriptions
- Interventions for each problem (medications, exercise, diet, referrals)
- Follow-up schedule
- Frequency for each goal (Daily/Weekly/etc)

Rules:
1. Only extract items from the PLAN section that require patient action.
2. Ignore "Continue" items unless they are critical.
3. Format as a clean, readable care plan document.

Output ONLY the care plan text. No commentary.`,
    },
};

interface DocContext {
    patientName: string;
    visitDate: string;
    today: string;
    visitType: string;
    providerName: string;
    soapContext: string;
    numDays?: number;
}

// POST: Generate a supplementary document from a scribe session
export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const { session_id, doc_type, num_days } = await request.json();

        if (!session_id || !doc_type) {
            return NextResponse.json(
                { success: false, error: 'session_id and doc_type are required' },
                { status: 400 }
            );
        }

        const docConfig = DOC_TYPES[doc_type];
        if (!docConfig) {
            return NextResponse.json(
                { success: false, error: `Invalid doc_type. Must be one of: ${Object.keys(DOC_TYPES).join(', ')}` },
                { status: 400 }
            );
        }

        // Fetch session + note + patient
        const [session] = await query<any>(`
            SELECT ss.*, p.full_name as patient_name, u.display_name as provider_name
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id::text = p.patient_id::text
            LEFT JOIN users u ON ss.created_by::text = u.user_id::text
            WHERE ss.session_id = $1
        `, [session_id]);

        if (!session) {
            return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
        }

        // Get SOAP note for context
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE session_id = $1',
            [session_id]
        );

        const soapContext = note
            ? [
                note.soap_subjective ? `SUBJECTIVE: ${note.soap_subjective}` : '',
                note.soap_objective ? `OBJECTIVE: ${note.soap_objective}` : '',
                note.soap_assessment ? `ASSESSMENT: ${note.soap_assessment}` : '',
                note.soap_plan ? `PLAN: ${note.soap_plan}` : '',
            ].filter(Boolean).join('\n\n')
            : session.transcript || 'No clinical context available';

        // Use encounter_date if available, else session created_at
        const encounterDate = session.encounter_date
            ? new Date(session.encounter_date + 'T12:00:00')
            : new Date(session.created_at);
        const visitDateStr = encounterDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        const ctx: DocContext = {
            patientName: session.patient_name || 'Patient',
            visitDate: visitDateStr,
            today: todayStr,
            visitType: session.visit_type || 'Follow-up',
            providerName: session.provider_name || 'Phil Schafer, NP',
            soapContext,
            numDays: num_days ? parseInt(num_days, 10) : undefined,
        };

        // Generate via Claude Haiku (Bedrock)
        const prompt = docConfig.promptTemplate(ctx);

        let generatedContent: string;
        try {
            const claudeRequest = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 4096,
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }],
            };

            const command = new InvokeModelCommand({
                modelId: CLAUDE_MODEL_ID,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(claudeRequest),
            });

            const response = await bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            generatedContent = responseBody.content?.[0]?.text;
            if (!generatedContent) {
                console.error('[Scribe:GenerateDoc] Claude empty response:', JSON.stringify(responseBody).substring(0, 500));
                return NextResponse.json(
                    { success: false, error: `Failed to generate ${docConfig.label}` },
                    { status: 502 }
                );
            }

            console.log(`[Scribe:GenerateDoc] Claude generated ${docConfig.label}: ${generatedContent.length} chars`);
        } catch (aiError: any) {
            console.error('[Scribe:GenerateDoc] Claude error:', aiError);
            return NextResponse.json(
                { success: false, error: `AI generation failed: ${aiError.message}` },
                { status: 502 }
            );
        }

        // Store in supplementary_docs JSONB on scribe_notes (if note exists)
        // or create a standalone record
        if (note) {
            const existingDocs = note.supplementary_docs || {};
            existingDocs[doc_type] = {
                content: generatedContent,
                generated_at: new Date().toISOString(),
                selected: true,
            };

            await query(
                `UPDATE scribe_notes SET supplementary_docs = $1, updated_at = NOW() WHERE note_id = $2`,
                [JSON.stringify(existingDocs), note.note_id]
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                session_id,
                doc_type,
                label: docConfig.label,
                content: generatedContent,
                note_id: note?.note_id || null,
            },
        });
    } catch (error) {
        console.error('[Scribe:GenerateDoc] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

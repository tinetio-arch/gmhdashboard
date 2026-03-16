import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Supported supplementary document types (matching Telegram bot)
// Uses the EXACT templates from prompts_config.yaml (matching Python scribe)
const DOC_TYPES: Record<string, { label: string; promptTemplate: (ctx: DocContext) => string }> = {
    work_note: {
        label: 'Work Excuse Note',
        promptTemplate: (ctx) => `**Task**
Generate a brief, professional medical note for patient ${ctx.patientName} who needs time off from work.

**SOAP NOTE:**
${ctx.soapContext}

**Output Format:**

---

${ctx.visitDate}

To Whom It May Concern,

This letter confirms that ${ctx.patientName} was evaluated at our clinic today for a medical condition.

Based on my clinical assessment, the patient requires ${ctx.numDays ? `${ctx.numDays} days` : 'time'} off from work for medical reasons.

The patient may return to work on ${ctx.numDays ? `[calculate exact date: ${ctx.numDays} days from ${ctx.visitDate}]` : '[calculate return date based on clinical context]'}.

If you have questions regarding this medical excuse, please contact our office.

Sincerely,

Phil Schafer, NP
NowOptimal Network
Phone: 928-277-0001
Fax: 928-350-6228

---

Keep the note to 4-6 sentences. Do NOT include specific diagnosis details (HIPAA compliant).`,
    },
    school_note: {
        label: 'School Excuse Note',
        promptTemplate: (ctx) => `**Task**
Generate a brief, professional medical note for student ${ctx.patientName} who needs time off from school.

**SOAP NOTE:**
${ctx.soapContext}

**Output Format:**

---

${ctx.visitDate}

To Whom It May Concern,

This letter confirms that ${ctx.patientName} was evaluated at our medical office today.

Based on my clinical assessment, the student requires ${ctx.numDays ? `${ctx.numDays} days` : 'time'} off from school for medical reasons.

The student may return to school on ${ctx.numDays ? `[calculate exact date: ${ctx.numDays} days from ${ctx.visitDate}]` : '[calculate return date]'} without restrictions.

Please contact our office if you require any additional documentation.

Sincerely,

Phil Schafer, NP
NowOptimal Network
Phone: 928-277-0001
Fax: 928-350-6228

---

Keep the note brief and age-appropriate. Do NOT include specific diagnosis details (HIPAA compliant).`,
    },
    discharge_instructions: {
        label: 'Discharge Instructions',
        promptTemplate: (ctx) => `**Situation**
You are an AI-powered EMR system designed to support Phil Schafer, NP in generating patient discharge instructions. Transform the SOAP note into clear, actionable discharge instructions that are patient-friendly, comprehensive, and include personalized contact information.

**Task**
Generate structured discharge instructions formatted for patient comprehension based on this SOAP note.

**SOAP NOTE:**
${ctx.soapContext}

**PATIENT NAME:** ${ctx.patientName}

**Output Format:**

---

**DISCHARGE INSTRUCTIONS**

**[Pharmacy and Prescription Information - Include only if medications are mentioned]**
"I sent your prescriptions to [Pharmacy Name] as you requested. Please call or text if there are any issues."

**Medications:**
[List each prescribed medication with dosage, frequency, and specific instructions in plain language]

**[Probiotic Support - Include only if antibiotics are prescribed]**
Consume a daily yogurt or take a probiotic supplement to support gut health during antibiotic use.

**Symptom Monitoring:**
[Detail symptoms to monitor and warning signs requiring immediate medical attention]

**General Health Tips:**
[Include relevant health recommendations based on the diagnosis]

**Follow-Up:**
[Provide specific follow-up appointment date or general timeline]

**Contact Information:**
Phil Schafer, NP
Call or Text: 928-277-0001
Fax: 928-350-6228
Email: admin@granitemountainhealth.com

**Personal Note:**
Thank you for trusting the NowOptimal Network with your care. It's my privilege to help you feel better. Please don't hesitate to reach out if you have any questions or concerns.

---

Write in second person ("you," "your") with clear, simple language.`,
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
            SELECT ss.*, p.full_name as patient_name
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id::text = p.patient_id::text
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

        const ctx: DocContext = {
            patientName: session.patient_name || 'Patient',
            visitDate: new Date(session.created_at).toLocaleDateString(),
            visitType: session.visit_type || 'Follow-up',
            providerName: 'Provider',
            soapContext,
            numDays: num_days ? parseInt(num_days, 10) : undefined,
        };

        // Generate via Gemini
        const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
        if (!GEMINI_API_KEY) {
            return NextResponse.json({ success: false, error: 'GOOGLE_AI_API_KEY not configured' }, { status: 500 });
        }

        const prompt = docConfig.promptTemplate(ctx);

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
                }),
            }
        );

        const geminiResult: any = await geminiResponse.json();
        const generatedContent = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedContent) {
            console.error('[Scribe:GenerateDoc] Gemini response:', JSON.stringify(geminiResult).substring(0, 500));
            return NextResponse.json(
                { success: false, error: `Failed to generate ${docConfig.label}` },
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

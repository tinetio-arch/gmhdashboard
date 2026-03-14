import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Gemini generation can take time

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

// ==================== SOAP PROMPT BUILDER ====================
// Uses the EXACT same template as the Python scribe (prompts_config.yaml → standard_soap)
function buildSoapPrompt(ctx: {
    patient_name: string;
    dob: string | null;
    medications: string;
    recent_labs: string;
    last_visit_summary: string;
    diagnoses: string;
    transcript: string;
    visit_type: string;
}): string {
    const currentDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // This is the EXACT standard_soap template from prompts_config.yaml
    const soapPrompt = `**Situation**
You are Phil Schafer, NP at NowOptimal Network in Prescott, Arizona. You are documenting a patient encounter that has just concluded. The documentation must meet clinical standards for medical records, ensure compliance with healthcare regulations, and serve as a legal record of the patient visit. This SOAP note will be used for continuity of care, billing purposes, and potential legal review.

**Task**
Generate a comprehensive SOAP (Subjective, Objective, Assessment, and Plan) note from the provided patient visit transcript. The assistant should transform the conversational transcript into a structured clinical document that captures all relevant medical information in standardized medical terminology and format, matching Phil Schafer's established documentation style and level of detail.

**Objective**
Create a complete, clinically accurate, and legally defensible medical record that documents the patient encounter thoroughly, supports appropriate billing and coding, provides clear guidance for follow-up care and treatment continuity, and includes complete prescription and pharmacy information for all medications ordered.

**Knowledge**

Patient Information Required:
- Patient Name: ${ctx.patient_name}
- Visit Date: ${currentDate}
- Clinical Transcript: ${ctx.transcript}

Documentation Standards:
1. The assistant should document ALL physical exam body systems listed in the template, even if not explicitly mentioned in the transcript. When findings are not stated, document normal exam findings using standard medical terminology.

2. The assistant should write the History of Present Illness (HPI) as a detailed narrative, but MUST use paragraph breaks to separate distinct topics (e.g., presenting complaint vs. social history). Use bullet points for lists of symptoms or multiple complaints to improve readability. Avoid long, dense blocks of text.

3. The assistant should include ICD-10 codes for every diagnosis listed in the Assessment and Plan section.

4. The assistant should specify exact medication details including: drug name, dosage, route, frequency, quantity dispensed, number of refills, and specific administration instructions when applicable.

5. The assistant should include complete prescription information for all medications ordered, including pharmacy details when provided in the transcript.

6. The assistant should maintain the exact format structure provided, including bold section headers. Use bullet points or numbered lists freely within sections to break up text and make the note "beautiful" and easy to read.

7. The assistant should capture the conversational, thorough documentation style demonstrated in Phil Schafer's notes, including patient quotes when clinically relevant, detailed symptom descriptions, and comprehensive patient counseling documentation.

Physical Exam Guidelines:
- Document only relevant systems based on the visit type and chief complaint
- For routine follow-ups or simple visits, a focused exam is appropriate
- For comprehensive exams or complex cases, document all systems
- Use standard medical terminology for findings
- Replace normal findings with specific abnormal findings when documented in transcript

Standard Physical Exam Template (adapt based on visit complexity):

**For Focused/Follow-up Visits:**
General: Alert and oriented, in no acute distress. Well-developed and well-nourished.
Vitals: [As documented]
[Document only relevant systems based on chief complaint]

**For Comprehensive Exams:**
General: Alert and oriented, in no acute distress. Well-developed, hydrated, and nourished. Appears stated age.

HEENT: Normocephalic, atraumatic. PERRLA, EOMI. TMs intact bilaterally. Oropharynx clear without erythema.

Neck: Supple, no lymphadenopathy or thyromegaly.

Cardiovascular: Regular rate and rhythm. No murmurs, gallops, or rubs.

Respiratory: Clear to auscultation bilaterally. No wheezes or rales.

Abdomen: Soft, non-tender, non-distended. Normoactive bowel sounds.

Extremities: No edema, cyanosis, or clubbing. Pulses 2+ bilaterally.

Musculoskeletal: Normal range of motion. 5/5 strength throughout.

Neurological: Cranial nerves II-XII intact. Sensation intact. DTRs 2+ bilaterally. Steady gait.

Psychiatric: Appropriate mood and affect. No suicidal or homicidal ideation.

Required Output Structure (Strictly follow this order):

SUBJECTIVE
**Chief Complaint:**
[Text]

**History of Present Illness:**
[Detailed narrative with paragraph breaks]

**Review of Systems:**
[Bulleted List]

**Current Medications:**
[Bulleted List]

**Allergies:**
[List]

OBJECTIVE
**Vitals:**
[Text]

**Lab Results:**
[Text if applicable]

**Physical Exam:**
[Insert Physical Exam here - MUST BE within OBJECTIVE section]

ASSESSMENT
[List Diagnoses with ICD-10]

PLAN
[Format as follows for EACH diagnosis:]
**Diagnosis Name (ICD-10):**
- Specific intervention (medication, referral, counseling, or monitoring).

PRESCRIPTIONS
[List]

PATIENT INSTRUCTIONS
[Bulleted list]

FOLLOW-UP
[Text]

---
Electronically signed by Phil Schafer, NP
NowOptimal Network
${currentDate}

**Formatting Rules:**
- DO NOT use markdown headers (# or ##).
- Use **Bold** for subsection headers (e.g., **Chief Complaint:**).
- Start main sections (SUBJECTIVE, OBJECTIVE, etc.) on their own line in ALL CAPS.
- Use bullet points * for lists to ensure readability.
- Insert empty lines between sections for clean separation.
- **CRITICAL:** The Physical Exam MUST be placed inside the OBJECTIVE section, before Assessment.

The assistant should modify the standard physical exam template only when the transcript explicitly documents abnormal findings for specific body systems. When abnormalities are mentioned, replace the normal finding with the specific abnormal finding documented in the transcript, using detailed descriptive language.

The assistant should extract and organize information from the raw audio transcription into appropriate SOAP note sections, translating lay terminology into medical terminology where appropriate while maintaining clinical accuracy. The assistant should preserve clinically relevant patient statements and quotes that provide context for treatment decisions.

The assistant should document patient counseling comprehensively, including specific topics discussed, patient education provided, risks and benefits explained, and patient understanding or concerns expressed during the visit.`;

    return soapPrompt;
}

// ==================== MAIN HANDLER ====================
export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { session_id, patient_id, visit_type, patient_name, regenerate } = await request.json();

    if (!session_id) {
        return NextResponse.json({ success: false, error: 'session_id is required' }, { status: 400 });
    }
    if (!patient_id) {
        return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
    }

    try {
        // 0. Check for existing note (prevent duplicates unless regenerating)
        const [existingNote] = await query<any>(
            'SELECT note_id FROM scribe_notes WHERE session_id = $1',
            [session_id]
        );
        if (existingNote && !regenerate) {
            return NextResponse.json({
                success: false,
                error: `Note already exists for this session (note_id: ${existingNote.note_id}). Use PATCH to update.`,
            }, { status: 409 });
        }
        if (existingNote && regenerate) {
            await query('DELETE FROM scribe_notes WHERE note_id = $1', [existingNote.note_id]);
            await query("UPDATE scribe_sessions SET status = 'transcribed' WHERE session_id = $1", [session_id]);
            console.log(`[Scribe:GenerateNote] Deleted old note ${existingNote.note_id} for regeneration`);
        }

        // 1. Fetch session transcript
        const [session] = await query<any>(
            'SELECT * FROM scribe_sessions WHERE session_id = $1',
            [session_id]
        );
        if (!session?.transcript) {
            return NextResponse.json(
                { success: false, error: 'No transcript found for this session' },
                { status: 400 }
            );
        }

        // 2. Fetch patient context — validate UUID before querying uuid column
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patient_id);
        let patient: any = null;
        if (isUuid) {
            patient = (await query<any>(
                'SELECT * FROM patients WHERE patient_id = $1::uuid', [patient_id]
            ))[0];
        }

        if (!patient) {
            // Try by healthie_client_id
            patient = (await query<any>(
                'SELECT * FROM patients WHERE healthie_client_id = $1', [patient_id]
            ))[0];
        }

        // If still no patient, create a minimal patient object from session/request data
        const patientName = patient?.full_name || patient_name || session.patient_name || 'Unknown Patient';
        const patientDob = patient?.dob || null;
        const healthieId = patient?.healthie_client_id || patient_id;
        const resolvedPatientId = patient?.patient_id || patient_id;

        // Fetch recent medications in parallel (safe — returns empty arrays if patient not in DB)
        // REFRESH CONTEXT: Always fetch fresh data, especially on regenerate
        console.log(`[Scribe:GenerateNote] ${regenerate ? 'Regenerating' : 'Generating'} note for ${patientName} (${resolvedPatientId})`);

        const [recentMeds, recentTrt, recentLabs] = await Promise.all([
            patient ? query<any>(`
        SELECT pp.name, pd.sale_date FROM peptide_dispenses pd
        JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.patient_name ILIKE $1
        ORDER BY pd.sale_date DESC LIMIT 10
      `, [`%${patientName}%`]) : Promise.resolve([]),

            patient ? query<any>(`
        SELECT v.dea_drug_name, d.dose_per_syringe_ml as dose_ml, d.dispense_date
        FROM dispenses d JOIN vials v ON d.vial_id = v.vial_id
        WHERE d.patient_id = $1
        ORDER BY d.dispense_date DESC LIMIT 5
      `, [resolvedPatientId]) : Promise.resolve([]),

            healthieId ? query<any>(`
        SELECT status, created_at, source as lab_company
        FROM lab_review_queue
        WHERE healthie_id = $1
        ORDER BY created_at DESC LIMIT 5
      `, [healthieId]) : Promise.resolve([]),
        ]);

        console.log(`[Scribe:GenerateNote] Context loaded: ${recentMeds.length} peptides, ${recentTrt.length} TRT dispenses, ${recentLabs.length} labs`);

        // 3. Build prompt
        const medications = [
            ...recentMeds.map((m: any) => m.name),
            ...recentTrt.map((t: any) => `${t.dea_drug_name} ${t.dose_ml}mL`),
        ].join(', ') || 'None on file';

        const labSummary = recentLabs.length > 0
            ? recentLabs.map((l: any) => `${l.lab_company || 'Lab'} (${l.status}) ${new Date(l.created_at).toLocaleDateString()}`).join('; ')
            : 'No recent labs on file';

        const prompt = buildSoapPrompt({
            patient_name: patientName,
            dob: patientDob,
            medications,
            recent_labs: labSummary,
            last_visit_summary: 'See visit history',
            diagnoses: 'Per transcript',
            transcript: session.transcript,
            visit_type: visit_type || session.visit_type,
        });

        // 4. Call Gemini Flash
        const modelId = GEMINI_MODEL;
        if (!GEMINI_API_KEY) {
            return NextResponse.json({ success: false, error: 'GOOGLE_AI_API_KEY not configured' }, { status: 500 });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.2,  // REDUCED: More consistent medical documentation
                },
            }),
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error('[Scribe:GenerateNote] Gemini error:', geminiResponse.status, errText);
            return NextResponse.json({ success: false, error: `Gemini API error: ${geminiResponse.status}` }, { status: 500 });
        }

        const geminiResult = await geminiResponse.json();
        const aiText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // 5. Parse SOAP sections from text output (matching Python scribe's parse_soap_sections)
        // The prompt outputs section headers like SUBJECTIVE, OBJECTIVE, ASSESSMENT, PLAN
        const parseSoapSections = (text: string) => {
            const subMatch = text.match(/SUBJECTIVE[\s\S]*?(?=OBJECTIVE|$)/i);
            const objMatch = text.match(/OBJECTIVE[\s\S]*?(?=ASSESSMENT|$)/i);
            const assMatch = text.match(/ASSESSMENT[\s\S]*?(?=PLAN(?!\s*:)|$)/i);
            const planMatch = text.match(/PLAN[\s\S]*?(?=PRESCRIPTIONS|PATIENT INSTRUCTIONS|FOLLOW-UP|---\s*\nElectronically|$)/i);

            return {
                subjective: subMatch ? subMatch[0].replace(/^SUBJECTIVE\s*/i, '').trim() : '',
                objective: objMatch ? objMatch[0].replace(/^OBJECTIVE\s*/i, '').trim() : '',
                assessment: assMatch ? assMatch[0].replace(/^ASSESSMENT\s*/i, '').trim() : '',
                plan: planMatch ? planMatch[0].replace(/^PLAN\s*/i, '').trim() : '',
            };
        };

        const sections = parseSoapSections(aiText);

        // Extract ICD-10 codes from assessment section
        const icd10Regex = /\(([A-Z]\d{2}(?:\.\d{1,4})?)\)/g;
        const icd10Codes: Array<{ code: string; description: string }> = [];
        let match;
        while ((match = icd10Regex.exec(sections.assessment + '\n' + sections.plan)) !== null) {
            icd10Codes.push({ code: match[1], description: '' });
        }

        const subjective = sections.subjective;
        const objective = sections.objective;
        const assessment = sections.assessment;
        const plan = sections.plan;
        const cptCodes: any[] = [];
        const fullNote = aiText;

        // 6. Store in scribe_notes
        const [note] = await query<any>(`
      INSERT INTO scribe_notes
        (session_id, patient_id, visit_type,
         soap_subjective, soap_objective, soap_assessment, soap_plan,
         icd10_codes, cpt_codes, full_note_text,
         ai_model, ai_prompt_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
            session_id,
            patient_id,
            visit_type || session.visit_type,
            subjective,
            objective,
            assessment,
            plan,
            JSON.stringify(icd10Codes),
            JSON.stringify(cptCodes),
            fullNote,
            modelId,
            'v1',
        ]);

        // 7. Update session status
        await query(
            `UPDATE scribe_sessions SET status = 'note_generated', updated_at = NOW() WHERE session_id = $1`,
            [session_id]
        );

        return NextResponse.json({
            success: true,
            data: {
                note_id: note.note_id,
                session_id,
                soap: {
                    subjective,
                    objective,
                    assessment,
                    plan,
                },
                icd10_codes: icd10Codes,
                cpt_codes: cptCodes,
                ai_model: modelId,
            },
        });
    } catch (error) {
        console.error('[Scribe:GenerateNote] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

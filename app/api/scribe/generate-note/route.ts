import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Claude generation can take time

// Use Claude 3 Haiku via AWS Bedrock (us-east-2)
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const CLAUDE_MODEL_ID = 'us.anthropic.claude-3-haiku-20240307-v1:0';

console.log('[Scribe:GenerateNote] AI client initialized with Claude 3 Haiku (Bedrock)');

// ==================== MEDICATION CLASSIFICATION ====================
// FDA-approved medications that don't need disclaimer
const FDA_APPROVED_MEDS = new Set([
    'testosterone', 'metformin', 'lisinopril', 'atorvastatin', 'levothyroxine',
    'amlodipine', 'losartan', 'gabapentin', 'omeprazole', 'sertraline',
    'escitalopram', 'fluoxetine', 'duloxetine', 'tadalafil', 'sildenafil',
    'finasteride', 'dutasteride', 'anastrozole', 'tamoxifen', 'clomiphene',
    'hcg', 'human chorionic gonadotropin', // HCG is FDA-approved
]);

// Compounded peptides that need "Non-FDA approved, user-reported peptide" disclaimer
const COMPOUNDED_PEPTIDES = new Set([
    'semaglutide', 'tirzepatide', 'retatrutide', 'bpc-157', 'bpc 157',
    'tb-500', 'tb 500', 'thymosin', 'cjc-1295', 'cjc 1295', 'ipamorelin',
    'tesamorelin', 'sermorelin', 'ghrp-2', 'ghrp-6', 'aod 9604', 'aod-9604',
    'ghk-cu', 'ghk cu', 'pt-141', 'pt 141', 'gonadorelin', 'kisspeptin',
    'semax', 'selank', 'epithalon', 'mgf', 'mechano growth factor',
]);

function isFDAApproved(medicationName: string): boolean {
    const normalized = medicationName.toLowerCase().trim();
    // Check if any FDA-approved keyword is in the medication name
    for (const approved of FDA_APPROVED_MEDS) {
        if (normalized.includes(approved)) return true;
    }
    return false;
}

function isCompoundedPeptide(medicationName: string): boolean {
    const normalized = medicationName.toLowerCase().trim();
    // Check if any peptide keyword is in the medication name
    for (const peptide of COMPOUNDED_PEPTIDES) {
        if (normalized.includes(peptide)) return true;
    }
    return false;
}

function formatMedication(med: any): string {
    const name = med.name || 'Unknown medication';
    const dosage = med.dosage || '';
    const frequency = med.frequency || '';
    const route = med.route || '';

    let medLine = `* ${name}`;
    if (dosage) medLine += ` ${dosage}`;
    if (route) medLine += ` ${route}`;
    if (frequency) medLine += ` ${frequency}`;

    // Add disclaimer if it's a compounded peptide
    if (isCompoundedPeptide(name)) {
        medLine += ' (Non-FDA approved, user-reported peptide)';
    }

    return medLine;
}

// ==================== SOAP PROMPT BUILDER ====================
// Uses the EXACT same template as the Python scribe (prompts_config.yaml → standard_soap)
function buildSoapPrompt(ctx: {
    patient_name: string;
    dob: string | null;
    medications: string;
    allergies?: string;
    recent_labs: string;
    last_visit_summary: string;
    diagnoses: string;
    transcript: string;
    visit_type: string;
    provider_name?: string;
}): string {
    const currentDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const providerName = ctx.provider_name || 'Phil Schafer, NP';

    // This is the EXACT standard_soap template from prompts_config.yaml
    const soapPrompt = `**Situation**
You are ${providerName} at NowOptimal Network in Prescott, Arizona. You are documenting a patient encounter that has just concluded. The documentation must meet clinical standards for medical records, ensure compliance with healthcare regulations, and serve as a legal record of the patient visit. This SOAP note will be used for continuity of care, billing purposes, and potential legal review.

**Task**
Generate a comprehensive SOAP (Subjective, Objective, Assessment, and Plan) note from the provided patient visit transcript. The assistant should transform the conversational transcript into a structured clinical document that captures all relevant medical information in standardized medical terminology and format, matching ${providerName}'s established documentation style and level of detail.

**Objective**
Create a complete, clinically accurate, and legally defensible medical record that documents the patient encounter thoroughly, supports appropriate billing and coding, provides clear guidance for follow-up care and treatment continuity, and includes complete prescription and pharmacy information for all medications ordered.

**Knowledge**

Patient Information Required:
- Patient Name: ${ctx.patient_name}
- Visit Date: ${currentDate}
- Clinical Transcript: ${ctx.transcript}

**PATIENT MEDICAL HISTORY (from EMR):**
Use this context to enrich the SOAP note. Include these medications in the "Current Medications" section of Subjective, and include these allergies in the "Allergies" section.

**Current Medications on File:**
${ctx.medications}

**Allergies on File:**
${ctx.allergies || '* No known drug allergies'}

**Recent Labs:**
${ctx.recent_labs}

**IMPORTANT:** For any compounded peptides in the medication list, ALWAYS include the disclaimer "(Non-FDA approved, user-reported peptide)" exactly as shown above.

Documentation Standards:
1. The assistant should document ALL physical exam body systems listed in the template, even if not explicitly mentioned in the transcript. When findings are not stated, document normal exam findings using standard medical terminology.

2. The assistant should write the History of Present Illness (HPI) as a detailed narrative, but MUST use paragraph breaks to separate distinct topics (e.g., presenting complaint vs. social history). Use bullet points for lists of symptoms or multiple complaints to improve readability. Avoid long, dense blocks of text.

3. The assistant should include ICD-10 codes for every diagnosis listed in the Assessment and Plan section.

4. The assistant should specify exact medication details including: drug name, dosage, route, frequency, quantity dispensed, number of refills, and specific administration instructions when applicable.

5. The assistant should include complete prescription information for all medications ordered, including pharmacy details when provided in the transcript.

6. The assistant should maintain the exact format structure provided, including bold section headers. Use bullet points or numbered lists freely within sections to break up text and make the note "beautiful" and easy to read.

7. The assistant should capture the conversational, thorough documentation style including patient quotes when clinically relevant, detailed symptom descriptions, and comprehensive patient counseling documentation.

8. **CRITICAL - PLAN DETAIL REQUIREMENTS**: Each diagnosis in the Plan section MUST include:
   - Specific intervention performed or prescribed (with exact dosages, routes, frequencies)
   - Rationale for the intervention (why this treatment was chosen)
   - Patient counseling provided (what was explained to the patient)
   - Monitoring plan (what will be checked and when)
   - Follow-up timeline (specific dates or timeframes)
   - Patient response or concerns (if mentioned in transcript)
   Even for brief visits, expand the Plan with clinical reasoning and standard-of-care details.

Physical Exam Template (use this exact structure and language, modifying only when abnormal findings are documented):

General: Alert and oriented, in no acute distress. Well-developed, hydrated, and nourished. Appears stated age.

Skin: Warm, dry, and intact. No rashes, lesions, or ulcers.

Head: Normocephalic and atraumatic. No tenderness to palpation.

Eyes: Sclerae are non-icteric. Conjunctivae are pink and moist. Pupils are equal, round, and reactive to light and accommodation (PERRLA). Extraocular movements are intact (EOMI). Visual acuity grossly normal.

Ears: External ear canals are clear. Tympanic membranes are intact without erythema, bulging, or effusion.

Nose: Nasal mucosa is pink and moist. No discharge or septal deviation noted.

Throat/Mouth: Oral mucosa is pink and moist. Dentition is intact. Oropharynx is normal in appearance with no erythema, exudates, or swelling.

Neck: Supple with full range of motion. No lymphadenopathy, masses, or thyromegaly. Trachea is midline.

Heart: Regular rate and rhythm. No murmurs, gallops, or rubs. Normal S1 and S2.

Lungs: Clear to auscultation bilaterally. No wheezes, rales, or rhonchi. Normal respiratory effort without accessory muscle use.

Abdomen: Soft, non-tender, and non-distended. No masses, hepatomegaly, or splenomegaly. Bowel sounds are normoactive in all four quadrants.

Extremities: No edema, cyanosis, or clubbing. Peripheral pulses are 2+ and equal bilaterally. Capillary refill is normal.

Musculoskeletal: Normal range of motion in all extremities. 5/5 motor strength bilaterally in upper and lower extremities.

Neurological: Cranial nerves II-XII are intact. Sensation intact to light touch and pinprick. Deep tendon reflexes 2+ bilaterally. Steady gait noted. No tremors or focal deficits.

Psychiatric: Appropriate mood and affect. Good judgment and insight. Normal thought process. No visual or auditory hallucinations. No suicidal or homicidal ideation.

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
Electronically signed by ${providerName}
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

        // 1. Fetch session transcript + provider info
        const [session] = await query<any>(
            `SELECT ss.*, u.display_name as provider_name
             FROM scribe_sessions ss
             LEFT JOIN users u ON ss.created_by = u.user_id
             WHERE ss.session_id = $1`,
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

        // Fetch Healthie medical history if available
        let healthieMeds: any[] = [];
        let healthieAllergies: string[] = [];
        let healthieConditions: any[] = [];

        if (healthieId && process.env.HEALTHIE_API_KEY) {
            try {
                // Query Healthie GraphQL for medications
                const medsResponse = await fetch('https://api.gethealthie.com/graphql', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${process.env.HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `query {
                            medications(patient_id: "${healthieId}", active: true) {
                                id
                                name
                                dosage
                                frequency
                                route
                                directions
                            }
                            user(id: "${healthieId}") {
                                id
                                allergies
                            }
                        }`
                    })
                });

                const healthieData = await medsResponse.json();

                if (healthieData?.data?.medications) {
                    healthieMeds = healthieData.data.medications;
                    console.log(`[Scribe:GenerateNote] Fetched ${healthieMeds.length} medications from Healthie`);
                }

                if (healthieData?.data?.user?.allergies) {
                    // Healthies stores allergies as a string or array
                    const allergyData = healthieData.data.user.allergies;
                    if (typeof allergyData === 'string') {
                        healthieAllergies = allergyData.split(',').map((a: string) => a.trim()).filter(Boolean);
                    } else if (Array.isArray(allergyData)) {
                        healthieAllergies = allergyData;
                    }
                    console.log(`[Scribe:GenerateNote] Fetched ${healthieAllergies.length} allergies from Healthie`);
                }
            } catch (error) {
                console.error('[Scribe:GenerateNote] Healthie API error (non-fatal):', error);
            }
        }

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

        console.log(`[Scribe:GenerateNote] Context loaded: ${recentMeds.length} peptides, ${recentTrt.length} TRT dispenses, ${recentLabs.length} labs, ${healthieMeds.length} Healthie meds`);

        // 3. Build medications list with FDA/peptide classification
        const medicationsList: string[] = [];

        // Add Healthie medications (properly formatted with peptide disclaimer)
        for (const med of healthieMeds) {
            medicationsList.push(formatMedication(med));
        }

        // Add recent peptide dispenses from our system (with disclaimer)
        for (const peptide of recentMeds) {
            const formatted = formatMedication({ name: peptide.name });
            if (!medicationsList.includes(formatted)) {
                medicationsList.push(formatted);
            }
        }

        // Add recent TRT dispenses
        for (const trt of recentTrt) {
            const formatted = `* ${trt.dea_drug_name} ${trt.dose_ml}mL`;
            if (!medicationsList.includes(formatted)) {
                medicationsList.push(formatted);
            }
        }

        const medications = medicationsList.length > 0
            ? medicationsList.join('\n')
            : '* None on file';

        const allergies = healthieAllergies.length > 0
            ? healthieAllergies.map(a => `* ${a}`).join('\n')
            : '* No known drug allergies';

        const labSummary = recentLabs.length > 0
            ? recentLabs.map((l: any) => `${l.lab_company || 'Lab'} (${l.status}) ${new Date(l.created_at).toLocaleDateString()}`).join('; ')
            : 'No recent labs on file';

        const prompt = buildSoapPrompt({
            patient_name: patientName,
            dob: patientDob,
            medications,
            allergies,
            recent_labs: labSummary,
            last_visit_summary: 'See visit history',
            diagnoses: 'Per transcript',
            transcript: session.transcript,
            visit_type: visit_type || session.visit_type,
            provider_name: session.provider_name || 'Phil Schafer, NP',
        });

        // 4. Call Claude 3 Haiku via Bedrock
        console.log(`[Scribe:GenerateNote] Invoking Claude for patient ${patientName}...`);

        const claudeRequest = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 8000,
            temperature: 0.3, // Medical accuracy
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        };

        const command = new InvokeModelCommand({
            modelId: CLAUDE_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(claudeRequest)
        });

        let aiText = '';
        try {
            const response = await bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            if (!responseBody.content || responseBody.content.length === 0) {
                console.error('[Scribe:GenerateNote] Invalid Claude response:', responseBody);
                return NextResponse.json({ success: false, error: 'Invalid AI response structure' }, { status: 500 });
            }

            aiText = responseBody.content[0].text;
            console.log(`[Scribe:GenerateNote] Claude generated ${aiText.length} chars`);
        } catch (error: any) {
            console.error('[Scribe:GenerateNote] Claude error:', error);
            return NextResponse.json({ success: false, error: `Claude API error: ${error.message}` }, { status: 500 });
        }

        // 5. Parse SOAP sections from text output (matching Python scribe's parse_soap_sections)
        // The prompt outputs section headers like SUBJECTIVE, OBJECTIVE, ASSESSMENT, PLAN
        // IMPORTANT: Section headers MUST be at start of line (^) to avoid matching lowercase words like "plan" in HPI
        const parseSoapSections = (text: string) => {
            // Claude adds trailing spaces to every line, so we need to match ^\s*SECTION not ^SECTION
            // Split on section boundaries (allowing leading/trailing whitespace)
            const sections = text.split(/^\s*(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN|PRESCRIPTIONS|PATIENT INSTRUCTIONS|FOLLOW-UP)\s*$/gmi);

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
                    // These go into plan
                    if (currentSection === 'plan') {
                        result.plan += '\n\n**' + part.trim() + '**\n';
                    }
                    currentSection = 'plan';
                } else if (currentSection) {
                    // Content for current section
                    result[currentSection] += part;
                }
            }

            // Clean up - remove signature blocks from plan
            if (result.plan) {
                result.plan = result.plan.replace(/---\s*\nElectronically signed by[\s\S]*$/i, '').trim();
            }

            return {
                subjective: result.subjective.trim(),
                objective: result.objective.trim(),
                assessment: result.assessment.trim(),
                plan: result.plan.trim(),
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
            CLAUDE_MODEL_ID,
            'v2-claude',
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
                ai_model: CLAUDE_MODEL_ID,
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

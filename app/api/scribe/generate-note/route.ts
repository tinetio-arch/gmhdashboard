import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import {
    BedrockRuntimeClient, InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Claude generation can take time

// ==================== SOAP PROMPT BUILDER ====================
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
    return `You are an AI medical scribe for a naturopathic/integrative medicine clinic.
Generate a thorough SOAP note from the following visit transcript and patient context.

PATIENT CONTEXT:
- Name: ${ctx.patient_name}
- DOB: ${ctx.dob || 'Not on file'}
- Current Medications: ${ctx.medications}
- Recent Labs: ${ctx.recent_labs}
- Last Visit: ${ctx.last_visit_summary}
- Active Diagnoses: ${ctx.diagnoses}

VISIT TRANSCRIPT:
${ctx.transcript}

VISIT TYPE: ${ctx.visit_type}

Generate a complete SOAP note with:
S (Subjective): Chief complaint, HPI with onset/duration/severity, pertinent positives/negatives, ROS
O (Objective): Vitals if mentioned, physical exam findings, relevant lab results discussed
A (Assessment): Each diagnosis with ICD-10 code, clinical reasoning
P (Plan): For each diagnosis - medications (dose, route, frequency), labs ordered, imaging, referrals, follow-up timing, patient education provided

Be thorough. Include all clinically relevant details from the transcript.
Format ICD-10 codes as: [CODE] Description

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "subjective": "...",
  "objective": "...",
  "assessment": "...",
  "plan": "...",
  "icd10_codes": [{"code": "Z00.00", "description": "..."}],
  "cpt_codes": [{"code": "99214", "description": "..."}],
  "full_note": "..."
}`;
}

// ==================== MAIN HANDLER ====================
export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { session_id, patient_id, visit_type } = await request.json();

    if (!session_id) {
        return NextResponse.json({ success: false, error: 'session_id is required' }, { status: 400 });
    }
    if (!patient_id) {
        return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
    }

    try {
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

        // 2. Fetch patient context
        const [patient] = await query<any>(
            'SELECT * FROM patients WHERE patient_id = $1',
            [patient_id]
        );
        if (!patient) {
            return NextResponse.json(
                { success: false, error: 'Patient not found' }, { status: 404 }
            );
        }

        // Fetch recent medications in parallel
        const [recentMeds, recentTrt, recentLabs] = await Promise.all([
            query<any>(`
        SELECT pp.name, pd.sale_date FROM peptide_dispenses pd
        JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.patient_name ILIKE $1
        ORDER BY pd.sale_date DESC LIMIT 10
      `, [`%${patient.full_name}%`]),

            query<any>(`
        SELECT v.dea_drug_name, d.dose_per_syringe_ml as dose_ml, d.dispense_date
        FROM dispenses d JOIN vials v ON d.vial_id = v.vial_id
        WHERE d.patient_id = $1
        ORDER BY d.dispense_date DESC LIMIT 5
      `, [patient_id]),

            query<any>(`
        SELECT status, created_at, patient->>'lab_company' as lab_company
        FROM lab_review_queue
        WHERE patient->>'healthie_id' = $1
        ORDER BY created_at DESC LIMIT 5
      `, [patient.healthie_client_id || '']),
        ]);

        // 3. Build prompt
        const medications = [
            ...recentMeds.map((m: any) => m.name),
            ...recentTrt.map((t: any) => `${t.dea_drug_name} ${t.dose_ml}mL`),
        ].join(', ') || 'None on file';

        const labSummary = recentLabs.length > 0
            ? recentLabs.map((l: any) => `${l.lab_company || 'Lab'} (${l.status}) ${new Date(l.created_at).toLocaleDateString()}`).join('; ')
            : 'No recent labs on file';

        const prompt = buildSoapPrompt({
            patient_name: patient.full_name,
            dob: patient.date_of_birth,
            medications,
            recent_labs: labSummary,
            last_visit_summary: 'See visit history',
            diagnoses: 'Per transcript',
            transcript: session.transcript,
            visit_type: visit_type || session.visit_type,
        });

        // 4. Call Claude via Bedrock
        const bedrockRegion = process.env.AWS_BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-2';
        const modelId = process.env.SCRIBE_MODEL_ID ?? 'anthropic.claude-3-sonnet-20240229-v1:0';

        const bedrock = new BedrockRuntimeClient({ region: bedrockRegion });
        const response = await bedrock.send(new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 4096,
                messages: [
                    { role: 'user', content: prompt },
                ],
            }),
        }));

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiText = responseBody.content?.[0]?.text || '';

        // 5. Parse structured SOAP from Claude response
        let soapData: any;
        try {
            // Try to extract JSON from the response
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            soapData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (parseErr) {
            console.warn('[Scribe:GenerateNote] Could not parse structured JSON, using raw text');
            soapData = null;
        }

        const subjective = soapData?.subjective || '';
        const objective = soapData?.objective || '';
        const assessment = soapData?.assessment || '';
        const plan = soapData?.plan || '';
        const icd10Codes = soapData?.icd10_codes || [];
        const cptCodes = soapData?.cpt_codes || [];
        const fullNote = soapData?.full_note || aiText;

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

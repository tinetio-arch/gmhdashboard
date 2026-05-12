import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';
import { query } from '@/lib/db';
import { resolvePatientId, resolveHealthieId } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ipad/patient-data/
 * Add vitals, allergies, or medications to a patient's Healthie chart.
 * 
 * Body: { action, healthie_id, ...data }
 *   action: 'add_vital' | 'add_allergy' | 'add_medication'
 */
export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { action, healthie_id } = body;

        if (!healthie_id) {
            return NextResponse.json({ success: false, error: 'healthie_id is required' }, { status: 400 });
        }

        switch (action) {
            case 'add_vital':
                return await addVital(healthie_id, body);
            case 'add_allergy':
                return await addAllergy(healthie_id, body);
            case 'add_medication':
                return await addMedication(healthie_id, body);
            case 'update_medication':
                return await updateMedication(body);
            case 'deactivate_medication':
                return await deactivateMedication(body);
            case 'add_diagnosis':
                return await addDiagnosis(healthie_id, body);
            case 'remove_diagnosis':
                return await removeDiagnosis(healthie_id, body);
            case 'confirm_diagnosis':
                return await confirmDiagnosis(healthie_id, body);
            default:
                return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (error) {
        console.error('[iPad:PatientData] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// ==================== ADD VITAL ====================
async function addVital(healthieId: string, body: any) {
    const { category, value, description } = body;

    if (!category || !value) {
        return NextResponse.json({ success: false, error: 'category and value are required' }, { status: 400 });
    }

    // FIX(2026-04-07): Use unified resolver — handles UUID or Healthie ID
    healthieId = await resolveHealthieId(healthieId);

    console.log(`[iPad:PatientData] Creating vital ${category}=${value} for Healthie ID: ${healthieId}`);

    const result = await healthieGraphQL<any>(`
        mutation CreateEntry($input: createEntryInput!) {
            createEntry(input: $input) {
                entry {
                    id
                    category
                    metric_stat
                    description
                    created_at
                }
                messages {
                    field
                    message
                }
            }
        }
    `, {
        input: {
            user_id: healthieId,
            type: 'MetricEntry',
            category: category,
            metric_stat: String(value),
            description: description || '',
        }
    });

    if (result.createEntry?.messages?.length > 0) {
        const msg = result.createEntry.messages.map((m: any) => m.message).join(', ');
        return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    console.log(`[iPad:PatientData] Added vital ${category}=${value} for patient ${healthieId}`);
    return NextResponse.json({
        success: true,
        data: result.createEntry?.entry || {},
    });
}

// ==================== ADD ALLERGY ====================
// FIX(2026-04-09): Now syncs to Healthie via createAllergySensitivity mutation.
// Categories: allergy, intolerance, sensitivity, preference
// Category types: drug, environmental, food (food assumed for food-based categories)
async function addAllergy(healthieId: string, body: any) {
    const { name, severity, reaction, category, category_type, is_nkda, entered_by } = body;

    // FIX(2026-04-07): Use unified resolver — auto-creates patient if only in Healthie
    const patientId = await resolvePatientId(healthieId);
    if (!patientId) {
        return NextResponse.json({ success: false, error: 'Patient not found in local DB or Healthie' }, { status: 404 });
    }

    const resolvedHealthieId = await resolveHealthieId(healthieId);

    // NKDA: mark patient as having no known allergies
    if (is_nkda) {
        // Remove any existing allergies and add NKDA marker locally
        await query('DELETE FROM patient_allergies WHERE patient_id = $1', [patientId]);
        const [nkda] = await query<any>(
            `INSERT INTO patient_allergies (patient_id, name, is_nkda, status, entered_by, created_at)
             VALUES ($1, 'NKDA', TRUE, 'Active', $2, NOW())
             RETURNING *`,
            [patientId, entered_by || 'Staff']
        );
        console.log(`[iPad:PatientData] Marked NKDA for patient ${patientId} by ${entered_by}`);
        return NextResponse.json({ success: true, data: nkda });
    }

    if (!name) {
        return NextResponse.json({ success: false, error: 'Allergy name is required' }, { status: 400 });
    }

    // Remove NKDA marker if adding a real allergy
    await query('DELETE FROM patient_allergies WHERE patient_id = $1 AND is_nkda = TRUE', [patientId]);

    // 1. Sync to Healthie via createAllergySensitivity
    // Map our category field to Healthie's expected values:
    //   allergy → "allergy", intolerance → "intolerance",
    //   sensitivity → "sensitivity", preference → "preference"
    // Map our category to Healthie's category_type:
    //   Drug → "drug", Environmental → "environmental", Food → (omit, implied by food categories)
    const healthieCategory = (category || 'allergy').toLowerCase();
    const validCategories = ['allergy', 'intolerance', 'sensitivity', 'preference'];
    const allergyCategory = validCategories.includes(healthieCategory) ? healthieCategory : 'allergy';

    // Determine category_type: drug, environmental, food, etc.
    const allergyCategoryType = (category_type || 'drug').toLowerCase();

    let healthieAllergyId: string | null = null;
    try {
        const allergyResult = await healthieGraphQL<any>(`
            mutation CreateAllergySensitivity(
                $user_id: String,
                $category: String,
                $category_type: String,
                $status: String,
                $name: String,
                $custom_name: String,
                $reaction: String,
                $reaction_type: String,
                $onset_date: String,
                $severity: String
            ) {
                createAllergySensitivity(input: {
                    user_id: $user_id,
                    category: $category,
                    category_type: $category_type,
                    status: $status,
                    name: $name,
                    custom_name: $custom_name,
                    reaction: $reaction,
                    reaction_type: $reaction_type,
                    onset_date: $onset_date,
                    severity: $severity
                }) {
                    allergy_sensitivity {
                        id
                        name
                        category
                        category_type
                        severity
                        reaction
                        status
                        created_at
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `, {
            user_id: resolvedHealthieId,
            category: allergyCategory,
            category_type: allergyCategoryType,
            status: 'active',
            name: name,
            custom_name: '',
            reaction: reaction || '',
            reaction_type: 'allergy',
            onset_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            severity: (severity || 'unknown').toLowerCase(),
        });

        if (allergyResult?.createAllergySensitivity?.messages?.length > 0) {
            const msgs = allergyResult.createAllergySensitivity.messages.map((m: any) => m.message).join(', ');
            console.warn(`[iPad:PatientData] Healthie allergy creation warning: ${msgs}`);
            // Don't fail — still save locally even if Healthie has issues
        } else {
            healthieAllergyId = allergyResult?.createAllergySensitivity?.allergy_sensitivity?.id || null;
            console.log(`[iPad:PatientData] Synced allergy "${name}" to Healthie (ID: ${healthieAllergyId})`);
        }
    } catch (healthieErr: any) {
        // Non-fatal — still save locally if Healthie sync fails
        console.error(`[iPad:PatientData] Healthie allergy sync failed (non-fatal): ${healthieErr?.message}`);
    }

    // 2. Also store locally for quick retrieval
    const [allergy] = await query<any>(
        `INSERT INTO patient_allergies (patient_id, name, severity, reaction, category, status, entered_by, healthie_allergy_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7, NOW())
         RETURNING *`,
        [patientId, name, severity || null, reaction || null, category || 'Drug', entered_by || 'Staff', healthieAllergyId]
    );

    console.log(`[iPad:PatientData] Added allergy "${name}" for patient ${patientId} by ${entered_by} (Healthie sync: ${healthieAllergyId ? 'OK' : 'failed'})`);
    return NextResponse.json({ success: true, data: { ...allergy, healthie_synced: !!healthieAllergyId } });
}

// ==================== ADD MEDICATION ====================
async function addMedication(healthieId: string, body: any) {
    const { name, dosage, frequency, directions } = body;

    if (!name) {
        return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const result = await healthieGraphQL<any>(`
        mutation CreateMedication($input: createMedicationInput!) {
            createMedication(input: $input) {
                medication {
                    id
                    name
                    dosage
                    frequency
                    directions
                    active
                }
                messages {
                    field
                    message
                }
            }
        }
    `, {
        input: {
            user_id: healthieId,
            name: name,
            dosage: dosage || '',
            frequency: frequency || '',
            directions: directions || '',
            active: true,
            start_date: new Date().toISOString().split('T')[0],
        }
    });

    if (result.createMedication?.messages?.length > 0) {
        const msg = result.createMedication.messages.map((m: any) => m.message).join(', ');
        return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    // FIX(2026-03-19): Healthie creates medications as inactive. Must update to activate.
    const medId = result.createMedication?.medication?.id;
    if (medId) {
        try {
            await healthieGraphQL<any>(`
                mutation ActivateMed($input: updateMedicationInput!) {
                    updateMedication(input: $input) {
                        medication { id active }
                        messages { field message }
                    }
                }
            `, { input: { id: medId, active: true } });
        } catch (activateErr) {
            console.warn(`[iPad:PatientData] Could not activate medication ${medId}:`, activateErr);
        }
    }

    console.log(`[iPad:PatientData] Added medication "${name}" for patient ${healthieId} (id: ${medId})`);
    return NextResponse.json({
        success: true,
        data: { ...result.createMedication?.medication, active: true },
    });
}

// ==================== UPDATE MEDICATION ====================
// FIX(2026-04-01): Allow editing dose, frequency, directions, route on existing medications
async function updateMedication(body: any) {
    const { medication_id, name, dosage, frequency, directions, route } = body;

    if (!medication_id) {
        return NextResponse.json({ success: false, error: 'medication_id is required' }, { status: 400 });
    }

    // Build update input — only include fields that were provided
    const input: Record<string, any> = { id: medication_id };
    if (name !== undefined) input.name = name;
    if (dosage !== undefined) input.dosage = dosage;
    if (frequency !== undefined) input.frequency = frequency;
    if (directions !== undefined) input.directions = directions;
    if (route !== undefined) input.route = route;

    const gqlMutation = `
        mutation UpdateMedication($input: updateMedicationInput!) {
            updateMedication(input: $input) {
                medication {
                    id name dosage frequency directions route active
                }
                messages { field message }
            }
        }
    `;

    // FIX(2026-04-23): Healthie locks name, dosage, AND route on DoseSpot-mirrored medications.
    // - name/dosage return a "mirrored medication" validation message
    // - route causes a Healthie "Internal server error" (their bug, not ours)
    // Both cases need to fall through to a retry with only frequency + directions.
    const hasLockedFields = input.name || input.dosage || input.route;
    let result: any;
    let firstAttemptError: string | null = null;

    try {
        result = await healthieGraphQL<any>(gqlMutation, { input });
    } catch (err: any) {
        // Healthie throws "Internal server error" when route is sent for mirrored meds.
        // If we have locked fields, this might be the cause — try the safe retry.
        if (hasLockedFields && err.message?.includes('Internal server error')) {
            console.log(`[iPad:PatientData] Healthie internal error with locked fields — likely mirrored medication ${medication_id}`);
            firstAttemptError = 'mirrored';
        } else {
            throw err; // Not a mirrored med issue — let the outer catch handle it
        }
    }

    // Check for mirrored medication validation message (non-throwing path)
    if (!firstAttemptError && result?.updateMedication?.messages?.length > 0) {
        const msg = result.updateMedication.messages.map((m: any) => m.message).join(', ');
        if (msg.toLowerCase().includes('mirrored') && hasLockedFields) {
            firstAttemptError = 'mirrored';
        } else {
            return NextResponse.json({ success: false, error: msg }, { status: 400 });
        }
    }

    // Retry without name/dosage/route for mirrored medications
    if (firstAttemptError === 'mirrored') {
        const retryInput: Record<string, any> = { id: medication_id };
        if (frequency !== undefined) retryInput.frequency = frequency;
        if (directions !== undefined) retryInput.directions = directions;

        if (Object.keys(retryInput).length <= 1) {
            return NextResponse.json({
                success: false,
                error: 'This medication is linked to DoseSpot. Name, dosage, and route can only be changed by deleting and re-creating the medication.',
            }, { status: 400 });
        }

        console.log(`[iPad:PatientData] Retrying medication ${medication_id} with only frequency/directions`);
        const retryResult = await healthieGraphQL<any>(gqlMutation, { input: retryInput });

        if (retryResult.updateMedication?.messages?.length > 0) {
            const retryMsg = retryResult.updateMedication.messages.map((m: any) => m.message).join(', ');
            return NextResponse.json({ success: false, error: retryMsg }, { status: 400 });
        }

        console.log(`[iPad:PatientData] Updated medication ${medication_id} (name/dosage/route locked — frequency/directions updated)`);
        return NextResponse.json({
            success: true,
            data: retryResult.updateMedication?.medication,
            warning: 'This medication is linked to DoseSpot — name, dosage, and route are locked. Frequency and directions were updated.',
        });
    }

    console.log(`[iPad:PatientData] Updated medication ${medication_id}`);
    return NextResponse.json({
        success: true,
        data: result.updateMedication?.medication,
    });
}

// ==================== DEACTIVATE MEDICATION ====================
async function deactivateMedication(body: any) {
    const { medication_id } = body;

    if (!medication_id) {
        return NextResponse.json({ success: false, error: 'medication_id is required' }, { status: 400 });
    }

    const result = await healthieGraphQL<any>(`
        mutation DeactivateMedication($input: updateMedicationInput!) {
            updateMedication(input: $input) {
                medication { id name active }
                messages { field message }
            }
        }
    `, { input: { id: medication_id, active: false, end_date: new Date().toISOString().split('T')[0] } });

    if (result.updateMedication?.messages?.length > 0) {
        const msg = result.updateMedication.messages.map((m: any) => m.message).join(', ');
        return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    console.log(`[iPad:PatientData] Deactivated medication ${medication_id}`);
    return NextResponse.json({
        success: true,
        data: result.updateMedication?.medication,
    });
}

// ==================== ADD DIAGNOSIS ====================
async function addDiagnosis(healthieId: string, body: any) {
    const { code, description } = body;

    if (!code || !description) {
        return NextResponse.json({ success: false, error: 'code and description are required' }, { status: 400 });
    }

    // FIX(2026-04-07): Resolve both IDs — Healthie ID for API calls, patient_id for local storage
    const resolvedHealthieId = await resolveHealthieId(healthieId);
    const patientId = await resolvePatientId(healthieId);

    // 1. Add diagnosis as a properly formatted Chart Note in Healthie
    try {
        const noteContent = `🏥 ACTIVE DIAGNOSIS\n\nICD-10 Code: ${code}\nDescription: ${description}\n\nAdded: ${new Date().toLocaleDateString('en-US')}\nStatus: Active`;

        const noteResult = await healthieGraphQL<any>(`
            mutation CreateNote($input: createNoteInput!) {
                createNote(input: $input) {
                    note {
                        id
                        content
                        created_at
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `, {
            input: {
                user_id: resolvedHealthieId,
                content: noteContent,
                include_in_charting: true,
            }
        });

        if (noteResult.createNote?.messages?.length > 0) {
            const errors = noteResult.createNote.messages.map((m: any) => m.message).join(', ');
            console.error(`[iPad:PatientData] Healthie diagnosis note failed: ${errors}`);
            return NextResponse.json({ success: false, error: errors }, { status: 400 });
        }

        const healthieNoteId = noteResult.createNote?.note?.id;
        console.log(`[iPad:PatientData] Diagnosis note created in Healthie: ${healthieNoteId}`);

        // 2. Also store in local scribe_notes for quick retrieval and display
        if (patientId) {
            await query(`
                INSERT INTO scribe_notes (
                    session_id,
                    patient_id,
                    visit_type,
                    soap_note,
                    icd10_codes,
                    created_at
                ) VALUES (
                    gen_random_uuid(),
                    $1,
                    'Manual Entry',
                    $2,
                    $3::jsonb,
                    NOW()
                )
            `, [
                patientId,
                `Manual Diagnosis Entry: ${code} — ${description}`,
                JSON.stringify([{ code, description }])
            ]);
            console.log(`[iPad:PatientData] Diagnosis also stored locally for patient ${patientId}`);
        }

        return NextResponse.json({
            success: true,
            message: 'Diagnosis added to patient chart in Healthie',
            healthie_note_id: healthieNoteId,
        });
    } catch (error) {
        console.error('[iPad:PatientData] Diagnosis add failed:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to add diagnosis'
        }, { status: 500 });
    }
}

// ==================== REMOVE DIAGNOSIS ====================
async function removeDiagnosis(healthieId: string, body: any) {
    const { code, description } = body;

    if (!code) {
        return NextResponse.json({ success: false, error: 'code is required' }, { status: 400 });
    }

    // FIX(2026-04-07): Use unified resolvers
    const resolvedHealthieId = await resolveHealthieId(healthieId);
    const patientId = await resolvePatientId(healthieId);

    try {
        // 1. Document the removal in Healthie via a journal entry
        const diagnosisText = description ? `${code} — ${description}` : code;
        let healthieNoteId: string | null = null;
        try {
            const entryResult = await healthieGraphQL<any>(`
                mutation CreateEntry($input: createEntryInput!) {
                    createEntry(input: $input) {
                        entry { id }
                        messages { field message }
                    }
                }
            `, {
                input: {
                    user_id: resolvedHealthieId,
                    type: 'JournalEntry',
                    category: 'Diagnosis Change',
                    description: `Diagnosis Removed: ${diagnosisText}`,
                    created_at: new Date().toISOString(),
                }
            });
            healthieNoteId = entryResult?.createEntry?.entry?.id || null;
            if (healthieNoteId) {
                console.log(`[iPad:PatientData] Diagnosis removal documented in Healthie entry: ${healthieNoteId}`);
            }
        } catch (healthieErr) {
            // Non-fatal — still proceed with local removal
            console.warn('[iPad:PatientData] Healthie documentation failed (non-fatal):', healthieErr instanceof Error ? healthieErr.message : healthieErr);
        }

        // 2. Also remove from local records
        if (patientId) {

            // Add to removed_diagnoses list on patient record
            // This filters the diagnosis from Working Diagnoses display without modifying scribe notes
            // (the diagnosis stays in the historical note for medical record integrity)
            await query(`
                UPDATE patients
                SET removed_diagnoses = COALESCE(removed_diagnoses, '[]'::jsonb) || $1::jsonb
                WHERE patient_id = $2
                  AND NOT (COALESCE(removed_diagnoses, '[]'::jsonb) @> $1::jsonb)
            `, [JSON.stringify([code]), patientId]);

            console.log(`[iPad:PatientData] Added "${code}" to removed_diagnoses for patient ${patientId}`);
        }

        return NextResponse.json({
            success: true,
            message: 'Diagnosis removal documented in Healthie',
            healthie_note_id: healthieNoteId,
        });
    } catch (error) {
        console.error('[iPad:PatientData] Diagnosis remove failed:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to remove diagnosis'
        }, { status: 500 });
    }
}

// ==================== CONFIRM DIAGNOSIS ====================
async function confirmDiagnosis(healthieId: string, body: any) {
    const { code, description, confirmed_by } = body;

    if (!code) {
        return NextResponse.json({ success: false, error: 'code is required' }, { status: 400 });
    }

    const patientId = await resolvePatientId(healthieId);
    if (!patientId) {
        return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    const confirmedAt = new Date().toISOString();
    const entry = { code, description: description || code, confirmed_by: confirmed_by || 'Provider', confirmed_at: confirmedAt };

    try {
        await query(`
            UPDATE patients
            SET confirmed_diagnoses = (
                SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                FROM jsonb_array_elements(COALESCE(confirmed_diagnoses, '[]'::jsonb)) elem
                WHERE elem->>'code' != $2
            ) || $3::jsonb,
            updated_at = NOW()
            WHERE patient_id = $1
        `, [patientId, code, JSON.stringify([entry])]);

        console.log(`[iPad:PatientData] Confirmed diagnosis ${code} for patient ${patientId} by ${entry.confirmed_by}`);

        return NextResponse.json({ success: true, confirmed: entry });
    } catch (error) {
        console.error('[iPad:PatientData] Confirm diagnosis failed:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to confirm diagnosis'
        }, { status: 500 });
    }
}

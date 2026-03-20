import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';
import { query } from '@/lib/db';

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
            case 'add_diagnosis':
                return await addDiagnosis(healthie_id, body);
            case 'remove_diagnosis':
                return await removeDiagnosis(healthie_id, body);
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
// FIX(2026-03-19): Healthie allergy API requires org-level category configuration
// which isn't set up. Store allergies locally with NKDA support.
async function addAllergy(healthieId: string, body: any) {
    const { name, severity, reaction, category, is_nkda, entered_by } = body;

    // Resolve patient_id from healthie_id
    const [patient] = await query<{ patient_id: string }>(
        `SELECT p.patient_id FROM patients p
         LEFT JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text AND hc.is_active = true
         WHERE hc.healthie_client_id = $1 OR p.healthie_client_id = $1 OR p.patient_id::text = $1
         LIMIT 1`,
        [healthieId]
    );
    const patientId = patient?.patient_id;
    if (!patientId) {
        return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // NKDA: mark patient as having no known allergies
    if (is_nkda) {
        // Remove any existing allergies and add NKDA marker
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

    const [allergy] = await query<any>(
        `INSERT INTO patient_allergies (patient_id, name, severity, reaction, category, status, entered_by, created_at)
         VALUES ($1, $2, $3, $4, $5, 'Active', $6, NOW())
         RETURNING *`,
        [patientId, name, severity || null, reaction || null, category || 'Drug', entered_by || 'Staff']
    );

    console.log(`[iPad:PatientData] Added allergy "${name}" for patient ${patientId} by ${entered_by}`);
    return NextResponse.json({ success: true, data: allergy });
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

// ==================== ADD DIAGNOSIS ====================
async function addDiagnosis(healthieId: string, body: any) {
    const { code, description } = body;

    if (!code || !description) {
        return NextResponse.json({ success: false, error: 'code and description are required' }, { status: 400 });
    }

    // 1. Add diagnosis as a properly formatted Chart Note in Healthie
    // Healthie doesn't have a separate "Problem List" API - diagnoses are stored as chart notes or attached to encounters
    // We'll create a prominently formatted note that will appear in the patient's chart
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
                user_id: healthieId,
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
        const patientRows = await query<any>(
            'SELECT patient_id FROM healthie_clients WHERE healthie_client_id = $1 AND is_active = true LIMIT 1',
            [healthieId]
        );

        if (patientRows && patientRows.length > 0) {
            const patientId = patientRows[0].patient_id;
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

    try {
        // 1. Create a note in Healthie documenting the removal
        const diagnosisText = description ? `${code} — ${description}` : code;
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
                user_id: healthieId,
                content: `❌ **Diagnosis Removed**: ${diagnosisText}`,
                include_in_charting: true,
            }
        });

        if (noteResult.createNote?.messages?.length > 0) {
            const errors = noteResult.createNote.messages.map((m: any) => m.message).join(', ');
            console.error(`[iPad:PatientData] Healthie removal note failed: ${errors}`);
        }

        const healthieNoteId = noteResult.createNote?.note?.id;
        console.log(`[iPad:PatientData] Diagnosis removal note created in Healthie: ${healthieNoteId}`);

        // 2. Also remove from local scribe_notes
        const patientRows = await query<any>(
            'SELECT patient_id FROM healthie_clients WHERE healthie_client_id = $1 AND is_active = true LIMIT 1',
            [healthieId]
        );

        if (patientRows && patientRows.length > 0) {
            const patientId = patientRows[0].patient_id;

            // Find scribe notes that contain this ICD-10 code
            const notes = await query<any>(`
                SELECT note_id, icd10_codes
                FROM scribe_notes
                WHERE patient_id = $1
                  AND icd10_codes @> $2::jsonb
                ORDER BY created_at DESC
                LIMIT 1
            `, [patientId, JSON.stringify([{ code }])]);

            if (!notes || notes.length === 0) {
                // Try lenient search
                const lenientNotes = await query<any>(`
                    SELECT note_id, icd10_codes
                    FROM scribe_notes
                    WHERE patient_id = $1
                      AND icd10_codes::text LIKE $2
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [patientId, `%${code}%`]);

                if (lenientNotes && lenientNotes.length > 0) {
                    const currentCodes = lenientNotes[0].icd10_codes;
                    const updatedCodes = currentCodes.filter((c: any) =>
                        (typeof c === 'string' ? c : c.code) !== code
                    );

                    await query(`
                        UPDATE scribe_notes
                        SET icd10_codes = $1::jsonb
                        WHERE note_id = $2
                    `, [JSON.stringify(updatedCodes), lenientNotes[0].note_id]);

                    console.log(`[iPad:PatientData] Removed diagnosis "${code}" from local note ${lenientNotes[0].note_id}`);
                }
            } else {
                const currentCodes = notes[0].icd10_codes;
                const updatedCodes = currentCodes.filter((c: any) =>
                    (typeof c === 'string' ? c : c.code) !== code
                );

                await query(`
                    UPDATE scribe_notes
                    SET icd10_codes = $1::jsonb
                    WHERE note_id = $2
                `, [JSON.stringify(updatedCodes), notes[0].note_id]);

                console.log(`[iPad:PatientData] Removed diagnosis "${code}" from local note ${notes[0].note_id}`);
            }
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

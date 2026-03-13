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
async function addAllergy(healthieId: string, body: any) {
    const { name, severity, reaction, category_type } = body;

    if (!name) {
        return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const result = await healthieGraphQL<any>(`
        mutation CreateAllergy($input: createAllergySensitivityInput!) {
            createAllergySensitivity(input: $input) {
                allergy_sensitivity {
                    id
                    name
                    severity
                    reaction
                    status
                    category_type
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
            severity: severity || '',
            reaction: reaction || '',
            category_type: category_type || 'Allergy',
            status: 'Active',
        }
    });

    if (result.createAllergySensitivity?.messages?.length > 0) {
        const msg = result.createAllergySensitivity.messages.map((m: any) => m.message).join(', ');
        return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    console.log(`[iPad:PatientData] Added allergy "${name}" for patient ${healthieId}`);
    return NextResponse.json({
        success: true,
        data: result.createAllergySensitivity?.allergy_sensitivity || {},
    });
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

    console.log(`[iPad:PatientData] Added medication "${name}" for patient ${healthieId}`);
    return NextResponse.json({
        success: true,
        data: result.createMedication?.medication || {},
    });
}

// ==================== ADD DIAGNOSIS ====================
async function addDiagnosis(healthieId: string, body: any) {
    const { code, description } = body;

    if (!code || !description) {
        return NextResponse.json({ success: false, error: 'code and description are required' }, { status: 400 });
    }

    // 1. Add diagnosis as a Chart Note in Healthie (visible in patient chart)
    try {
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
                content: `📋 **Diagnosis Added**: ${code} — ${description}`,
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

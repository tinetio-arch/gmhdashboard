import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

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
                allergySensitivity {
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
        data: result.createAllergySensitivity?.allergySensitivity || {},
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

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * GET /api/ipad/patient/[id]/metrics — returns recent metric entries
 * POST /api/ipad/patient/[id]/metrics — create new metric + sync to Healthie
 */

const HEALTHIE_METRIC_TYPES: Record<string, string> = {
    weight: 'Weight',
    blood_pressure_systolic: 'Blood Pressure - Systolic',
    blood_pressure_diastolic: 'Blood Pressure - Diastolic',
    heart_rate: 'Heart Rate',
    temperature: 'Temperature',
    oxygen_saturation: 'Oxygen Saturation',
    respiration_rate: 'Respiration Rate',
    bmi: 'BMI',
    waist_circumference: 'Waist Circumference',
    testosterone_level: 'Testosterone Level',
    hematocrit: 'Hematocrit',
    psa: 'PSA',
    hemoglobin: 'Hemoglobin',
};

// Auto-create table on first call (since CLI migration hangs on RDS SSL)
let tableCreated = false;
async function ensureTable() {
    if (tableCreated) return;
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS patient_metrics (
                metric_id SERIAL PRIMARY KEY,
                patient_id TEXT NOT NULL,
                metric_type TEXT NOT NULL,
                value TEXT NOT NULL,
                unit TEXT DEFAULT '',
                recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                recorded_by_email TEXT NOT NULL,
                notes TEXT DEFAULT '',
                healthie_entry_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `, []);
        tableCreated = true;
    } catch (e) {
        console.warn('[metrics] Table creation check:', e);
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        await requireApiUser(request, 'read');
        const patientId = params.id;
        await ensureTable();

        // query() returns rows directly from lib/db.ts
        const rows = await query(
            `SELECT metric_id, patient_id, metric_type, value, unit, recorded_at,
                    recorded_by_email, notes, healthie_entry_id
             FROM patient_metrics
             WHERE patient_id = $1
             ORDER BY recorded_at DESC
             LIMIT 50`,
            [patientId]
        );

        return NextResponse.json({
            metrics: rows,
            metric_types: Object.keys(HEALTHIE_METRIC_TYPES),
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/patient/metrics GET]', error);
        return NextResponse.json({ error: 'Failed to load metrics' }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const user = await requireApiUser(request, 'read');
        const patientId = params.id;
        const body = await request.json();
        await ensureTable();

        const {
            metric_type,
            value,
            unit,
            notes,
            blood_pressure_systolic,
            blood_pressure_diastolic,
        } = body;

        if (!metric_type || value === undefined || value === null || value === '') {
            return NextResponse.json({ error: 'metric_type and value are required' }, { status: 400 });
        }

        const recordedAt = new Date().toISOString();
        const displayValue = metric_type === 'blood_pressure'
            ? `${blood_pressure_systolic}/${blood_pressure_diastolic}`
            : String(value);

        // query() returns rows directly
        const insertRows = await query(
            `INSERT INTO patient_metrics (patient_id, metric_type, value, unit, recorded_at, recorded_by_email, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING metric_id`,
            [patientId, metric_type, displayValue, unit || '', recordedAt, user.email, notes || '']
        );

        const metricId = (insertRows as any[])[0]?.metric_id;

        // Try Healthie sync (don't fail if it doesn't work)
        let healthieEntryId: string | null = null;
        try {
            const patientRows = await query(
                `SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1`,
                [patientId]
            );
            let healthieClientId = (patientRows as any[])[0]?.healthie_client_id;

            // Fallback: if patient isn't in healthie_clients, check if patientId is itself a Healthie ID (numeric)
            if (!healthieClientId && /^\d+$/.test(patientId)) {
                healthieClientId = patientId;
                console.log(`[metrics] No healthie_clients mapping for ${patientId}, using as direct Healthie ID`);
            }

            if (healthieClientId) {
                const entryResult = await healthieGraphQL<{
                    createEntry: {
                        entry?: { id?: string } | null;
                        messages?: Array<{ field?: string; message?: string }> | null;
                    };
                }>(`
                    mutation CreateEntry($input: createEntryInput!) {
                        createEntry(input: $input) {
                            entry { id }
                            messages { field message }
                        }
                    }
                `, {
                    input: {
                        user_id: healthieClientId,
                        type: HEALTHIE_METRIC_TYPES[metric_type] || metric_type,
                        metric_stat: String(parseFloat(value) || 0),
                        category: 'Vital',
                        created_at: recordedAt,
                        description: notes || `${metric_type}: ${displayValue} ${unit || ''}`.trim(),
                    }
                });

                healthieEntryId = entryResult.createEntry?.entry?.id || null;

                if (healthieEntryId && metricId) {
                    await query(
                        `UPDATE patient_metrics SET healthie_entry_id = $1 WHERE metric_id = $2`,
                        [healthieEntryId, metricId]
                    );
                }
            }
        } catch (healthieError) {
            console.warn('[metrics] Healthie sync failed:', healthieError);
        }

        return NextResponse.json({
            success: true,
            metric_id: metricId,
            healthie_synced: !!healthieEntryId,
            healthie_entry_id: healthieEntryId,
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/patient/metrics POST]', error);
        return NextResponse.json({ error: 'Failed to save metric' }, { status: 500 });
    }
}

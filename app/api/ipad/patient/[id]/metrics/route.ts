import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { sendMessage } from '@/lib/telegram-client';

// FIX(2026-05-20): Healthie sync failures here were swallowed into the pm2 error
// log with no alert, so iPad metrics silently went stale (the audit found 198
// "[metrics] Healthie sync failed" lines today, zero notifications). We now
// surface the failure in the API response AND fire a throttled Telegram alert.
// Throttle is process-local (one PM2 worker) — enough to turn 198 silent failures
// into a visible signal without flooding Phil.
let lastHealthieMetricAlertAt = 0;
const HEALTHIE_METRIC_ALERT_THROTTLE_MS = 30 * 60 * 1000; // 30 min

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
        let healthieSyncError: string | null = null;
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
                // Special handling for blood pressure - needs to be a formatted string for Healthie
                let metricStatValue: string;
                if (metric_type === 'blood_pressure') {
                    // For BP, send the combined value like "120/80"
                    metricStatValue = displayValue; // Already formatted as "sys/dia"
                } else {
                    // For other metrics, ensure it's a string
                    metricStatValue = String(value).trim();
                }

                console.log(`[metrics] Creating Healthie entry: type="${HEALTHIE_METRIC_TYPES[metric_type]}", stat="${metricStatValue}", user=${healthieClientId}`);

                const entryResult = await healthieGraphQL<{
                    createEntry: {
                        entry?: { id?: string; created_at?: string } | null;
                        messages?: Array<{ field?: string; message?: string }> | null;
                    };
                }>(`
                    mutation CreateEntry($input: createEntryInput!) {
                        createEntry(input: $input) {
                            entry { id created_at }
                            messages { field message }
                        }
                    }
                `, {
                    input: {
                        user_id: String(healthieClientId),
                        // FIX(2026-05-28): `type` is Healthie's Entry STI discriminator
                        // and must be 'MetricEntry'. We were sending the metric NAME
                        // (e.g. 'Weight'), which made Healthie 500 with the opaque
                        // "Internal server error" that spammed Telegram. The human-
                        // readable metric name belongs in `category`. Matches the
                        // working createEntry in app/api/ipad/patient-data/route.ts.
                        // Verified live (broken shape 500s, this shape round-trips).
                        type: 'MetricEntry',
                        metric_stat: metricStatValue,
                        category: HEALTHIE_METRIC_TYPES[metric_type] || metric_type,
                        created_at: recordedAt,
                        description: notes ? `${notes} (by ${user.email})` : `Recorded by ${user.email}`,
                    }
                });

                if (entryResult.createEntry?.messages && entryResult.createEntry.messages.length > 0) {
                    console.warn('[metrics] Healthie validation errors:', entryResult.createEntry.messages);
                }

                healthieEntryId = entryResult.createEntry?.entry?.id || null;
                console.log(`[metrics] Healthie entry created: ${healthieEntryId || 'FAILED'}`);

                if (healthieEntryId && metricId) {
                    await query(
                        `UPDATE patient_metrics SET healthie_entry_id = $1 WHERE metric_id = $2`,
                        [healthieEntryId, metricId]
                    );
                }
            }
        } catch (healthieError) {
            // FIX(2026-05-20): was console.warn + swallow — surfaced to nobody.
            // Escalate to error, record the message for the response, and fire a
            // throttled alert so a Healthie outage is visible, not silent.
            healthieSyncError = healthieError instanceof Error ? healthieError.message : String(healthieError);
            console.error('[metrics] Healthie sync failed (metric SAVED locally, NOT synced to Healthie):', healthieSyncError);

            const now = Date.now();
            if (now - lastHealthieMetricAlertAt > HEALTHIE_METRIC_ALERT_THROTTLE_MS) {
                lastHealthieMetricAlertAt = now;
                const chatId = process.env.TELEGRAM_CHAT_ID;
                if (chatId) {
                    sendMessage(
                        chatId,
                        `⚠️ *iPad metric → Healthie sync failing*\n` +
                            `Patient \`${patientId}\` metric (${metric_type}) saved locally but NOT synced to Healthie.\n` +
                            `Error: ${healthieSyncError}\n` +
                            `_(throttled: max 1 alert / 30 min — check pm2 logs for the full count)_`,
                        { parseMode: 'Markdown' }
                    ).catch((e) => console.error('[metrics] failed to send Healthie-sync alert:', e));
                } else {
                    console.error('[metrics] TELEGRAM_CHAT_ID not configured — cannot alert on Healthie sync failure');
                }
            }
        }

        return NextResponse.json({
            success: true,
            metric_id: metricId,
            healthie_synced: !!healthieEntryId,
            healthie_entry_id: healthieEntryId,
            // FIX(2026-05-20): surface the sync failure so the iPad can show a
            // "saved locally, not synced" indicator instead of looking fully fresh.
            healthie_error: healthieSyncError,
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/patient/metrics POST]', error);
        return NextResponse.json({ error: 'Failed to save metric' }, { status: 500 });
    }
}

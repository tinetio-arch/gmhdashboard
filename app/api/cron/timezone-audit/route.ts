import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';
const TARGET_TZ = 'America/Phoenix';

function verifyCronSecret(request: NextRequest): boolean {
    const cronSecret = request.headers.get('x-cron-secret');
    return cronSecret === process.env.CRON_SECRET;
}

async function healthieGraphQL(query: string, variables: Record<string, any> = {}) {
    const resp = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
            'AuthorizationSource': 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
    } as any);
    const data = await resp.json();
    if (data.errors) throw new Error(data.errors[0]?.message || 'Healthie error');
    return data.data;
}

type DriftRow = { healthie_id: string; name: string; old_tz: string | null; new_tz?: string; fixed: boolean; error?: string };

export async function GET(request: NextRequest) {
    if (!verifyCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = new Date();

    // Only patients in our dashboard (active, with Healthie ID)
    const patients = await query<{ healthie_id: string; full_name: string }>(`
        SELECT healthie_client_id AS healthie_id, full_name
        FROM patients
        WHERE healthie_client_id IS NOT NULL
          AND (status_key IS NULL OR status_key NOT IN ('inactive','revoked','suspended'))
        ORDER BY healthie_client_id
    `);

    let checked = 0;
    let already_correct = 0;
    let drifted = 0;
    let fixed = 0;
    let errors = 0;
    const driftRows: DriftRow[] = [];

    for (const p of patients) {
        checked++;
        try {
            const data = await healthieGraphQL(
                `query($id: ID) { user(id: $id) { id timezone active } }`,
                { id: p.healthie_id }
            );
            const user = data?.user;
            if (!user) continue;

            const currentTz = user.timezone || null;
            if (currentTz === TARGET_TZ) {
                already_correct++;
                continue;
            }

            drifted++;
            try {
                const upd = await healthieGraphQL(
                    `mutation($input: updateClientInput!) {
                        updateClient(input: $input) {
                            user { id timezone }
                            messages { field message }
                        }
                    }`,
                    { input: { id: p.healthie_id, timezone: TARGET_TZ } }
                );
                const newTz = upd?.updateClient?.user?.timezone;
                const msgs = upd?.updateClient?.messages;
                if (newTz === TARGET_TZ && (!msgs || msgs.length === 0)) {
                    fixed++;
                    driftRows.push({ healthie_id: p.healthie_id, name: p.full_name, old_tz: currentTz, new_tz: newTz, fixed: true });
                } else {
                    errors++;
                    driftRows.push({ healthie_id: p.healthie_id, name: p.full_name, old_tz: currentTz, fixed: false, error: JSON.stringify(msgs) });
                }
            } catch (e: any) {
                errors++;
                driftRows.push({ healthie_id: p.healthie_id, name: p.full_name, old_tz: currentTz, fixed: false, error: e.message });
            }
        } catch (e: any) {
            errors++;
            console.error(`[TZ Audit] Error checking ${p.healthie_id}:`, e.message);
        }
    }

    const durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);

    // Log summary to agent_action_log (CEO dashboard "Agent Activity" feed)
    try {
        const summary = drifted === 0
            ? `Checked ${checked} patients — all timezones correct (${already_correct} Phoenix).`
            : `Fixed ${fixed}/${drifted} drifted timezones (${errors} errors). Checked ${checked}, ${already_correct} already correct.`;
        await query(
            `INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status)
             VALUES ($1, 'audit_corrected', 'patient_access', $2, $3::jsonb, $4)`,
            [
                'timezone_audit',
                summary,
                JSON.stringify({ checked, already_correct, drifted, fixed, errors, duration_sec: durationSec, drift_rows: driftRows.slice(0, 50) }),
                errors > 0 ? 'needs_decision' : 'completed',
            ]
        );
    } catch (logErr) {
        console.error('[TZ Audit] agent_action_log insert failed:', logErr);
    }

    return NextResponse.json({
        success: true,
        checked,
        already_correct,
        drifted,
        fixed,
        errors,
        duration_sec: durationSec,
        drift_sample: driftRows.slice(0, 20),
    });
}

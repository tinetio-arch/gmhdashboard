import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendMessage } from '@/lib/telegram-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

function verifyCronSecret(request: NextRequest): boolean {
    const cronSecret = request.headers.get('x-cron-secret');
    return cronSecret === process.env.CRON_SECRET;
}

async function checkHealthieUser(healthieId: string): Promise<{ valid: boolean; name?: string }> {
    try {
        const resp = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `query { user(id: "${healthieId}") { id first_name last_name } }`,
            }),
            cache: 'no-store',
        } as any);
        const data = await resp.json();
        const user = data?.data?.user;
        if (user) {
            const first = (user.first_name || '').trim();
            const last = (user.last_name || '').trim();
            // Healthie sometimes stores "First Last" in first_name — deduplicate
            let fullName: string;
            if (first.toLowerCase().endsWith(last.toLowerCase()) && first.length > last.length) {
                fullName = first; // first_name already contains full name
            } else {
                fullName = `${first} ${last}`.trim();
            }
            return { valid: true, name: fullName };
        }
        return { valid: false };
    } catch {
        return { valid: false };
    }
}

/**
 * GET /api/cron/healthie-id-audit
 *
 * Daily audit that:
 * 1. Finds mismatches between patients.healthie_client_id and healthie_clients.healthie_client_id
 * 2. Finds patients whose Healthie ID is dead (deleted/merged in Healthie)
 * 3. Auto-fixes mismatches by validating against the live Healthie API
 * 4. Sends Telegram alert with summary
 */
export async function GET(request: NextRequest) {
    if (!verifyCronSecret(request)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    const fixes: { name: string; oldId: string; newId: string; source: string }[] = [];
    const deadIds: { name: string; patientId: string; healthieId: string }[] = [];
    const nameUpdates: { name: string; oldName: string; healthieName: string }[] = [];
    let checked = 0;

    try {
        // ─── PHASE 1: Fix mismatches between patients and healthie_clients ───
        const mismatches = await query<any>(`
            SELECT p.patient_id, p.full_name, p.healthie_client_id as p_hid, hc.healthie_client_id as hc_hid
            FROM patients p
            LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id AND hc.is_active = true
            WHERE p.healthie_client_id IS NOT NULL AND p.healthie_client_id != ''
              AND hc.healthie_client_id IS NOT NULL
              AND p.healthie_client_id != hc.healthie_client_id
        `);

        for (const row of mismatches) {
            const pCheck = await checkHealthieUser(row.p_hid);
            const hcCheck = await checkHealthieUser(row.hc_hid);

            let correctId: string | null = null;
            let source = '';

            if (pCheck.valid && !hcCheck.valid) {
                correctId = row.p_hid;
                source = 'patients (healthie_clients was dead)';
            } else if (!pCheck.valid && hcCheck.valid) {
                correctId = row.hc_hid;
                source = 'healthie_clients (patients was dead)';
            } else if (pCheck.valid && hcCheck.valid) {
                // Both valid — use patients table as canonical
                correctId = row.p_hid;
                source = 'patients (both valid, using canonical)';
            }
            // If both dead, we can't auto-fix

            if (correctId) {
                await query('UPDATE patients SET healthie_client_id = $1 WHERE patient_id = $2', [correctId, row.patient_id]);
                await query(
                    'UPDATE healthie_clients SET healthie_client_id = $1, updated_at = NOW() WHERE patient_id = $2::text AND is_active = true',
                    [correctId, row.patient_id]
                );
                fixes.push({
                    name: row.full_name,
                    oldId: correctId === row.p_hid ? row.hc_hid : row.p_hid,
                    newId: correctId,
                    source,
                });
            } else {
                deadIds.push({ name: row.full_name, patientId: row.patient_id, healthieId: row.p_hid });
            }

            // Rate limit: ~4 req/sec (2 checks per patient)
            await new Promise(r => setTimeout(r, 100));
        }

        // ─── PHASE 2: Spot-check active patients for dead Healthie IDs ───
        // Sample up to 50 random active patients per run to detect dead IDs over time
        const samplePatients = await query<any>(`
            SELECT p.patient_id, p.full_name, p.healthie_client_id
            FROM patients p
            WHERE p.healthie_client_id IS NOT NULL AND p.healthie_client_id != ''
              AND (p.status_key IS NULL OR p.status_key NOT IN ('inactive'))
            ORDER BY RANDOM()
            LIMIT 50
        `);

        for (const p of samplePatients) {
            const check = await checkHealthieUser(p.healthie_client_id);
            checked++;
            if (!check.valid) {
                deadIds.push({ name: p.full_name, patientId: p.patient_id, healthieId: p.healthie_client_id });
            } else if (check.name) {
                // Check if name drifted — Healthie is source of truth
                const healthieName = check.name.trim();
                const localName = (p.full_name || '').trim();
                if (healthieName && localName && healthieName.toLowerCase() !== localName.toLowerCase()) {
                    // Safety check: if the last name changed completely, this might be a wrong ID mapping
                    // Only auto-sync if last names match (or one is a substring of the other)
                    const localLast = localName.split(' ').slice(-1)[0].toLowerCase();
                    const healthieLast = healthieName.split(' ').slice(-1)[0].toLowerCase();
                    const lastNameMatch = localLast === healthieLast
                        || localLast.includes(healthieLast) || healthieLast.includes(localLast);

                    // Data quality checks before syncing
                    const hasSpecialChars = /[`~<>{}[\]|\\]/.test(healthieName);
                    const isAllLower = healthieName === healthieName.toLowerCase() && localName !== localName.toLowerCase();
                    const isShorterThan3 = healthieName.length < 3;

                    if (lastNameMatch && !hasSpecialChars && !isAllLower && !isShorterThan3) {
                        await query('UPDATE patients SET full_name = $1 WHERE patient_id = $2', [healthieName, p.patient_id]);
                        nameUpdates.push({ name: localName, oldName: localName, healthieName });
                    } else {
                        // Last name mismatch — possible wrong Healthie ID mapping, flag for review
                        deadIds.push({
                            name: `${localName} (Healthie says: ${healthieName})`,
                            patientId: p.patient_id,
                            healthieId: p.healthie_client_id,
                        });
                    }
                }
            }
            await new Promise(r => setTimeout(r, 220));
        }

        // ─── PHASE 3: Send Telegram summary ───
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const hasIssues = fixes.length > 0 || deadIds.length > 0 || nameUpdates.length > 0;

        if (hasIssues) {
            const chatId = process.env.TELEGRAM_CHAT_ID;
            if (chatId) {
                let msg = `🔍 *Healthie ID Audit* (${elapsed}s)\n\n`;

                if (fixes.length > 0) {
                    msg += `✅ *${fixes.length} ID Mismatches Fixed:*\n`;
                    for (const f of fixes.slice(0, 10)) {
                        msg += `  • ${f.name}: ${f.oldId} → ${f.newId}\n`;
                    }
                    if (fixes.length > 10) msg += `  _...and ${fixes.length - 10} more_\n`;
                    msg += '\n';
                }

                if (nameUpdates.length > 0) {
                    msg += `📝 *${nameUpdates.length} Names Synced from Healthie:*\n`;
                    for (const n of nameUpdates.slice(0, 10)) {
                        msg += `  • "${n.oldName}" → "${n.healthieName}"\n`;
                    }
                    if (nameUpdates.length > 10) msg += `  _...and ${nameUpdates.length - 10} more_\n`;
                    msg += '\n';
                }

                if (deadIds.length > 0) {
                    msg += `⚠️ *${deadIds.length} Dead Healthie IDs (manual review needed):*\n`;
                    for (const d of deadIds.slice(0, 10)) {
                        msg += `  • ${d.name} (ID: ${d.healthieId})\n`;
                    }
                    if (deadIds.length > 10) msg += `  _...and ${deadIds.length - 10} more_\n`;
                }

                await sendMessage(chatId, msg, { parseMode: 'Markdown' });
            }
        }

        console.log(`[HealthieAudit] Done in ${elapsed}s: ${fixes.length} fixes, ${nameUpdates.length} name syncs, ${deadIds.length} dead IDs, ${checked} spot-checked`);

        return NextResponse.json({
            success: true,
            data: {
                mismatches_found: mismatches.length,
                fixes_applied: fixes.length,
                names_synced: nameUpdates.length,
                dead_ids: deadIds.length,
                spot_checked: checked,
                elapsed_ms: Date.now() - startTime,
                fixes,
                nameUpdates,
                deadIds,
            },
        });
    } catch (error) {
        console.error('[HealthieAudit] Error:', error);
        return NextResponse.json({ success: false, error: 'Audit failed' }, { status: 500 });
    }
}

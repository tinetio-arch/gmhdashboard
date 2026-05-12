/**
 * Phase 1 — three safe, reversible updates:
 *   1. Re-link Bruce French from placeholder-email Healthie ID (12765861)
 *      to real-email Healthie ID (12745786).
 *   2. Mark all healthie_clients rows that point at non-active Healthie IDs
 *      as is_active=false (covers Category C and H together).
 *   3. Write a merge-worksheet markdown file listing the 12 name+DOB duplicates
 *      with a recommended ID to keep (real-email, most recent, with more data).
 *
 * ALL DATA PRESERVED: nothing is deleted. To reverse step 2, flip is_active=true.
 * Bruce's original link row is left in place with is_active=false — preserves history.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { query, getPool } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import * as fs from 'fs';

const WORKSHEET = '/home/ec2-user/gmhdashboard/.tmp/healthie-merge-worksheet.md';
const LOG = '/home/ec2-user/gmhdashboard/.tmp/phase1-log.txt';
const logs: string[] = [];
const log = (s: string) => { console.log(s); logs.push(s); };

const BRUCE_PG_ID = '5d0bdecf-ca25-409a-a8e4-e0480f947e84';
const BRUCE_OLD_HID = '12765861'; // placeholder-email
const BRUCE_NEW_HID = '12745786'; // real-email

(async () => {
    log(`\n=== Phase 1 — ${new Date().toISOString()} ===\n`);

    // --- Get a fresh snapshot of active Healthie IDs (single API call) ---
    const h = await healthieGraphQL<any>(`{ users(active_status:"active", should_paginate:false, page_size:10000){ id first_name last_name email dob phone_number } }`, {});
    const healthieActive: any[] = h?.users || [];
    const activeIds = new Set(healthieActive.map(u => String(u.id)));
    log(`Fetched ${activeIds.size} active Healthie IDs (1 API call).`);

    const pool = getPool();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // --- Step 1: Re-link Bruce French ---
        log(`\n--- Step 1: Re-link Bruce French ---`);
        const bruceBefore = await client.query(
            `SELECT p.patient_id, p.full_name, p.email, p.healthie_client_id AS patients_hid,
                    (SELECT json_agg(row_to_json(hc)) FROM healthie_clients hc WHERE hc.patient_id = p.patient_id::text) AS links
             FROM patients p WHERE p.patient_id = $1`,
            [BRUCE_PG_ID]
        );
        log(`BEFORE: ${JSON.stringify(bruceBefore.rows[0], null, 2)}`);

        // Guard: target Healthie ID must be active
        if (!activeIds.has(BRUCE_NEW_HID)) {
            throw new Error(`Refusing to relink Bruce: target Healthie ID ${BRUCE_NEW_HID} is not in active roster`);
        }
        // Guard: target Healthie ID must not already be linked to someone else
        const targetClash = await client.query(
            `SELECT patient_id FROM healthie_clients WHERE healthie_client_id = $1 AND patient_id != $2`,
            [BRUCE_NEW_HID, BRUCE_PG_ID]
        );
        if (targetClash.rows.length > 0) {
            throw new Error(`Refusing to relink Bruce: target ${BRUCE_NEW_HID} already linked to another patient`);
        }

        // Deactivate Bruce's old placeholder link
        await client.query(
            `UPDATE healthie_clients SET is_active = false, updated_at = NOW()
             WHERE patient_id = $1 AND healthie_client_id = $2`,
            [BRUCE_PG_ID, BRUCE_OLD_HID]
        );
        // Upsert new active link
        await client.query(
            `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
             VALUES ($1, $2, true, 'audit_relink_real_email')
             ON CONFLICT (healthie_client_id) DO UPDATE SET patient_id = EXCLUDED.patient_id, is_active = true, updated_at = NOW()`,
            [BRUCE_PG_ID, BRUCE_NEW_HID]
        );
        // Update patients.healthie_client_id + pull fresh email from Healthie
        const bruceHealthie = healthieActive.find(u => String(u.id) === BRUCE_NEW_HID);
        await client.query(
            `UPDATE patients SET healthie_client_id = $1,
                                 email = COALESCE($2, email),
                                 updated_at = NOW()
             WHERE patient_id = $3`,
            [BRUCE_NEW_HID, bruceHealthie?.email || null, BRUCE_PG_ID]
        );
        const bruceAfter = await client.query(
            `SELECT p.patient_id, p.full_name, p.email, p.healthie_client_id AS patients_hid,
                    (SELECT json_agg(row_to_json(hc)) FROM healthie_clients hc WHERE hc.patient_id = p.patient_id::text) AS links
             FROM patients p WHERE p.patient_id = $1`,
            [BRUCE_PG_ID]
        );
        log(`AFTER:  ${JSON.stringify(bruceAfter.rows[0], null, 2)}`);

        // --- Step 2: Mark stale healthie_clients as is_active=false ---
        log(`\n--- Step 2: Deactivate stale healthie_clients links (C + H) ---`);
        const staleBefore = await client.query(
            `SELECT healthie_client_id, patient_id FROM healthie_clients WHERE is_active = true AND healthie_client_id IS NOT NULL`
        );
        const toDeactivate = staleBefore.rows.filter(r => !activeIds.has(String(r.healthie_client_id)));
        log(`Active healthie_clients rows: ${staleBefore.rows.length}`);
        log(`Pointing at non-active Healthie IDs: ${toDeactivate.length}`);

        if (toDeactivate.length > 0) {
            const ids = toDeactivate.map(r => r.healthie_client_id);
            const res = await client.query(
                `UPDATE healthie_clients SET is_active = false, updated_at = NOW()
                 WHERE healthie_client_id = ANY($1::text[]) AND is_active = true
                 RETURNING healthie_client_id, patient_id`,
                [ids]
            );
            log(`Deactivated: ${res.rowCount} rows`);
            log(`Sample IDs deactivated: ${res.rows.slice(0, 10).map(r => r.healthie_client_id).join(', ')}${res.rows.length > 10 ? ` ... +${res.rows.length - 10} more` : ''}`);
        }

        await client.query('COMMIT');
        log(`\n✅ Transaction committed.`);
    } catch (e: any) {
        await client.query('ROLLBACK');
        log(`\n❌ Rolled back: ${e.message}`);
        throw e;
    } finally {
        client.release();
    }

    // --- Step 3: Write merge worksheet for the 12 name+DOB Healthie duplicates (read-only) ---
    log(`\n--- Step 3: Generate Healthie merge worksheet ---`);
    const byNameDob = new Map<string, any[]>();
    const normName = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, ' ') : '');
    const isPlaceholder = (e: any) => /@gethealthie\.com$/i.test(e || '');
    for (const u of healthieActive) {
        const nm = normName([u.first_name, u.last_name].filter(Boolean).join(' '));
        if (nm && u.dob) {
            const k = `${nm}|${u.dob}`;
            if (!byNameDob.has(k)) byNameDob.set(k, []);
            byNameDob.get(k)!.push(u);
        }
    }
    const dupes = Array.from(byNameDob.entries()).filter(([_, arr]) => arr.length > 1);
    log(`Found ${dupes.length} name+DOB duplicates in Healthie`);

    // For each pair, pick a recommended KEEP (real-email, has phone, more recently created)
    const ws: string[] = [];
    ws.push('# Healthie User Merge Worksheet');
    ws.push(`Generated: ${new Date().toISOString()}`);
    ws.push('');
    ws.push('Each row is a pair of Healthie users that look like the same person (matching name + DOB).');
    ws.push('**Recommended action:** In Healthie admin → Users → find → Merge. Keep the `→ keep` ID. Merge the other into it. Healthie will preserve chart history from both.');
    ws.push('');
    ws.push('Our side will auto-update via the webhook once you merge — no action needed from us.');
    ws.push('');
    ws.push('| # | Name | DOB | ID A | Email A | ID B | Email B | Recommendation |');
    ws.push('|---|---|---|---|---|---|---|---|');
    dupes.forEach(([k, arr], idx) => {
        const [nm, dob] = k.split('|');
        const a = arr[0], b = arr[1];
        // Prefer real email > placeholder
        const aPlaceholder = isPlaceholder(a.email);
        const bPlaceholder = isPlaceholder(b.email);
        let keep: any = a, drop: any = b;
        if (aPlaceholder && !bPlaceholder) { keep = b; drop = a; }
        else if (!aPlaceholder && bPlaceholder) { keep = a; drop = b; }
        else {
            // Both same flavor — keep the newer-looking one (higher ID usually = newer)
            if (Number(b.id) > Number(a.id)) { keep = b; drop = a; }
        }
        const rec = `**→ keep ${keep.id}** ${aPlaceholder !== bPlaceholder ? '(real email)' : '(newer)'}, merge ${drop.id} into it`;
        const title = [a.first_name, a.last_name].filter(Boolean).join(' ');
        ws.push(`| ${idx + 1} | ${title} | ${dob} | ${a.id}${aPlaceholder ? ' _(placeholder)_' : ''} | ${a.email || ''} | ${b.id}${bPlaceholder ? ' _(placeholder)_' : ''} | ${b.email || ''} | ${rec} |`);
    });
    fs.writeFileSync(WORKSHEET, ws.join('\n'));
    log(`Worksheet written to ${WORKSHEET}`);

    fs.writeFileSync(LOG, logs.join('\n'));
    log(`\nFull log: ${LOG}`);

    // Final verification
    log(`\n--- VERIFICATION ---`);
    const activeHCCount = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM healthie_clients WHERE is_active = true`);
    log(`Active healthie_clients rows remaining: ${activeHCCount[0].c}`);
    const bruceCheck = await query<any>(`SELECT healthie_client_id, is_active FROM healthie_clients WHERE patient_id = $1 ORDER BY is_active DESC`, [BRUCE_PG_ID]);
    log(`Bruce's links: ${JSON.stringify(bruceCheck)}`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

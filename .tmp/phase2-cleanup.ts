/**
 * Phase 2 — safe reversible cleanups:
 *   a. Billing audit on 10 Healthie dupe pairs (read-only, informs worksheet)
 *   b. Deactivate fake John Jones (Healthie 14408179 — philschafer7@gmail.com)
 *   c. Deactivate both Alana Morrison records (no-call-no-show)
 *   d. Re-link Joe Hugill in Postgres to real-email Healthie ID (same as Bruce)
 *   e. (No auto-merges for the 8 other pairs — worksheet only)
 *   f. Fix 3 real data conflicts (Joe Karcie DOB, Chris Manning email, Jeff Hall email)
 *   g. Normalize ~50 phone-format conflicts in Postgres to match Healthie (E.164ish)
 *
 * SAFETY:
 *   - Healthie deactivations use updateClient(active:false) — archive, NOT delete.
 *   - Every PG change is in a transaction with before/after logging.
 *   - Zero merges — user verifies the 8 pairs separately.
 *   - Phone normalization only touches rows already in the Category F conflict set.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { query, getPool } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import * as fs from 'fs';

const WORKSHEET = '/home/ec2-user/gmhdashboard/.tmp/healthie-merge-worksheet-with-billing.md';
const LOG = '/home/ec2-user/gmhdashboard/.tmp/phase2-log.txt';
const logs: string[] = [];
const log = (s: string) => { console.log(s); logs.push(s); };

// Dupe pairs (from audit). Skipping John Jones + Alana (handled separately).
// Order: [nameLabel, idA, idB]. Our worksheet said "keep B (newer)" for all except Bruce+Joe (real email wins).
const DUPES = [
    { name: 'Steve Benjamin',    a: '12182852', b: '12743724' },
    { name: 'Jeffrey Chamblee',  a: '12177838', b: '12746108' },
    { name: 'Matthew Fisher',    a: '12179965', b: '12745295' },
    { name: 'Rich Freeman',      a: '12183013', b: '12745768' },
    { name: 'Bruce French',      a: '12745786', b: '12765861' },     // already re-linked in Phase 1
    { name: 'Joe Hugill',        a: '12690358', b: '12875775' },     // to re-link in Phase 2d
    { name: 'Michael McCartney', a: '12182822', b: '12742218' },
    { name: 'Marianna Warner',   a: '12742313', b: '14050273' },
    { name: 'John Winn',         a: '12182229', b: '12743211' },
    { name: 'James Womble',      a: '12179578', b: '12743400' },
];

const JOHN_JONES_FAKE_HID = '14408179';
const ALANA_HIDS = ['12744305', '15192295'];

// Canonicalize phone: keep digits only; if 10 digits, prepend 1
function canonPhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 10) return '1' + d;
    if (d.length === 11 && d.startsWith('1')) return d;
    if (d.length === 7) return null; // too short
    return d; // unknown format — pass through digits
}

(async () => {
    log(`\n=== Phase 2 — ${new Date().toISOString()} ===`);

    // ─── Stage a: Billing audit on 10 dupe pairs ──────────────────────────────
    log(`\n--- Stage a: Healthie billing audit on 10 pairs ---`);
    const billingByHid = new Map<string, { appts: number; billing: number }>();
    const BATCH_SIZE = 5; // pairs per GraphQL call (aliased)
    for (let i = 0; i < DUPES.length; i += BATCH_SIZE) {
        const chunk = DUPES.slice(i, i + BATCH_SIZE);
        const aliases: string[] = [];
        chunk.forEach((p, idx) => {
            aliases.push(
                `a${i + idx}_appts: appointments(filter:"all", user_id:"${p.a}", should_paginate:false){ id }`,
                `a${i + idx}_bill: billingItems(filter:{}, client_id:"${p.a}"){ id }`,
                `b${i + idx}_appts: appointments(filter:"all", user_id:"${p.b}", should_paginate:false){ id }`,
                `b${i + idx}_bill: billingItems(filter:{}, client_id:"${p.b}"){ id }`,
            );
        });
        try {
            const q = `{ ${aliases.join(' ')} }`;
            const res = await healthieGraphQL<any>(q, {});
            chunk.forEach((p, idx) => {
                billingByHid.set(p.a, { appts: (res[`a${i + idx}_appts`] || []).length, billing: (res[`a${i + idx}_bill`] || []).length });
                billingByHid.set(p.b, { appts: (res[`b${i + idx}_appts`] || []).length, billing: (res[`b${i + idx}_bill`] || []).length });
            });
        } catch (e: any) {
            log(`  Billing audit batch failed: ${e.message} — skipping this batch`);
        }
        await new Promise(r => setTimeout(r, 300));
    }
    for (const d of DUPES) {
        const A = billingByHid.get(d.a) || { appts: 0, billing: 0 };
        const B = billingByHid.get(d.b) || { appts: 0, billing: 0 };
        log(`  ${d.name}: ${d.a} → appts=${A.appts} bill=${A.billing}  |  ${d.b} → appts=${B.appts} bill=${B.billing}`);
    }

    const pool = getPool();

    // ─── Stage b: Deactivate fake John Jones ──────────────────────────────────
    log(`\n--- Stage b: Deactivate fake John Jones (Healthie ${JOHN_JONES_FAKE_HID}) ---`);
    try {
        const res = await healthieGraphQL<any>(
            `mutation Deactivate($id: ID){ updateClient(input:{id:$id, active:false}){ user{ id active } messages{ field message } } }`,
            { id: JOHN_JONES_FAKE_HID }
        );
        const msgs = res?.updateClient?.messages || [];
        if (msgs.length) log(`  Messages: ${JSON.stringify(msgs)}`);
        log(`  Result: user ${res?.updateClient?.user?.id} active=${res?.updateClient?.user?.active}`);
    } catch (e: any) {
        log(`  ❌ Failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // ─── Stage c: Deactivate both Alana Morrison records ──────────────────────
    log(`\n--- Stage c: Deactivate Alana Morrison (both) ---`);
    for (const hid of ALANA_HIDS) {
        try {
            const res = await healthieGraphQL<any>(
                `mutation Deactivate($id: ID){ updateClient(input:{id:$id, active:false}){ user{ id active } messages{ field message } } }`,
                { id: hid }
            );
            const msgs = res?.updateClient?.messages || [];
            log(`  ${hid}: active=${res?.updateClient?.user?.active}${msgs.length ? ' messages=' + JSON.stringify(msgs) : ''}`);
        } catch (e: any) {
            log(`  ❌ ${hid} failed: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    // ─── Stage d: Re-link Joe Hugill in Postgres ──────────────────────────────
    log(`\n--- Stage d: Re-link Joe Hugill in Postgres ---`);
    const [joe] = await query<any>(
        `SELECT p.patient_id, p.full_name, p.email, p.healthie_client_id
         FROM patients p WHERE p.full_name ILIKE '%joe%hugill%' OR p.full_name ILIKE '%joseph%hugill%' LIMIT 1`
    );
    if (!joe) log(`  Joe Hugill not found in patients table — skipping`);
    else {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            log(`  BEFORE: patient_id=${joe.patient_id.slice(0,8)}.. email=${joe.email} linked=${joe.healthie_client_id}`);
            // Deactivate current link if different
            await client.query(
                `UPDATE healthie_clients SET is_active=false, updated_at=NOW()
                 WHERE patient_id=$1 AND healthie_client_id='12875775' AND is_active=true`,
                [joe.patient_id]
            );
            await client.query(
                `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                 VALUES ($1, '12690358', true, 'audit_relink_real_email')
                 ON CONFLICT (healthie_client_id) DO UPDATE SET patient_id=EXCLUDED.patient_id, is_active=true, updated_at=NOW()`,
                [joe.patient_id]
            );
            const hUser = await healthieGraphQL<any>(`query($id:ID){ user(id:$id){ email phone_number } }`, { id: '12690358' });
            await client.query(
                `UPDATE patients SET healthie_client_id='12690358',
                        email=COALESCE($2, email),
                        phone_primary=COALESCE($3, phone_primary),
                        updated_at=NOW()
                 WHERE patient_id=$1`,
                [joe.patient_id, hUser?.user?.email || null, hUser?.user?.phone_number || null]
            );
            await client.query('COMMIT');
            const after = await query<any>(
                `SELECT healthie_client_id, email, phone_primary FROM patients WHERE patient_id=$1`,
                [joe.patient_id]
            );
            log(`  AFTER: ${JSON.stringify(after[0])}`);
        } catch (e: any) {
            await client.query('ROLLBACK');
            log(`  ❌ Rolled back: ${e.message}`);
        } finally {
            client.release();
        }
    }

    // ─── Stage f: Fix Joe Karcie DOB, Chris Manning email, Jeff Hall email ────
    log(`\n--- Stage f: 3 real data conflicts ---`);
    const pgForStage = await pool.connect();
    try {
        await pgForStage.query('BEGIN');
        const fix = async (criteria: string, field: string, newVal: any, reason: string) => {
            const [row] = await query<any>(`SELECT patient_id, full_name, ${field} AS current FROM patients WHERE ${criteria} LIMIT 1`);
            if (!row) { log(`  ${reason}: patient not found — skipping`); return; }
            log(`  ${reason}: ${row.full_name} (${row.patient_id.slice(0,8)}..) ${field}="${row.current}" → "${newVal}"`);
            await pgForStage.query(`UPDATE patients SET ${field}=$1, updated_at=NOW() WHERE patient_id=$2`, [newVal, row.patient_id]);
        };
        await fix(`full_name ILIKE '%joe%karcie%' OR full_name ILIKE '%joseph%karcie%'`, 'dob', '1978-08-02', 'Joe Karcie DOB');
        await fix(`full_name ILIKE '%chris%manning%' OR full_name ILIKE '%christopher%manning%'`, 'email', 'chris5191973@icloud.com', 'Chris Manning email');
        await fix(`full_name ILIKE '%jeff%hall%' OR full_name ILIKE '%jeffrey%hall%'`, 'email', 'ontargetjeff@protonmail.com', 'Jeff Hall email');
        await pgForStage.query('COMMIT');
    } catch (e: any) {
        await pgForStage.query('ROLLBACK');
        log(`  ❌ Rolled back: ${e.message}`);
    } finally {
        pgForStage.release();
    }

    // ─── Stage g: Normalize phone formats to E.164ish ─────────────────────────
    log(`\n--- Stage g: Normalize phone formats (Category F conflicts only) ---`);
    // Fetch all active Healthie phone numbers for patients we have linked
    const hRes = await healthieGraphQL<any>(
        `{ users(active_status:"active", should_paginate:false, page_size:10000){ id phone_number } }`,
        {}
    );
    const healthieById = new Map((hRes?.users || []).map((u: any) => [String(u.id), u.phone_number || '']));
    const linkedPatients = await query<any>(`
        SELECT p.patient_id, p.full_name, p.phone_primary, p.healthie_client_id,
               COALESCE(hc.healthie_client_id, p.healthie_client_id) AS linked_hid
        FROM patients p
        LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active=true
        WHERE p.phone_primary IS NOT NULL AND p.phone_primary <> ''
    `);

    let normalized = 0;
    const pgPhone = await pool.connect();
    try {
        await pgPhone.query('BEGIN');
        for (const p of linkedPatients) {
            if (!p.linked_hid) continue;
            const hPhone = healthieById.get(String(p.linked_hid));
            if (!hPhone) continue;
            const pgCanon = canonPhone(p.phone_primary);
            const hCanon = canonPhone(hPhone);
            if (!pgCanon || !hCanon) continue;
            if (pgCanon !== hCanon) continue; // different numbers — NOT a format issue, skip (that's a real conflict)
            if (p.phone_primary === hPhone) continue; // already same string
            // Canonical match but display differs — normalize PG to match Healthie's form
            await pgPhone.query(`UPDATE patients SET phone_primary=$1, updated_at=NOW() WHERE patient_id=$2`, [hPhone, p.patient_id]);
            normalized++;
        }
        await pgPhone.query('COMMIT');
        log(`  Normalized ${normalized} phone numbers to match Healthie`);
    } catch (e: any) {
        await pgPhone.query('ROLLBACK');
        log(`  ❌ Rolled back: ${e.message}`);
    } finally {
        pgPhone.release();
    }

    // ─── Write updated merge worksheet with billing counts ────────────────────
    log(`\n--- Updated merge worksheet (with billing counts) ---`);
    const ws: string[] = [];
    ws.push('# Healthie Merge Worksheet (Phase 2 — billing-aware)');
    ws.push(`Generated: ${new Date().toISOString()}`);
    ws.push('');
    ws.push('Per-pair billing/appointment counts from Healthie. Safer merge target = the one with more activity.');
    ws.push('Our Postgres re-link is done (Bruce, Joe Hugill). For the other 8 pairs, verify the recommendation before merging in Healthie admin, and only approve if the target has all the billing.');
    ws.push('');
    ws.push('| # | Name | ID A (appts/bill) | ID B (appts/bill) | Recommended Healthie merge target |');
    ws.push('|---|---|---|---|---|');
    DUPES.forEach((d, i) => {
        const A = billingByHid.get(d.a) || { appts: 0, billing: 0 };
        const B = billingByHid.get(d.b) || { appts: 0, billing: 0 };
        const aScore = A.appts + A.billing;
        const bScore = B.appts + B.billing;
        let keep = d.a, drop = d.b, why = '';
        if (bScore > aScore) { keep = d.b; drop = d.a; why = `B has more activity (${B.appts + B.billing} vs ${A.appts + A.billing})`; }
        else if (aScore > bScore) { keep = d.a; drop = d.b; why = `A has more activity (${aScore} vs ${bScore})`; }
        else why = `TIE — verify manually`;
        ws.push(`| ${i + 1} | ${d.name} | ${d.a} (${A.appts}/${A.billing}) | ${d.b} (${B.appts}/${B.billing}) | **keep ${keep}**, merge ${drop} — ${why} |`);
    });
    fs.writeFileSync(WORKSHEET, ws.join('\n'));
    log(`Worksheet: ${WORKSHEET}`);

    fs.writeFileSync(LOG, logs.join('\n'));
    log(`\nFull log: ${LOG}`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

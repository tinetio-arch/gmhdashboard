/**
 * READ-ONLY patient audit across Healthie + Postgres.
 * NO writes. Produces a categorized report at /home/ec2-user/gmhdashboard/.tmp/patient-audit-report.md
 *
 * Categories:
 *   A. Healthy links (both sides, data consistent)
 *   B. In Healthie but NOT in Postgres (Jacob-style missing)
 *   C. In Postgres but Healthie user gone / unreachable
 *   D. Healthie duplicates (same name, multiple IDs — Bruce French pattern)
 *   E. Postgres row linked to a placeholder-email Healthie record when a real-email
 *      version of the same person exists (wrong-link pattern)
 *   F. Data conflicts (email / phone / DOB mismatch between Postgres and Healthie)
 *   G. Our-side duplicates (multiple patients rows → same healthie_client_id)
 *   H. Orphan healthie_clients rows (healthie_client_id not in Healthie)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import * as fs from 'fs';

const REPORT = '/home/ec2-user/gmhdashboard/.tmp/patient-audit-report.md';
const normEmail = (e: any) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p: any) => (p ? String(p).replace(/\D/g, '') : '');
const normName = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, ' ') : '');
const isPlaceholder = (e: any) => /@gethealthie\.com$/i.test(e || '');

(async () => {
    const lines: string[] = [];
    const push = (s = '') => lines.push(s);
    const t0 = Date.now();

    push(`# Patient Linking Audit`);
    push(`Generated: ${new Date().toISOString()}\n`);

    // --- Pull both sides ---
    console.log('Pulling Healthie active users...');
    const hRes = await healthieGraphQL<any>(`
        query All {
            users(active_status: "active", should_paginate: false, page_size: 10000) {
                id first_name last_name email phone_number dob user_group_id created_at active
            }
        }
    `, {});
    const healthie: any[] = hRes?.users || [];
    console.log(`  Healthie active users: ${healthie.length}`);

    console.log('Pulling Postgres patients...');
    const pgPatients = await query<any>(`
        SELECT p.patient_id, p.full_name, p.email, p.phone_primary, p.dob,
               p.healthie_client_id, p.client_type_key, p.clinic, p.status_key, p.created_at
        FROM patients p
    `);
    console.log(`  Postgres patients: ${pgPatients.length}`);

    const pgHClients = await query<any>(`
        SELECT patient_id, healthie_client_id, is_active, match_method
        FROM healthie_clients
    `);
    console.log(`  healthie_clients rows: ${pgHClients.length}`);

    // Index Healthie by id, by email, by normalized name+dob, by normalized phone
    const hById = new Map(healthie.map(u => [String(u.id), u]));
    const hByEmail = new Map<string, any[]>();
    const hByNameDob = new Map<string, any[]>();
    const hByPhone = new Map<string, any[]>();
    for (const u of healthie) {
        const e = normEmail(u.email);
        if (e && !isPlaceholder(e)) {
            if (!hByEmail.has(e)) hByEmail.set(e, []);
            hByEmail.get(e)!.push(u);
        }
        const nm = normName([u.first_name, u.last_name].filter(Boolean).join(' '));
        if (nm && u.dob) {
            const k = `${nm}|${u.dob}`;
            if (!hByNameDob.has(k)) hByNameDob.set(k, []);
            hByNameDob.get(k)!.push(u);
        }
        const ph = normPhone(u.phone_number);
        if (ph && ph.length >= 10) {
            if (!hByPhone.has(ph)) hByPhone.set(ph, []);
            hByPhone.get(ph)!.push(u);
        }
    }

    // Index Postgres patient → linked Healthie IDs (from healthie_clients + direct column)
    const linksByPatient = new Map<string, Set<string>>();
    for (const p of pgPatients) {
        const s = new Set<string>();
        if (p.healthie_client_id) s.add(String(p.healthie_client_id));
        linksByPatient.set(p.patient_id, s);
    }
    for (const hc of pgHClients) {
        if (!hc.is_active || !hc.healthie_client_id) continue;
        const s = linksByPatient.get(hc.patient_id) || new Set();
        s.add(String(hc.healthie_client_id));
        linksByPatient.set(hc.patient_id, s);
    }

    // Build index Healthie ID → Postgres patient_id(s) for collision detection
    const pgByHealthieId = new Map<string, string[]>();
    for (const [pid, ids] of linksByPatient.entries()) {
        for (const hid of ids) {
            if (!pgByHealthieId.has(hid)) pgByHealthieId.set(hid, []);
            pgByHealthieId.get(hid)!.push(pid);
        }
    }

    // --- Category A: Healthy links ---
    const A = pgPatients.filter(p => {
        const ids = linksByPatient.get(p.patient_id) || new Set();
        if (ids.size === 0) return false;
        for (const id of ids) if (hById.has(id)) return true;
        return false;
    });

    // --- Category B: In Healthie but NOT in Postgres ---
    const linkedHids = new Set([...pgByHealthieId.keys()]);
    const B = healthie.filter(u => !linkedHids.has(String(u.id)));

    // --- Category C: In Postgres but Healthie record gone ---
    const C = pgPatients.filter(p => {
        const ids = linksByPatient.get(p.patient_id) || new Set();
        if (ids.size === 0) return false; // no link at all (different category)
        for (const id of ids) if (hById.has(id)) return false;
        return true;
    });

    // --- Category D: Healthie duplicates (same name+dob OR email collisions across IDs) ---
    const D_byNameDob: Array<{ key: string; ids: any[] }> = [];
    for (const [k, arr] of hByNameDob.entries()) if (arr.length > 1) D_byNameDob.push({ key: k, ids: arr });
    const D_byEmail: Array<{ key: string; ids: any[] }> = [];
    for (const [k, arr] of hByEmail.entries()) if (arr.length > 1) D_byEmail.push({ key: k, ids: arr });

    // --- Category E: Postgres linked to placeholder-email Healthie when a real-email version exists ---
    const E: Array<{ pg: any; linkedHealthie: any; betterHealthie: any }> = [];
    for (const p of pgPatients) {
        const ids = linksByPatient.get(p.patient_id) || new Set();
        for (const hid of ids) {
            const linked = hById.get(hid);
            if (!linked) continue;
            if (!isPlaceholder(linked.email)) continue;
            const nm = normName([linked.first_name, linked.last_name].filter(Boolean).join(' '));
            if (!nm || !linked.dob) continue;
            const siblings = hByNameDob.get(`${nm}|${linked.dob}`) || [];
            const better = siblings.find(s => String(s.id) !== String(hid) && !isPlaceholder(s.email) && s.email);
            if (better) E.push({ pg: p, linkedHealthie: linked, betterHealthie: better });
        }
    }

    // --- Category F: Data conflicts (email/phone/DOB mismatch) ---
    const F: Array<{ pg: any; h: any; conflicts: string[] }> = [];
    for (const p of pgPatients) {
        const ids = linksByPatient.get(p.patient_id) || new Set();
        for (const hid of ids) {
            const h = hById.get(hid);
            if (!h) continue;
            const conflicts: string[] = [];
            const pe = normEmail(p.email);
            const he = normEmail(h.email);
            if (pe && he && !isPlaceholder(pe) && !isPlaceholder(he) && pe !== he) conflicts.push(`email: pg="${p.email}" hl="${h.email}"`);
            const pp = normPhone(p.phone_primary);
            const hp = normPhone(h.phone_number);
            if (pp && hp && pp.length >= 10 && hp.length >= 10 && pp !== hp) conflicts.push(`phone: pg="${p.phone_primary}" hl="${h.phone_number}"`);
            const pd = p.dob ? String(p.dob).slice(0, 10) : '';
            const hd = h.dob ? String(h.dob).slice(0, 10) : '';
            if (pd && hd && pd !== hd) conflicts.push(`dob: pg="${pd}" hl="${hd}"`);
            if (conflicts.length) F.push({ pg: p, h, conflicts });
        }
    }

    // --- Category G: Our-side duplicates (multiple patients → same Healthie ID) ---
    const G: Array<{ hid: string; patientIds: string[] }> = [];
    for (const [hid, pids] of pgByHealthieId.entries()) {
        if (pids.length > 1) G.push({ hid, patientIds: pids });
    }

    // --- Category H: Orphan healthie_clients (healthie_client_id not in Healthie active) ---
    const H: any[] = pgHClients.filter(hc => hc.is_active && hc.healthie_client_id && !hById.has(String(hc.healthie_client_id)));

    // --- Category I: Postgres patients with NO link at all (healthie_client_id NULL + no healthie_clients row) ---
    const I = pgPatients.filter(p => (linksByPatient.get(p.patient_id) || new Set()).size === 0);

    // --- Summary table ---
    push(`## Summary`);
    push('');
    push(`| Category | Count | Meaning |`);
    push(`|---|---:|---|`);
    push(`| A. Healthy links | ${A.length} | Postgres row ↔ active Healthie user, link resolves |`);
    push(`| B. In Healthie, missing from Postgres | ${B.length} | Never imported (Jacob pattern) |`);
    push(`| C. In Postgres, Healthie user gone | ${C.length} | Deleted / inactive in Healthie but our row still linked |`);
    push(`| D. Healthie-side duplicates (name+DOB) | ${D_byNameDob.length} | Same person with multiple Healthie IDs |`);
    push(`| D. Healthie-side duplicates (real email) | ${D_byEmail.length} | Multiple Healthie records sharing a real email |`);
    push(`| E. Linked to placeholder-email dupe | ${E.length} | Our link points at a @gethealthie.com stub when a real record exists (Bruce French pattern) |`);
    push(`| F. Data conflicts (email/phone/DOB) | ${F.length} | Field mismatch between our row and Healthie |`);
    push(`| G. Our-side duplicates | ${G.length} | Multiple Postgres patients point at the same Healthie ID |`);
    push(`| H. Orphan healthie_clients rows | ${H.length} | healthie_clients row pointing at a Healthie ID that isn't active |`);
    push(`| I. Postgres with no Healthie link at all | ${I.length} | Not linked, never matched |`);
    push('');
    push(`**Healthie active total:** ${healthie.length}`);
    push(`**Postgres patients total:** ${pgPatients.length}`);
    push(`**Runtime:** ${Math.round((Date.now() - t0) / 1000)}s`);
    push('');

    // --- Samples per category ---
    const sampleTable = (rows: any[][], headers: string[], limit = 20) => {
        if (rows.length === 0) return '_(none)_\n';
        const head = '| ' + headers.join(' | ') + ' |';
        const sep = '|' + headers.map(() => '---').join('|') + '|';
        const body = rows.slice(0, limit).map(r => '| ' + r.map(v => (v == null ? '' : String(v).replace(/\|/g, '\\|').slice(0, 80))).join(' | ') + ' |').join('\n');
        const more = rows.length > limit ? `\n\n_...and ${rows.length - limit} more_\n` : '\n';
        return head + '\n' + sep + '\n' + body + more;
    };

    push(`## Category B — In Healthie, missing from Postgres (${B.length})`);
    push(`These are patients added directly in Healthie that never got into our DB. Webhook upsert (deployed earlier) will catch new ones going forward; the nightly reconciliation cron will drain this backlog.`);
    push('');
    push(sampleTable(
        B.map(u => [u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim(), u.email, u.phone_number, u.dob, u.created_at]),
        ['Healthie ID', 'Name', 'Email', 'Phone', 'DOB', 'Created']
    ));

    push(`## Category C — In Postgres, Healthie user gone (${C.length})`);
    push(`Our row links to a Healthie ID that isn't in the active roster. Could be inactive/archived in Healthie, or the ID changed.`);
    push('');
    push(sampleTable(
        C.map(p => [p.patient_id.slice(0, 8), p.full_name, p.email, p.healthie_client_id, p.status_key]),
        ['PG ID', 'Name', 'Email', 'Linked Healthie ID', 'Status']
    ));

    push(`## Category D — Healthie-side duplicates (${D_byNameDob.length} by name+DOB, ${D_byEmail.length} by email)`);
    push(`Same person appears multiple times in Healthie. Our link picks one, may not be the right one.`);
    push('');
    push(`### By name + DOB`);
    push(sampleTable(
        D_byNameDob.map(d => {
            const ids = d.ids.map((u: any) => u.id + (isPlaceholder(u.email) ? ' [placeholder]' : '')).join(', ');
            const name = d.ids[0] ? `${d.ids[0].first_name || ''} ${d.ids[0].last_name || ''}`.trim() : '';
            return [name, d.key.split('|')[1], ids, d.ids.length];
        }),
        ['Name', 'DOB', 'Healthie IDs', 'Count']
    ));
    push('');
    push(`### By real email`);
    push(sampleTable(
        D_byEmail.map(d => [d.key, d.ids.map((u: any) => `${u.id} (${u.first_name} ${u.last_name})`).join(', '), d.ids.length]),
        ['Email', 'Healthie records', 'Count']
    ));

    push(`## Category E — Linked to placeholder-email dupe (${E.length})`);
    push(`Our patient is linked to a Healthie record with a @gethealthie.com stub email when a sibling Healthie record for the same person has the real email. Relinking to the real-email one would improve GHL matching + SMS routing. **Bruce French** is here.`);
    push('');
    push(sampleTable(
        E.map(e => [e.pg.full_name, e.linkedHealthie.id, e.linkedHealthie.email, e.betterHealthie.id, e.betterHealthie.email]),
        ['Patient', 'Current link', 'Current email', 'Better link', 'Better email']
    ));

    push(`## Category F — Data conflicts (${F.length})`);
    push(`Field mismatch between Postgres and Healthie. Healthie is SOT per memory; our data should be updated to match.`);
    push('');
    push(sampleTable(
        F.map(f => [f.pg.full_name, f.h.id, f.conflicts.join('; ')]),
        ['Patient', 'Healthie ID', 'Conflicts']
    ));

    push(`## Category G — Our-side duplicates (${G.length})`);
    push(`Multiple Postgres rows point at the same Healthie ID. One is the real patient; the other(s) are ghost rows from earlier buggy imports.`);
    push('');
    push(sampleTable(
        G.map(g => [g.hid, g.patientIds.length, g.patientIds.map(id => id.slice(0, 8)).join(', ')]),
        ['Healthie ID', 'PG rows', 'patient_ids (prefix)']
    ));

    push(`## Category H — Orphan healthie_clients (${H.length})`);
    push(`healthie_clients row has is_active=true but the Healthie user isn't in the active roster. Stale link.`);
    push('');
    push(sampleTable(
        H.map(hc => [hc.healthie_client_id, hc.patient_id?.slice(0, 8), hc.match_method]),
        ['Healthie ID', 'PG patient_id', 'Match method']
    ));

    push(`## Category I — Postgres, no link (${I.length})`);
    push(`Patient row exists in our DB with NO Healthie link at all (healthie_client_id NULL, no healthie_clients row). Usually means manual DB entry or a failed initial sync.`);
    push('');
    push(sampleTable(
        I.map(p => [p.patient_id.slice(0, 8), p.full_name, p.email, p.phone_primary, p.status_key, p.created_at]),
        ['PG ID', 'Name', 'Email', 'Phone', 'Status', 'Created']
    ));

    fs.writeFileSync(REPORT, lines.join('\n'));
    console.log(`\n✅ Report written to ${REPORT}`);
    console.log(`\nSummary:`);
    console.log(`  A Healthy: ${A.length}`);
    console.log(`  B Missing in PG: ${B.length}`);
    console.log(`  C Healthie gone: ${C.length}`);
    console.log(`  D Healthie dupes: ${D_byNameDob.length} by name+DOB, ${D_byEmail.length} by email`);
    console.log(`  E Wrong-link (placeholder): ${E.length}`);
    console.log(`  F Data conflicts: ${F.length}`);
    console.log(`  G Our-side dupes: ${G.length}`);
    console.log(`  H Orphan links: ${H.length}`);
    console.log(`  I No link at all: ${I.length}`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

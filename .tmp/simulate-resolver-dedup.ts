/**
 * READ-ONLY simulation of the new ipad-patient-resolver dedup logic.
 * Walks every flagged patient from the dedup report and asks: "if Healthie
 * pinged us with this person's healthie_id today, would we MATCH an existing
 * row (good) or INSERT a new one (bad)?"
 *
 * Run: cd ~/gmhdashboard && npx tsx .tmp/simulate-resolver-dedup.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';

const normEmail = (e: any) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p: any) => (p ? String(p).replace(/\D/g, '') : '');
const normName  = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, ' ') : '');

async function findMatch(opts: { healthieClientId: string; email?: string; phone?: string; fullName?: string; dob?: string; selfId?: string }) {
    const { healthieClientId, email, phone, fullName, dob, selfId } = opts;
    const excludeP  = selfId ? ` AND p.patient_id <> '${selfId}'` : '';
    const exclude = selfId ? ` AND patient_id <> '${selfId}'` : '';

    const [byH] = await query<{ patient_id: string; full_name: string }>(
        `SELECT p.patient_id, p.full_name FROM patients p
         LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
         WHERE (p.healthie_client_id = $1 OR hc.healthie_client_id = $1)${excludeP}
         LIMIT 1`, [healthieClientId]);
    if (byH?.patient_id) return { method: 'healthie_id', ...byH };

    const e = normEmail(email);
    const firstName = normName((fullName || '').split(/\s+/)[0]);
    if (e && dob && firstName) {
        const [r] = await query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients
             WHERE LOWER(email) = $1 AND dob = $2::date
               AND LOWER(SPLIT_PART(TRIM(full_name),' ',1)) = $3${exclude} LIMIT 1`, [e, dob, firstName]);
        if (r?.patient_id) return { method: 'email+dob+firstname', ...r };
    }
    const ph = normPhone(phone);
    const nm = normName(fullName);
    if (ph && ph.length >= 10 && nm) {
        const [r] = await query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients
             WHERE regexp_replace(COALESCE(phone_primary,''),'\\D','','g') = $1
               AND LOWER(TRIM(full_name)) = $2${exclude} LIMIT 1`, [ph, nm]);
        if (r?.patient_id) return { method: 'phone+name', ...r };
    }
    return null;
}

async function main() {
    // Pull the patients flagged in the dedup report (active only — per Phil)
    const flagged = await query<any>(`
      SELECT * FROM patients
      WHERE patient_id IN (
        'b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900','a8f6f8b6-b888-4b0e-8a10-6a75cced2445',
        '1cc98153-2086-4cfa-9fb8-32925b41205c','59d87bb4-dcf0-4319-8b3b-781fbda524f5','aa26dd87-14bb-4208-b01a-10c66b7f40d4',
        '471ea04b-45a6-4527-9109-31e8b8e06a8a','17fc56e5-9c07-42c5-b4ff-32e0e1d21502','fa75dcdd-da08-498c-8d67-20807625585b',
        'c9ca51e6-e404-4709-b774-a9a5b2bf6cd8','16d10988-b2ff-485d-9864-3f257e80a553',
        'f83511e0-d893-43f5-bd29-56be90f216db','d7f161be-a70a-4d38-9cc0-f75457ed1d89',
        '52221564-dc08-4ef6-b685-1b4c410bab5e','7313f334-fd41-4670-933e-cbaeb694aef5',
        'f9af859d-efbb-42ef-b317-8b59c9657306','283dbdc8-1bdf-4a22-bb6c-a0ce457cc0a8',
        '471f488b-d771-462b-ad91-08ff442bd354','1ba02763-fba0-4ecd-9852-43adb27890a1'
      )
      ORDER BY full_name`);

    console.log(`\nSimulating new resolver against ${flagged.length} flagged rows...\n`);
    console.log('Pretending Healthie sent us this person fresh — would we MATCH (merge) or INSERT (new row)?\n');
    console.log('NAME'.padEnd(22), 'PATIENT_ID'.padEnd(38), 'STATUS'.padEnd(10), '→ DECISION');
    console.log('-'.repeat(120));

    let wouldMatch = 0, wouldInsert = 0;
    const insertCases: any[] = [];

    for (const p of flagged) {
        const match = await findMatch({
            healthieClientId: p.healthie_client_id,
            email: p.email,
            phone: p.phone_primary,
            fullName: p.full_name,
            dob: p.dob,
            selfId: p.patient_id,
        });
        const decision = match
            ? `MATCH via ${match.method} → ${match.patient_id} (${match.full_name})`
            : `INSERT NEW (no match found — correct if not a dup)`;
        console.log(
            String(p.full_name || '').padEnd(22),
            String(p.patient_id).padEnd(38),
            String(p.status_key || '(null)').padEnd(10),
            '→', decision
        );
        if (match) wouldMatch++; else { wouldInsert++; insertCases.push(p); }
    }

    console.log('-'.repeat(120));
    console.log(`\nResult: ${wouldMatch} would MATCH (merge into existing), ${wouldInsert} would INSERT new\n`);
    console.log('Verifying the families are NOT cross-matched (Austin spouses, Freeman spouses, Gannon spouses, etc.)');
    console.log('— if any spouse pair shows up MATCHing the other, the logic is wrong.\n');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

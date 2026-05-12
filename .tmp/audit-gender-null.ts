/**
 * READ-ONLY: how many of our 398 patients have null/missing gender in Healthie?
 * No writes.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';
import { query } from '../lib/db';

async function main() {
    const patients = await query<any>(`
      SELECT patient_id, full_name, healthie_client_id, status_key
      FROM patients
      WHERE healthie_client_id IS NOT NULL
      ORDER BY date_added DESC NULLS LAST
    `);
    console.log(`[audit] ${patients.length} patients with healthie_client_id`);

    const nullGender: any[] = [];
    const validGender: Record<string, number> = {};
    const errors: any[] = [];

    for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        if (i % 25 === 0) console.log(`[audit] ${i}/${patients.length}...`);
        try {
            const r = await healthieGraphQL<any>(`query($id: ID) { user(id: $id) { id gender first_name last_name } }`, { id: p.healthie_client_id });
            const u = r?.user;
            if (!u) { errors.push({ ...p, reason: 'user not found in Healthie' }); continue; }
            const g = u.gender;
            if (g == null || g === '') {
                nullGender.push({ patient_id: p.patient_id, name: p.full_name || `${u.first_name} ${u.last_name}`, healthie: p.healthie_client_id, status: p.status_key });
            } else {
                validGender[g] = (validGender[g] || 0) + 1;
            }
        } catch (e: any) {
            errors.push({ ...p, reason: e.message });
        }
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`Null/missing gender in Healthie: ${nullGender.length}/${patients.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`\nValid gender distribution:`);
    for (const [g, n] of Object.entries(validGender).sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n}`);
    console.log(`\nNULL-gender patients (first 50):`);
    for (const p of nullGender.slice(0, 50)) console.log(`  ${p.name.padEnd(28)} healthie=${p.healthie} status=${p.status || '—'} local=${p.patient_id}`);
    if (errors.length) {
        console.log(`\nErrors (first 10):`);
        for (const e of errors.slice(0, 10)) console.log(`  ${e.full_name || e.healthie_client_id}: ${e.reason}`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

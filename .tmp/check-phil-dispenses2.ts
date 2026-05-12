import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<any>(`SELECT column_name FROM information_schema.columns WHERE table_name='dispenses' ORDER BY ordinal_position`);
    console.log('dispenses columns:', cols.map(c => c.column_name).join(', '));
    const phils = await query<any>(`SELECT patient_id::text, full_name, healthie_client_id, email FROM patients WHERE full_name ILIKE '%schafer%' OR full_name ILIKE '%phillip%' OR email ILIKE '%philschafer%' OR healthie_client_id IN ('12123979', '12088269', '14408744')`);
    console.log('\nPhil patient records:', phils.length);
    for (const p of phils) {
        console.log(`\n  ${p.full_name} | pid=${p.patient_id} | healthie=${p.healthie_client_id} | email=${p.email}`);
        const d = await query<any>(`SELECT COUNT(*)::text AS n, MAX(dispensed_at)::text AS last FROM dispenses WHERE patient_id = $1`, [p.patient_id]);
        console.log(`    dispenses: ${d[0]?.n || 0}, last: ${d[0]?.last || 'never'}`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

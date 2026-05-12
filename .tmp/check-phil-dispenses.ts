import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const phils = await query<any>(`SELECT patient_id::text, full_name, healthie_client_id, email FROM patients WHERE full_name ILIKE '%schafer%' OR full_name ILIKE '%phillip%' OR email ILIKE '%philschafer%' OR healthie_client_id IN ('12123979', '12088269', '14408744')`);
    console.log('Phil patient records:', phils.length);
    for (const p of phils) {
        console.log(`\n  ${p.full_name} | pid=${p.patient_id} | healthie=${p.healthie_client_id} | email=${p.email}`);
        const d = await query<any>(`SELECT COUNT(*)::text AS n, COALESCE(SUM(dose_ml),0)::text AS ml, MAX(dispensed_at)::text AS last FROM dispenses WHERE patient_id = $1`, [p.patient_id]);
        console.log(`    dispenses: ${d[0]?.n || 0}, total_ml: ${d[0]?.ml || 0}, last: ${d[0]?.last || 'never'}`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

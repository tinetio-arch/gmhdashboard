import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<any>(`SELECT column_name FROM information_schema.columns WHERE table_name='app_access_controls' ORDER BY ordinal_position`);
    console.log('app_access_controls columns:', cols.map(c => c.column_name));
    const p = await query<any>(`SELECT patient_id, full_name, email, healthie_client_id, status_key FROM patients WHERE email ILIKE '%philschafer7%' OR full_name ILIKE '%schafer%' LIMIT 5`);
    console.log('\npatients:', p);
    if (p.length) {
        for (const pt of p) {
            const acc = await query<any>(`SELECT * FROM app_access_controls WHERE patient_id = $1 LIMIT 5`, [pt.patient_id]);
            console.log(`\naccess for ${pt.full_name} (${pt.patient_id}):`, acc);
        }
    }
    // Also check by healthie_client_id 14408744
    const acc2 = await query<any>(`SELECT * FROM app_access_controls WHERE patient_id IN (SELECT patient_id::text FROM patients WHERE healthie_client_id = '14408744') LIMIT 5`);
    console.log('\naccess by healthie 14408744:', acc2);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

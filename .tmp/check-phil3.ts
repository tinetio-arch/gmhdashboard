import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<any>(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='app_access_controls' ORDER BY ordinal_position`);
    console.log('columns:', cols);
    const p = await query<any>(`SELECT patient_id::text, full_name, email, healthie_client_id FROM patients WHERE email ILIKE '%philschafer7%' OR healthie_client_id = '14408744' LIMIT 5`);
    console.log('\npatients:', p);
    if (p.length) {
        const acc = await query<any>(`SELECT * FROM app_access_controls WHERE patient_id = $1`, [p[0].patient_id]);
        console.log('\naccess_controls:', acc);
    }
    // Also check access-check endpoint logic
    const SECRET = process.env.JARVIS_SHARED_SECRET;
    console.log('\naccess-check for healthie 14408744:');
    const res = await fetch(`http://localhost:3011/ops/api/headless/access-check/?healthie_id=14408744`, { headers: { 'x-jarvis-secret': SECRET || '' } });
    console.log('  status:', res.status, await res.json());
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

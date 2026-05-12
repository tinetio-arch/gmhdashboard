import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import { healthieGraphQL } from '../lib/healthieApi';
async function main() {
    // Find Phil's healthie ID from email
    const r = await healthieGraphQL<any>(`query { users(keywords: "philschafer7@gmail.com") { id first_name last_name email } }`);
    console.log('Healthie search:', JSON.stringify(r?.users, null, 2));
    // Check local app_access_controls
    const local = await query<any>(`SELECT * FROM app_access_controls WHERE healthie_id IN ('12088269', '12093125') OR patient_id IN (SELECT patient_id::text FROM patients WHERE email ILIKE '%philschafer7%') LIMIT 5`);
    console.log('\napp_access_controls:', local);
    // Check patients table
    const p = await query<any>(`SELECT patient_id, full_name, email, healthie_client_id, status_key FROM patients WHERE email ILIKE '%philschafer7%' OR full_name ILIKE '%schafer%' LIMIT 5`);
    console.log('\npatients table:', p);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

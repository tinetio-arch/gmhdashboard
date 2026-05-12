/**
 * READ-ONLY: find the "white at the bottom" patients — rows with no
 * status_key and/or no client_type_key, sorted to mirror dashboard order.
 * No writes. No Healthie calls.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';

async function main() {
    const rows = await query<any>(`
      SELECT patient_id, full_name, email, phone_primary, dob,
             healthie_client_id, ghl_contact_id,
             status_key, client_type_key, payment_method_key, patient_type,
             clinic, regimen, date_added
      FROM patients
      WHERE status_key IS NULL OR client_type_key IS NULL
      ORDER BY date_added DESC NULLS LAST
    `);

    console.log(`\nPatients with NULL status_key OR NULL client_type_key: ${rows.length}\n`);
    console.log('NAME'.padEnd(24), 'STATUS'.padEnd(10), 'TYPE'.padEnd(16), 'CLINIC'.padEnd(20), 'HEALTHIE_ID'.padEnd(12), 'ADDED');
    console.log('-'.repeat(140));
    for (const r of rows) {
        console.log(
            String(r.full_name || '(no name)').slice(0, 23).padEnd(24),
            String(r.status_key || '—').padEnd(10),
            String(r.client_type_key || '—').padEnd(16),
            String(r.clinic || '—').padEnd(20),
            String(r.healthie_client_id || '—').padEnd(12),
            r.date_added ? new Date(r.date_added).toISOString().slice(0, 10) : '—'
        );
    }
    console.log('-'.repeat(140));
    const noHealthie = rows.filter(r => !r.healthie_client_id).length;
    const withHealthie = rows.length - noHealthie;
    console.log(`\nOf those ${rows.length}: ${withHealthie} have healthie_client_id (can refetch), ${noHealthie} do NOT have a Healthie link.\n`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

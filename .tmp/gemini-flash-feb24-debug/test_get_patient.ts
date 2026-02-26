import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function getPatient() {
  const result: any = await query("SELECT patient_id, patient_name, healthie_client_id FROM patient_data_entry_v WHERE patient_name ILIKE '%phil%schafer%' LIMIT 1");
  console.log(result[0] || result.rows?.[0]);
  process.exit(0);
}
getPatient();

import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function getPatient() {
  const result: any = await query(`
    SELECT patient_id, full_name, healthie_client_id 
    FROM patients 
    WHERE healthie_client_id = '122123979' OR full_name ILIKE '%phil%schafer%'
  `);
  console.log(result.rows);
  process.exit(0);
}
getPatient();

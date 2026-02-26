import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const patientRes: any = await query(`SELECT patient_id FROM patients WHERE full_name ILIKE '%phil%schafer%' LIMIT 1`);
  if (!patientRes || patientRes.length === 0) { console.log('Patient not found'); process.exit(0); }
  const patientId = patientRes[0].patient_id;
  console.log('patient_id:', patientId);

  console.log("\n== VIALS ==");
  const vials: any = await query(`SELECT vial_id, external_id, status, remaining_volume_ml, size_ml FROM vials ORDER BY updated_at DESC LIMIT 10`);
  console.log(vials);

  console.log("\n== DISPENSES for patient ==");
  const dispenses: any = await query(`SELECT dispense_id, dispense_date, total_dispensed_ml, waste_ml, vial_id FROM dispenses WHERE patient_id = $1 ORDER BY dispense_date DESC LIMIT 10`, [patientId]);
  console.log(dispenses);

  console.log("\n== RECENT DISPENSE HISTORY ==");
  const history: any = await query(`SELECT event_type, event_payload->>'patientName' as patient, event_payload->>'amountRestored' as restored, event_payload->>'vialId' as vial_id, created_at FROM dispense_history ORDER BY created_at DESC LIMIT 10`);
  console.log(history);

  process.exit(0);
}
check();

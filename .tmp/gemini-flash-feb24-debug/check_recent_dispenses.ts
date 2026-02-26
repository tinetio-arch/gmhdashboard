import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  console.log("== DISPENSES LAST 48H ==");
  const dispenses: any = await query('SELECT dispense_id, patient_id, patient_name, total_dispensed_ml, waste_ml, created_at FROM dispenses WHERE created_at > NOW() - INTERVAL \'48 hours\' ORDER BY created_at DESC');
  console.log(JSON.stringify(dispenses, null, 2));

  console.log("\n== DELETED EVENTS LAST 48H ==");
  const history: any = await query('SELECT * FROM dispense_history WHERE event_type = \'deleted\' OR event_payload::text ILIKE \'%deleted%\' ORDER BY created_at DESC');
  console.log(JSON.stringify(history, null, 2));

  process.exit(0);
}
check();

import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  console.log("== RECENT DISPENSE HISTORY (ALL EVENTS) ==");
  const history: any = await query(`
    SELECT event_type, created_at, event_payload 
    FROM dispense_history 
    ORDER BY created_at DESC 
    LIMIT 30
  `);
  console.log(JSON.stringify(history, null, 2));

  console.log("\n== SPECIFIC VIALS DETAIL ==");
  const vials: any = await query(`
    SELECT vial_id, external_id, status, remaining_volume_ml, size_ml, updated_at, created_at
    FROM vials 
    WHERE external_id IN ('V0367', 'V0368', 'V0339')
    OR remaining_volume_ml::numeric = 0 AND status = 'Active'
  `);
  console.log(vials);

  process.exit(0);
}
check();

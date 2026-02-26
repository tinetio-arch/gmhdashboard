import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const dispenseId = '2b49f1f7-3493-408a-8fb7-66e4ff511ba6';
  console.log("== HISTORY FOR ID " + dispenseId + " ==");
  const history: any = await query(`
    SELECT * FROM dispense_history WHERE dispense_id = $1
  `, [dispenseId]);
  console.log(history);

  console.log("\n== ALL RECENT HISTORY (LAST 50) ==");
  const all: any = await query(`
    SELECT event_id, event_type, event_payload, created_at 
    FROM dispense_history 
    ORDER BY created_at DESC 
    LIMIT 50
  `);
  console.log(JSON.stringify(all, null, 2));

  process.exit(0);
}
check();

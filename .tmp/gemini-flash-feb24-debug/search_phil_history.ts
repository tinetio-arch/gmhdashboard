import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  console.log("== HISTORY FOR PHIL ==");
  const history: any = await query(`
    SELECT event_id, event_type, event_payload, created_at 
    FROM dispense_history 
    WHERE event_payload::text ILIKE '%phil%'
    ORDER BY created_at DESC 
  `);
  console.log(JSON.stringify(history, null, 2));
  process.exit(0);
}
check();

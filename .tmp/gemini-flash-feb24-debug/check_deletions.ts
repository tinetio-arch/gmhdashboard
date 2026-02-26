import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  console.log("== DELETED EVENTS ==");
  const history: any = await query(`
    SELECT event_id, event_payload, created_at 
    FROM dispense_history 
    WHERE event_type = 'deleted' 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  console.log(JSON.stringify(history, null, 2));
  process.exit(0);
}
check();

import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  console.log("== RECENT ADJUSTMENTS ==");
  const rows: any = await query(`
    SELECT * 
    FROM dispense_history 
    WHERE event_type ILIKE '%adjust%' OR event_payload::text ILIKE '%Whitten%'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
check();

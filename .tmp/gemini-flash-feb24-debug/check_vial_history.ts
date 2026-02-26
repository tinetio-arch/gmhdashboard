import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const vials = ['V0367', 'V0368'];
  for (const v of vials) {
    console.log(`== HISTORY FOR ${v} ==`);
    const rows: any = await query(`
      SELECT event_type, event_payload, created_at 
      FROM dispense_history 
      WHERE event_payload::text ILIKE '%${v}%'
      ORDER BY created_at DESC
    `);
    console.log(JSON.stringify(rows, null, 2));
  }
  process.exit(0);
}
check();

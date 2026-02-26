import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const rows: any = await query("SELECT external_id, remaining_volume_ml, status FROM vials WHERE external_id IN ('V0367', 'V0368')");
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
check();

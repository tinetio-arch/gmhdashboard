import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const res: any = await query('SELECT NOW(), CURRENT_TIMESTAMP, (NOW() AT TIME ZONE \'UTC\') as utc_now');
  console.log(res);
  process.exit(0);
}
check();

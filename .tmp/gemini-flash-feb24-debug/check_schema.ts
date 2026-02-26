import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const rows: any = await query(`
    SELECT
        conname,
        pg_get_constraintdef(c.oid)
    FROM
        pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE
        n.nspname = 'public'
        AND conrelid = 'dispense_history'::regclass;
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
check();

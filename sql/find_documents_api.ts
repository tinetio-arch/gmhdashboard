import { query } from '../lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findFiles() {
  const result: any = await query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name ILIKE '%file%' OR column_name ILIKE '%document%' OR column_name ILIKE '%prescrip%'
  `);
  console.log(result.rows);
  process.exit(0);
}
findFiles();

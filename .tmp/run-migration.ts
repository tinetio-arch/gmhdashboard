import { config } from 'dotenv';
config({ path: '.env.local' });
import { query, getPool } from '../lib/db';
import * as fs from 'fs';
async function main() {
    const sql = fs.readFileSync('migrations/20260415_pelleting_gender_and_groups.sql', 'utf8');
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('[migration] COMMITTED');
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('[migration] ROLLED BACK:', e.message);
        process.exit(1);
    } finally {
        client.release();
    }
    const after = await query<any>(`SELECT id, tag, appointment_type_id, gender, healthie_tag_id, healthie_group_id, form_id, label FROM service_tag_config ORDER BY tag, gender NULLS FIRST, appointment_type_id`);
    console.log(`\npost-migration rows (${after.length}):`);
    for (const r of after) console.log(' ', JSON.stringify(r));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

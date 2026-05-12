import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<any>(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='patient_service_tags' ORDER BY ordinal_position`);
    console.log('patient_service_tags columns:');
    for (const c of cols) console.log(' ', c);
    const unique = await query<any>(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'patient_service_tags'`);
    console.log('\nindexes/constraints:');
    for (const u of unique) console.log(' ', u.indexname, '→', u.indexdef);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

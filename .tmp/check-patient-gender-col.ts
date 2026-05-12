import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'patients' AND column_name LIKE '%gender%'`);
    console.log('gender cols on patients:', cols);
    if (cols.length) {
        const sample = await query<any>(`SELECT patient_id, full_name, ${cols[0].column_name} FROM patients WHERE ${cols[0].column_name} IS NOT NULL LIMIT 5`);
        console.log('sample populated:', sample);
        const counts = await query<{ n: string; missing: string }>(`SELECT COUNT(${cols[0].column_name})::text n, COUNT(CASE WHEN ${cols[0].column_name} IS NULL THEN 1 END)::text missing FROM patients`);
        console.log('counts:', counts);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

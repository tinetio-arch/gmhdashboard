import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
async function main() {
    const cols = await query<any>(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='service_tag_config' ORDER BY ordinal_position`);
    console.log('service_tag_config columns:'); for (const c of cols) console.log(' ', c);
    const cur = await query<any>(`SELECT id, tag, appointment_type_id, form_id, label, active FROM service_tag_config ORDER BY id`);
    console.log('\ncurrent rows:', cur.length); for (const r of cur) console.log(' ', r);
    const evexReferences = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM patient_service_tags WHERE tag = 'evexipel'`);
    console.log('\npatients tagged evexipel:', evexReferences[0]?.n);
    const pellReferences = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM patient_service_tags WHERE tag = 'pelleting'`);
    console.log('patients tagged pelleting:', pellReferences[0]?.n);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

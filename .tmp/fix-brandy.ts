import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';
import { query } from '../lib/db';

async function main() {
    // Step 1: inspect updateUser input type for gender field
    console.log('--- updateUserInput fields containing "gender" ---');
    try {
        const r = await healthieGraphQL<any>(`query { __type(name: "updateUserInput") { inputFields { name type { name kind } } } }`);
        const fields = r?.__type?.inputFields || [];
        const hits = fields.filter((f: any) => /gender|identity/i.test(f?.name || ''));
        for (const f of hits) console.log(`  ${f.name}: ${f.type?.name || f.type?.kind}`);
    } catch (e: any) { console.log('ERR:', e.message); }

    // Step 2: confirm Brandy's CURRENT state
    console.log('\n--- Brandy BEFORE ---');
    const before = await healthieGraphQL<any>(`query { user(id: "13959267") { id first_name last_name gender gender_identity } }`);
    console.log('  healthie:', JSON.stringify(before?.user));
    const bLocal = await query<any>(`SELECT patient_id, full_name, gender FROM patients WHERE healthie_client_id = '13959267' LIMIT 1`);
    console.log('  local   :', JSON.stringify(bLocal[0]));

    // Step 3: Healthie updateUser (gender = Female)
    console.log('\n--- Healthie updateUser ---');
    const upd = await healthieGraphQL<any>(`
        mutation($input: updateUserInput!) {
            updateUser(input: $input) {
                user { id first_name last_name gender }
                messages { field message }
            }
        }
    `, { input: { id: '13959267', gender: 'Female' } });
    console.log('  response:', JSON.stringify(upd?.updateUser, null, 2));

    // Step 4: Local UPDATE
    console.log('\n--- Local UPDATE ---');
    const r = await query<{ patient_id: string; full_name: string; gender: string }>(
        `UPDATE patients SET gender = 'Female', updated_at = NOW()
         WHERE healthie_client_id = '13959267'
         RETURNING patient_id, full_name, gender`
    );
    console.log('  updated:', r);

    // Step 5: verify AFTER
    console.log('\n--- Brandy AFTER ---');
    const after = await healthieGraphQL<any>(`query { user(id: "13959267") { id first_name last_name gender } }`);
    console.log('  healthie:', JSON.stringify(after?.user));
    const aLocal = await query<any>(`SELECT patient_id, full_name, gender FROM patients WHERE healthie_client_id = '13959267' LIMIT 1`);
    console.log('  local   :', JSON.stringify(aLocal[0]));

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

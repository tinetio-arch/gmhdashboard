import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

async function main() {
    // bulkApply input shape
    console.log('--- bulkApply mutation input ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { __type(name: "bulkApplyInput") { inputFields { name type { name kind ofType { name } } } } }
        `);
        const fields = r?.__type?.inputFields || [];
        for (const f of fields) console.log(`  ${f.name}: ${f.type?.name || f.type?.ofType?.name || f.type?.kind}`);
    } catch (e: any) { console.log('ERR:', e.message); }

    // active_tags shape on User
    console.log('\n--- User.active_tags type ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { __type(name: "Tag") { fields { name type { name kind } } } }
        `);
        const fields = r?.__type?.fields || [];
        for (const f of fields.slice(0, 20)) console.log(`  ${f.name}: ${f.type?.name || f.type?.kind}`);
    } catch (e: any) { console.log('ERR:', e.message); }

    // Check Sara Saloner's actual Healthie active_tags
    console.log('\n--- Sara Saloner (12743176) active_tags ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { user(id: "12743176") { id first_name last_name gender active_tags { id name } } }
        `);
        console.log('  ', JSON.stringify(r?.user, null, 2));
    } catch (e: any) { console.log('ERR:', e.message); }

    // And check a known male patient with TRT (if Sam Breyer)
    console.log('\n--- Sam Breyer (12183157) active_tags ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { user(id: "12183157") { id first_name last_name gender active_tags { id name } } }
        `);
        console.log('  ', JSON.stringify(r?.user, null, 2));
    } catch (e: any) { console.log('ERR:', e.message); }

    // List all 10 tags again with full IDs verified
    console.log('\n--- All tags (re-verify) ---');
    try {
        const r = await healthieGraphQL<any>(`query { tags { id name created_at } }`);
        const tags = r?.tags || [];
        console.log(`(total: ${tags.length})`);
        for (const t of tags) console.log(`  id=${t.id}  "${t.name}"  created=${t.created_at}`);
    } catch (e: any) { console.log('ERR:', e.message); }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

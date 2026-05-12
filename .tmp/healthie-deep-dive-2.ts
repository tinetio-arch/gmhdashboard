import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

async function main() {
    // Get ALL tags (paginated)
    console.log('--- ALL Healthie tags ---');
    try {
        const r = await healthieGraphQL<any>(`query { tags(per_page: 200) { id name } }`);
        const tags = r?.tags || [];
        console.log(`(total: ${tags.length})`);
        for (const t of tags) console.log(`  id=${t.id}  "${t.name}"`);
    } catch (e: any) { console.log('ERR:', e.message); }

    // Find the apply-tag mutation (not in original list)
    console.log('\n--- Mutations matching "tag" or "apply" ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { __schema { mutationType { fields { name args { name type { name } } } } } }
        `);
        const muts = r?.__schema?.mutationType?.fields || [];
        const matched = muts.filter((m: any) => /tag|apply/i.test(m?.name || ''));
        for (const m of matched) {
            const args = (m.args || []).map((a: any) => `${a.name}:${a.type?.name || '?'}`).join(', ');
            console.log(`  ${m.name}(${args})`);
        }
    } catch (e: any) { console.log('ERR:', e.message); }

    // Check User type for tag-related fields (so we can see how tags relate to users)
    console.log('\n--- User type fields containing "tag" ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { __type(name: "User") { fields { name type { name kind ofType { name } } } } }
        `);
        const fields = r?.__type?.fields || [];
        const tagged = fields.filter((f: any) => /tag/i.test(f?.name || ''));
        for (const f of tagged) console.log(`  ${f.name}: ${f.type?.name || f.type?.ofType?.name || f.type?.kind}`);
    } catch (e: any) { console.log('ERR:', e.message); }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

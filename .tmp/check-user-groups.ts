import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

async function main() {
    // Introspect User type for any group-related field
    console.log('--- User type fields containing "group" ---');
    try {
        const r = await healthieGraphQL<any>(`query { __type(name: "User") { fields { name type { name kind ofType { name kind } } } } }`);
        const fields = r?.__type?.fields || [];
        for (const f of fields.filter((f: any) => /group|client_source|client_type/i.test(f?.name || ''))) {
            const t = f.type?.name || f.type?.ofType?.name || `${f.type?.kind}/${f.type?.ofType?.kind}`;
            console.log(`  ${f.name}: ${t}`);
        }
    } catch (e: any) { console.log('ERR:', e.message); }

    // Brandy: try every plausible group-y field
    console.log('\n--- Brandy (13959267) — try every group field ---');
    const queries = [
        `query { user(id: "13959267") { id user_group { id name } } }`,
        `query { user(id: "13959267") { id user_groups { id name } } }`,
        `query { user(id: "13959267") { id groups { id name } } }`,
        `query { user(id: "13959267") { id client_source { id name } } }`,
        `query { user(id: "13959267") { id client_type } }`,
        `query { user(id: "13959267") { id active_tags { id name } group_tags { id name } } }`,
        `query { user(id: "13959267") { id active_tags { id name } } }`,
    ];
    for (const q of queries) {
        try {
            const r = await healthieGraphQL<any>(q);
            console.log(`  ✓ ${q.replace(/\s+/g, ' ').slice(45, 110)}`);
            console.log(`    →`, JSON.stringify(r?.user, null, 2).slice(0, 400));
        } catch (e: any) {
            console.log(`  ✗ ${q.replace(/\s+/g, ' ').slice(45, 110)}`);
            console.log(`    → ${e.message.slice(0, 200)}`);
        }
    }

    // For comparison: a known TRT/Men's Health patient
    console.log('\n--- Phil Joswiak (13113511) for comparison ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { user(id: "13113511") { id first_name last_name gender active_tags { id name } } }
        `);
        console.log('  ', JSON.stringify(r?.user, null, 2));
    } catch (e: any) { console.log('ERR:', e.message); }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

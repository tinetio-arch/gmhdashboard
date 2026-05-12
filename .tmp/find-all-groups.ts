import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

async function main() {
    // Try to enumerate all UserGroups in Healthie
    console.log('--- All UserGroups (try multiple query names) ---');
    const queries = [
        `query { userGroups { id name } }`,
        `query { user_groups { id name } }`,
        `query { allUserGroups { id name } }`,
    ];
    for (const q of queries) {
        try {
            const r = await healthieGraphQL<any>(q);
            const key = Object.keys(r || {})[0];
            const arr = r?.[key];
            if (Array.isArray(arr)) {
                console.log(`  ✓ ${q.slice(0, 40)} → ${arr.length} groups`);
                for (const g of arr) console.log(`      id=${g.id}  "${g.name}"`);
                break;
            }
        } catch (e: any) {
            console.log(`  ✗ ${q.slice(0, 40)} → ${e.message.slice(0, 80)}`);
        }
    }

    // Verify known group IDs
    console.log('\n--- Known group IDs verify ---');
    try {
        const r = await healthieGraphQL<any>(`
            query {
                mh: userGroup(id: "75522") { id name }
                pc: userGroup(id: "75523") { id name }
                w:  userGroup(id: "81103") { id name }
                long: userGroup(id: "82532") { id name }
            }
        `);
        console.log('  ', JSON.stringify(r, null, 2));
    } catch (e: any) { console.log('ERR:', e.message); }

    // Get appointment types per group: longevity and ABX
    console.log('\n--- Appointment types: ALL (we will filter) ---');
    try {
        const r = await healthieGraphQL<any>(`query { appointmentTypes { id name length user_groups { id name } } }`);
        const types = r?.appointmentTypes || [];
        console.log(`  total: ${types.length}`);

        // Group appt types by their associated group
        const byGroup: Record<string, any[]> = {};
        for (const t of types) {
            const groups = t.user_groups || [];
            if (groups.length === 0) {
                (byGroup['__none__'] = byGroup['__none__'] || []).push(t);
            } else {
                for (const g of groups) {
                    const key = `${g.id}::${g.name}`;
                    (byGroup[key] = byGroup[key] || []).push(t);
                }
            }
        }
        for (const [key, ts] of Object.entries(byGroup)) {
            console.log(`\n  GROUP ${key}  (${ts.length} types)`);
            for (const t of ts.slice(0, 30)) console.log(`    id=${t.id}  ${t.length}min  "${t.name}"`);
        }
    } catch (e: any) {
        console.log('ERR (try without user_groups field):', e.message);
        // Fallback without user_groups association
        try {
            const r = await healthieGraphQL<any>(`query { appointmentTypes { id name length } }`);
            const types = r?.appointmentTypes || [];
            console.log(`  total: ${types.length}`);
            for (const t of types.slice(0, 80)) console.log(`    id=${t.id}  ${t.length}min  "${t.name}"`);
        } catch (e2: any) { console.log('ERR2:', e2.message); }
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

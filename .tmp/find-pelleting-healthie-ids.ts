/**
 * READ-ONLY: query Healthie for all pelleting/evexipel appointment types,
 * forms, and groups so we can map male-vs-female correctly. No writes.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

async function main() {
    console.log('\n--- APPOINTMENT TYPES (search: pellet/evexipel) ---');
    try {
        const apptRes = await healthieGraphQL<any>(`
            query { appointmentTypes { id name length is_group } }
        `);
        const types = apptRes?.appointmentTypes || [];
        const matched = types.filter((t: any) => /pellet|evexipel/i.test(t?.name || ''));
        for (const t of matched) {
            console.log(`  id=${t.id}  name="${t.name}"  length=${t.length}min  group=${t.is_group}`);
        }
        if (!matched.length) console.log('  (none matched — total appointment types fetched: ' + types.length + ')');
    } catch (e: any) {
        console.log('  ERROR:', e.message);
    }

    console.log('\n--- FORMS (search: pellet/evexipel) ---');
    try {
        const formRes = await healthieGraphQL<any>(`
            query { customModuleForms { id name } }
        `);
        const forms = formRes?.customModuleForms || [];
        const matched = forms.filter((f: any) => /pellet|evexipel|hormone|trt|hrt|testosterone/i.test(f?.name || ''));
        for (const f of matched) {
            console.log(`  id=${f.id}  name="${f.name}"`);
        }
        if (!matched.length) console.log('  (none matched — total forms: ' + forms.length + ')');
    } catch (e: any) {
        console.log('  ERROR:', e.message);
    }

    console.log('\n--- GROUPS (search: pellet/evexipel) ---');
    try {
        const grpRes = await healthieGraphQL<any>(`
            query { tagsForOrg { id name } }
        `);
        const grps = grpRes?.tagsForOrg || [];
        const matched = grps.filter((g: any) => /pellet|evexipel/i.test(g?.name || ''));
        for (const g of matched) {
            console.log(`  id=${g.id}  name="${g.name}"`);
        }
        if (!matched.length) console.log('  (none matched — total groups: ' + grps.length + ')');
    } catch (e: any) {
        // Try alternate group query name
        try {
            const grpRes2 = await healthieGraphQL<any>(`
                query { groupContacts { id name } }
            `);
            const grps2 = grpRes2?.groupContacts || [];
            const matched2 = grps2.filter((g: any) => /pellet|evexipel/i.test(g?.name || ''));
            for (const g of matched2) console.log(`  id=${g.id}  name="${g.name}"`);
            if (!matched2.length) console.log('  (none matched in groupContacts either)');
        } catch (e2: any) {
            console.log('  ERROR:', e.message, '|', e2.message);
        }
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

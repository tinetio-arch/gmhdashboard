/**
 * READ-ONLY: figure out everything we need for the pelleting tag system
 * without asking the user dumb questions. No writes.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';
import { query } from '../lib/db';

async function main() {
    // 1. Find ALL forms (no keyword filter) and look for hormone/pellet/intake
    console.log('--- ALL forms with intake/hormone/pellet/consent in name ---');
    try {
        const r = await healthieGraphQL<any>(`query { customModuleForms { id name } }`);
        const forms = r?.customModuleForms || [];
        console.log(`(total forms: ${forms.length})`);
        const interesting = forms.filter((f: any) => /hormone|pellet|intake|consent|trt|hrt|testosterone|male|female/i.test(f?.name || ''));
        for (const f of interesting) console.log(`  id=${f.id}  "${f.name}"`);
    } catch (e: any) { console.log('  ERR:', e.message); }

    // 2. Find the Healthie groups query (tags for org/customClientTypes/etc)
    console.log('\n--- Healthie groups ---');
    const groupQueries = [
        `query { groupContactTypes { id name } }`,
        `query { tags { id name } }`,
        `query { groups { id name } }`,
        `query { organization { tags { id name } } }`,
    ];
    for (const q of groupQueries) {
        try {
            const r = await healthieGraphQL<any>(q);
            const key = Object.keys(r || {})[0];
            const data = r?.[key];
            const arr = Array.isArray(data) ? data : data?.tags;
            if (Array.isArray(arr)) {
                console.log(`  ✓ ${q.replace(/\s+/g, ' ').slice(0, 60)} → ${arr.length} items`);
                const matched = arr.filter((g: any) => /pellet|evexipel/i.test(g?.name || ''));
                for (const g of matched) console.log(`      id=${g.id}  "${g.name}"`);
                if (!matched.length && arr.length > 0) console.log(`      (sample: ${arr.slice(0, 3).map((g: any) => g.name).join(' | ')})`);
                break;
            }
        } catch (e: any) {
            // ignore
        }
    }

    // Try fetching a specific known group by ID (75977 female pelleting, 78546 male)
    console.log('\n--- Verify known group IDs from SOT ---');
    try {
        const r = await healthieGraphQL<any>(`
            query {
                female: tag(id: "75977") { id name }
                male: tag(id: "78546") { id name }
            }
        `);
        console.log('  female (75977):', r?.female);
        console.log('  male (78546):', r?.male);
    } catch (e: any) { console.log('  tag(id:..) errored:', e.message); }

    // 3. Find female patients currently tagged 'evexipel' or 'pelleting' (test candidates)
    console.log('\n--- Test patient candidates (currently tagged) ---');
    try {
        const candidates = await query<any>(`
            SELECT pst.patient_id, pst.tag, p.full_name, p.healthie_client_id
            FROM patient_service_tags pst
            LEFT JOIN patients p ON p.patient_id::text = pst.patient_id
            WHERE pst.tag IN ('evexipel', 'pelleting')
            ORDER BY pst.added_at DESC
            LIMIT 20
        `);
        if (!candidates.length) console.log('  (none — table is empty for these tags)');
        for (const c of candidates) console.log(`  ${c.full_name || '(no name)'}  patient=${c.patient_id}  healthie=${c.healthie_client_id}  tag=${c.tag}`);
    } catch (e: any) { console.log('  ERR:', e.message); }

    // 4. Find Healthie mutation schema for adding patient to group
    console.log('\n--- Mutations available for groups/tags ---');
    try {
        const r = await healthieGraphQL<any>(`
            query { __schema { mutationType { fields { name description } } } }
        `);
        const muts = r?.__schema?.mutationType?.fields || [];
        const matched = muts.filter((m: any) => /tag|group|client_type|user/i.test(m?.name || '')).filter((m: any) => /tag|group|add|update.*user|bulkUpdate/i.test(m?.name || ''));
        for (const m of matched.slice(0, 25)) console.log(`  ${m.name}  — ${m.description || ''}`);
    } catch (e: any) { console.log('  ERR:', e.message); }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

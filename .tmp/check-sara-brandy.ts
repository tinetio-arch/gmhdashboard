import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '../lib/healthieApi';

const PATIENTS = [
    { name: 'Sara Saloner', healthie_id: '12743176' },
    { name: 'Brandy Campbell', healthie_id: '13959267' },
];

async function main() {
    // Introspect User type to find the form-related fields
    console.log('--- User fields containing "form" or "request" ---');
    try {
        const r = await healthieGraphQL<any>(`query { __type(name: "User") { fields { name type { name kind ofType { name } } } } }`);
        const fields = r?.__type?.fields || [];
        for (const f of fields.filter((f: any) => /form|request|completed|consent/i.test(f?.name || ''))) {
            console.log(`  ${f.name}: ${f.type?.name || f.type?.ofType?.name || f.type?.kind}`);
        }
    } catch (e: any) { console.log('ERR:', e.message); }

    for (const p of PATIENTS) {
        console.log(`\n========================================`);
        console.log(`${p.name} (healthie ${p.healthie_id})`);
        console.log(`========================================`);

        // Demographics + tags
        try {
            const r = await healthieGraphQL<any>(`
                query($id: ID) {
                    user(id: $id) {
                        id first_name last_name gender dob email phone_number
                        active_tags { id name }
                        next_appt_date
                    }
                }
            `, { id: p.healthie_id });
            console.log('  Demographics:', JSON.stringify(r?.user, null, 2));
        } catch (e: any) { console.log('  ERR demographics:', e.message); }

        // Form answer groups (completed forms)
        try {
            const r = await healthieGraphQL<any>(`
                query($id: String) {
                    formAnswerGroups(user_id: $id) {
                        id name finished
                        custom_module_form { id name }
                        created_at
                    }
                }
            `, { id: p.healthie_id });
            const groups = r?.formAnswerGroups || [];
            console.log(`\n  formAnswerGroups (${groups.length}):`);
            for (const g of groups) {
                console.log(`    [${g.finished ? '✓ FINISHED' : '○ pending'}] form="${g.custom_module_form?.name || g.name || '?'}" formId=${g.custom_module_form?.id} created=${g.created_at}`);
            }
        } catch (e: any) { console.log('  ERR formAnswerGroups:', e.message); }

        // Requested forms (form_request_url type entities)
        try {
            const r = await healthieGraphQL<any>(`
                query($id: String) {
                    requestedFormCompletions(user_id: $id) {
                        id custom_module_form { id name }
                    }
                }
            `, { id: p.healthie_id });
            const reqs = r?.requestedFormCompletions || [];
            console.log(`\n  requestedFormCompletions (${reqs.length}):`);
            for (const q of reqs) {
                console.log(`    pending: form="${q.custom_module_form?.name}" id=${q.custom_module_form?.id}`);
            }
        } catch (e: any) { console.log('  ERR requestedFormCompletions:', e.message); }
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

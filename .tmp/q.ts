import { config } from 'dotenv';
config({ path: '.env.local' });
import { healthieGraphQL } from '/home/ec2-user/gmhdashboard/lib/healthieApi';
async function main() {
    const r = await healthieGraphQL<any>(`query { appointmentTypes { id name length user_group_id } }`);
    const types = r?.appointmentTypes || [];
    const byGroup: Record<string, any[]> = {};
    for (const t of types) {
        const k = t.user_group_id || '__none__';
        (byGroup[k] = byGroup[k] || []).push(t);
    }
    const groupNames: Record<string, string> = {
        '75522': 'NowMensHealth.Care', '75523': 'NowPrimary.Care',
        '82532': 'NowLongevity.Care', '82533': 'NowMentalHealth.Care',
        '82534': 'ABXTAC', '77894': 'Sick Visit',
    };
    for (const [gid, ts] of Object.entries(byGroup).sort()) {
        console.log(`\n[${gid}] ${groupNames[gid] || '(unknown/none)'}  — ${ts.length} types`);
        for (const t of ts) console.log(`  ${t.id}  ${String(t.length).padStart(3)}min  "${t.name}"`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

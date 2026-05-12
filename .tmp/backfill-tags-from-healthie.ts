/**
 * Local tag backfill: mirror every patient's Healthie active_tags into
 * local patient_service_tags. Read-only Healthie; local INSERT ... ON CONFLICT DO NOTHING.
 * No deletes. No overwrites. Test-debug tags skipped.
 *
 * Run: npx tsx .tmp/backfill-tags-from-healthie.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import { healthieGraphQL } from '../lib/healthieApi';

const SKIP_TAG_NAMES = new Set(['test-debug']);

async function main() {
    const patients = await query<{ patient_id: string; healthie_client_id: string; full_name: string }>(`
      SELECT patient_id::text AS patient_id, healthie_client_id, full_name
      FROM patients
      WHERE healthie_client_id IS NOT NULL
      ORDER BY date_added DESC NULLS LAST
    `);
    console.log(`[backfill] ${patients.length} patients with Healthie IDs to check`);

    let totalTags = 0, totalInserts = 0, patientsWithTags = 0, errors = 0;
    const tagFrequency: Record<string, number> = {};
    const inserted: Array<{ name: string; tags: string[] }> = [];

    for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        if (i % 25 === 0) console.log(`[backfill] ${i}/${patients.length}...`);
        try {
            const r = await healthieGraphQL<any>(`query($id: ID) { user(id: $id) { id active_tags { id name } } }`, { id: p.healthie_client_id });
            const tags: Array<{ id: string; name: string }> = r?.user?.active_tags || [];
            if (!tags.length) continue;
            patientsWithTags++;
            totalTags += tags.length;

            const inserts: string[] = [];
            for (const t of tags) {
                const name = t?.name?.trim();
                if (!name || SKIP_TAG_NAMES.has(name)) continue;
                tagFrequency[name] = (tagFrequency[name] || 0) + 1;
                const res = await query<{ id: number }>(
                    `INSERT INTO patient_service_tags (patient_id, healthie_user_id, tag, added_by, added_at)
                     VALUES ($1, $2, $3, 'backfill:healthie-active-tags', NOW())
                     ON CONFLICT (patient_id, tag) DO NOTHING
                     RETURNING id`,
                    [p.patient_id, p.healthie_client_id, name]
                );
                if (res.length) { totalInserts++; inserts.push(name); }
            }
            if (inserts.length) inserted.push({ name: p.full_name || p.healthie_client_id, tags: inserts });
        } catch (e: any) {
            errors++;
            if (errors <= 5) console.log(`  ERR ${p.full_name}: ${e.message.slice(0, 120)}`);
        }
    }

    console.log(`\n=== BACKFILL COMPLETE ===`);
    console.log(`Patients scanned:         ${patients.length}`);
    console.log(`Patients with ≥1 tag:     ${patientsWithTags}`);
    console.log(`Total Healthie tags seen: ${totalTags}`);
    console.log(`Rows inserted (new):      ${totalInserts}`);
    console.log(`Errors:                   ${errors}`);
    console.log(`\nTag frequency:`);
    for (const [tag, n] of Object.entries(tagFrequency).sort((a, b) => b[1] - a[1])) console.log(`  ${tag}: ${n}`);
    console.log(`\nFirst 30 patients who received new tag rows:`);
    for (const p of inserted.slice(0, 30)) console.log(`  ${p.name}: ${p.tags.join(', ')}`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

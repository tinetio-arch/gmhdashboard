/**
 * Legacy tag cleanup: audit + migrate + remove.
 *
 * Phase 1: Audit (read-only)
 * Phase 2: Migrate Veteran/FF → Interesting notes
 * Phase 3: Ensure Primary Care + Pelleting patients have pelleting tag
 * Phase 4: Remove all legacy tags from Healthie + local
 *
 * Run: cd ~/gmhdashboard && npx tsx .tmp/tag-cleanup.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import { healthieGraphQL } from '../lib/healthieApi';

const LEGACY_TAGS: Record<string, { id: string; action: string }> = {
    'Veteran / FF':                   { id: '72655', action: 'move-to-interesting' },
    'Primary + Mens Health Client':   { id: '72659', action: 'remove' },
    'Primary Care + Pelleting':       { id: '77508', action: 'ensure-pelleting-then-remove' },
    'cash pay':                       { id: '85267', action: 'move-to-notes' },
    'mens-health':                    { id: '82916', action: 'remove' },
    'primary-care':                   { id: '82917', action: 'remove' },
};

async function main() {
    console.log('=== PHASE 1: AUDIT ===\n');

    // Get all patients with legacy tags in local DB
    const localLegacy = await query<{ patient_id: string; healthie_user_id: string; tag: string }>(
        `SELECT patient_id, healthie_user_id, tag FROM patient_service_tags WHERE tag = ANY($1)`,
        [Object.keys(LEGACY_TAGS)]
    );
    console.log(`Local legacy tag rows: ${localLegacy.length}`);

    // Group by tag
    const byTag = new Map<string, typeof localLegacy>();
    for (const r of localLegacy) {
        if (!byTag.has(r.tag)) byTag.set(r.tag, []);
        byTag.get(r.tag)!.push(r);
    }

    for (const [tagName, config] of Object.entries(LEGACY_TAGS)) {
        const patients = byTag.get(tagName) || [];
        console.log(`\n--- ${tagName} (Healthie tag ${config.id}) — ${patients.length} patients — action: ${config.action} ---`);
        for (const p of patients) {
            const [local] = await query<any>(
                `SELECT full_name, healthie_client_id, client_type_key, notes FROM patients WHERE patient_id = $1`,
                [p.patient_id]
            );
            console.log(`  ${local?.full_name || '?'} (healthie ${p.healthie_user_id}) type=${local?.client_type_key || '—'}`);
        }
    }

    console.log('\n\n=== PHASE 2: MIGRATE ===\n');

    // Veteran / FF → Interesting notes
    const vetPatients = byTag.get('Veteran / FF') || [];
    console.log(`Moving "Veteran / FF" to Interesting notes for ${vetPatients.length} patients...`);
    for (const p of vetPatients) {
        const [local] = await query<any>(`SELECT full_name, notes FROM patients WHERE patient_id = $1`, [p.patient_id]);
        const existingNotes = (local?.notes || '').trim();
        const vetNote = 'Veteran / First Responder';
        if (existingNotes.toLowerCase().includes('veteran') || existingNotes.toLowerCase().includes('first responder')) {
            console.log(`  ${local?.full_name}: already has veteran note — skip`);
        } else {
            const newNotes = existingNotes ? `${existingNotes}\n${vetNote}` : vetNote;
            await query(`UPDATE patients SET notes = $1, updated_at = NOW() WHERE patient_id = $2`, [newNotes, p.patient_id]);
            console.log(`  ${local?.full_name}: added "${vetNote}" to notes`);
        }
    }

    // cash pay → notes
    const cashPatients = byTag.get('cash pay') || [];
    for (const p of cashPatients) {
        const [local] = await query<any>(`SELECT full_name, notes, payment_method_key FROM patients WHERE patient_id = $1`, [p.patient_id]);
        const existingNotes = (local?.notes || '').trim();
        if (!existingNotes.toLowerCase().includes('cash pay')) {
            const newNotes = existingNotes ? `${existingNotes}\nCash pay patient` : 'Cash pay patient';
            await query(`UPDATE patients SET notes = $1, updated_at = NOW() WHERE patient_id = $2`, [newNotes, p.patient_id]);
            console.log(`  ${local?.full_name}: added "Cash pay" to notes`);
        }
    }

    console.log('\n=== PHASE 3: ENSURE PELLETING TAG ===\n');

    // Primary Care + Pelleting → ensure pelleting tag exists
    const pelletCombo = byTag.get('Primary Care + Pelleting') || [];
    for (const p of pelletCombo) {
        const [local] = await query<any>(`SELECT full_name FROM patients WHERE patient_id = $1`, [p.patient_id]);
        // Check if they already have pelleting tag
        const [has] = await query<{ id: number }>(`SELECT id FROM patient_service_tags WHERE patient_id = $1 AND tag = 'pelleting'`, [p.patient_id]);
        if (has) {
            console.log(`  ${local?.full_name}: already has pelleting tag ✓`);
        } else {
            await query(
                `INSERT INTO patient_service_tags (patient_id, healthie_user_id, tag, added_by, added_at) VALUES ($1, $2, 'pelleting', 'tag-cleanup-migration', NOW()) ON CONFLICT DO NOTHING`,
                [p.patient_id, p.healthie_user_id]
            );
            console.log(`  ${local?.full_name}: added pelleting tag`);
        }
        // Also apply pelleting tag in Healthie
        try {
            await healthieGraphQL<any>(`mutation($input: bulkApplyInput!) { bulkApply(input: $input) { tags { id name } } }`, { input: { ids: ['82887'], taggable_user_id: p.healthie_user_id } });
            console.log(`  ${local?.full_name}: applied pelleting tag in Healthie ✓`);
        } catch (e: any) {
            console.warn(`  ${local?.full_name}: Healthie pelleting apply failed: ${e.message}`);
        }
    }

    console.log('\n=== PHASE 4: REMOVE LEGACY TAGS ===\n');

    for (const [tagName, cfg] of Object.entries(LEGACY_TAGS)) {
        const patients = byTag.get(tagName) || [];
        if (!patients.length) { console.log(`${tagName}: no patients, skipping`); continue; }

        console.log(`Removing "${tagName}" from ${patients.length} patients...`);
        for (const p of patients) {
            const [local] = await query<any>(`SELECT full_name FROM patients WHERE patient_id = $1`, [p.patient_id]);
            // Remove from Healthie
            try {
                await healthieGraphQL<any>(
                    `mutation($input: removeAppliedTagInput!) { removeAppliedTag(input: $input) { tag { id } } }`,
                    { input: { id: cfg.id, taggable_user_id: p.healthie_user_id } }
                );
                console.log(`  ✓ ${local?.full_name}: removed "${tagName}" from Healthie`);
            } catch (e: any) {
                console.warn(`  ✗ ${local?.full_name}: Healthie removal failed: ${e.message}`);
            }
            // Remove from local DB
            await query(`DELETE FROM patient_service_tags WHERE patient_id = $1 AND tag = $2`, [p.patient_id, tagName]);
        }
    }

    // Final verification
    console.log('\n=== VERIFICATION ===\n');
    const remaining = await query<{ tag: string; n: string }>(
        `SELECT tag, COUNT(*)::text AS n FROM patient_service_tags WHERE tag = ANY($1) GROUP BY tag`,
        [Object.keys(LEGACY_TAGS)]
    );
    if (remaining.length === 0) {
        console.log('✅ All legacy tags removed from local DB');
    } else {
        console.log('⚠️ Remaining legacy tags:', remaining);
    }

    // Spot-check a few patients in Healthie
    const spotCheck = vetPatients.slice(0, 3);
    for (const p of spotCheck) {
        const h = await healthieGraphQL<any>(`query($id: ID) { user(id: $id) { id active_tags { id name } } }`, { id: p.healthie_user_id });
        const tags = (h?.user?.active_tags || []).map((t: any) => t.name);
        const [local] = await query<any>(`SELECT full_name FROM patients WHERE patient_id = $1`, [p.patient_id]);
        const hasLegacy = tags.some((t: string) => Object.keys(LEGACY_TAGS).includes(t));
        console.log(`${local?.full_name}: Healthie tags = [${tags.join(', ')}] ${hasLegacy ? '⚠️ STILL HAS LEGACY' : '✅ clean'}`);
    }

    console.log('\nDone.');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

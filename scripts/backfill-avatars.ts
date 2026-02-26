/**
 * One-time script to backfill avatar_url for all patients.
 * 
 * Uses healthie_clients join table to get Healthie IDs,
 * then queries Healthie API for each patient's avatar_url.
 * 
 * Run with: cd /home/ec2-user/gmhdashboard && npx tsx scripts/backfill-avatars.ts
 */

import { query, getPool } from '../lib/db';
import { createHealthieClient } from '../lib/healthie';

const BATCH_SIZE = 10;
const DELAY_MS = 1500; // Between batches

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    const healthie = createHealthieClient();
    if (!healthie) {
        console.error('Healthie client not configured. Set HEALTHIE_API_KEY.');
        process.exit(1);
    }

    console.log('=== Avatar Backfill ===');
    console.log(`Batch size: ${BATCH_SIZE}, Delay: ${DELAY_MS}ms`);

    // Get all patient→healthie mappings
    const mappings = await query<{
        patient_id: string;
        full_name: string;
        healthie_client_id: string;
        avatar_url: string | null;
    }>(`
    SELECT p.patient_id, p.full_name, hc.healthie_client_id, p.avatar_url
    FROM patients p
    JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text
    WHERE hc.is_active = true
  `);

    console.log(`Found ${mappings.length} patient-Healthie mappings`);

    const toProcess = mappings.filter(m => !m.avatar_url);
    const alreadySet = mappings.length - toProcess.length;
    console.log(`${alreadySet} already have avatars, ${toProcess.length} to check\n`);

    let updated = 0;
    let noAvatar = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
        console.log(`[Batch ${batchNum}/${totalBatches}]`);

        for (const m of batch) {
            try {
                const client = await healthie.getClient(m.healthie_client_id);
                // The getClient method likely doesn't return avatar_url,
                // so we'll use graphql directly via fetch
                const apiKey = process.env.HEALTHIE_API_KEY!;
                const apiUrl = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${apiKey}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `query($id: ID) { user(id: $id) { id avatar_url } }`,
                        variables: { id: m.healthie_client_id },
                    }),
                });

                if (!res.ok) {
                    console.log(`  ❌ ${m.full_name}: HTTP ${res.status}`);
                    errors++;
                    continue;
                }

                const json = await res.json();
                const avatarUrl = json?.data?.user?.avatar_url;

                if (!avatarUrl) {
                    noAvatar++;
                    continue;
                }

                await query(
                    `UPDATE patients SET avatar_url = $1, updated_at = NOW() WHERE patient_id = $2`,
                    [avatarUrl, m.patient_id]
                );
                updated++;
                console.log(`  ✅ ${m.full_name}`);
            } catch (err: any) {
                errors++;
                console.log(`  ❌ ${m.full_name}: ${err.message}`);
            }
        }

        // Rate limit between batches
        if (i + BATCH_SIZE < toProcess.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\n=== Done ===`);
    console.log(`Updated: ${updated}`);
    console.log(`Already set: ${alreadySet}`);
    console.log(`No avatar in Healthie: ${noAvatar}`);
    console.log(`Errors: ${errors}`);

    // Close pool
    const pool = getPool();
    await pool.end();
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});

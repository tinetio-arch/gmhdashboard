/**
 * Script to merge duplicate patient records
 * Deactivates the second (duplicate) record for each pair
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from 'pg';
import { transitionStatus } from '../lib/status-transitions';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

// Duplicate pairs: keep first, deactivate second
// These were identified as same person with multiple records
const duplicates = [
    { pair: 'Greg Lucas / Gregory Lucas', keepId: '56538500-7a03-415f-b2a0-56aba16f1ad2', deactivateId: '0c15ab46-4e77-48fb-aa60-d2b0c397385a' },
    { pair: 'Joseph Sirochman x2', keepId: '9e33f65d-3d0e-4e53-9405-01efd78c0bd2', deactivateId: 'c8aa39ab-77b9-42b2-91c3-f18a1e29a6f4' },
    { pair: 'Jacob Jackson x2', keepId: '2abd8403-70db-479c-af61-3ba81543a607', deactivateId: '0573c368-1d5a-47fc-a356-083ccd95f38f' },
];

async function mergeDuplicates() {
    console.log('Merging duplicate patients...');
    console.log('='.repeat(60));

    for (const dup of duplicates) {
        console.log(`\n${dup.pair}:`);
        console.log(`  KEEP: ${dup.keepId}`);
        console.log(`  DEACTIVATE: ${dup.deactivateId}`);

        // Mark the duplicate as inactive (via chokepoint helper + secondary GHL fields)
        const t = await transitionStatus({
            patientId: dup.deactivateId,
            toStatus: 'inactive',
            source: 'script:merge-duplicate-patients',
            actor: 'system',
            reason: `Duplicate record - merged with ${dup.keepId}`,
            metadata: { fn: 'merge-duplicate-patients', keepId: dup.keepId, pair: dup.pair },
        });

        if (t.applied) {
            await pool.query(`
                UPDATE patients
                   SET ghl_sync_status = 'skipped',
                       ghl_sync_error = 'Duplicate record - merged with ' || $2
                 WHERE patient_id = $1::uuid
            `, [dup.deactivateId, dup.keepId]);
            console.log(`  ✅ Deactivated duplicate`);
        } else if (t.blocked) {
            console.log(`  ⚠️ Blocked: ${t.blockReason}`);
        } else {
            console.log(`  ⚠️ Duplicate record not applied (from=${t.fromStatus})`);
        }

        // Reset the kept patient to pending for sync
        const result2 = await pool.query(`
      UPDATE patients 
      SET ghl_sync_status = 'pending',
          ghl_sync_error = NULL
      WHERE patient_id = $1
      RETURNING patient_id
    `, [dup.keepId]);

        if (result2.rowCount && result2.rowCount > 0) {
            console.log(`  ✅ Reset kept record for sync`);
        } else {
            console.log(`  ⚠️ Kept record not found`);
        }
    }

    await pool.end();
    console.log('\nMerge complete!');
}

mergeDuplicates();

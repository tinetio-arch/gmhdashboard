#!/usr/bin/env npx tsx
/**
 * One-time repair script: Fix lab dates for approved Pre Required labs
 *
 * Root cause: updatePatientLabDates() in review-queue/route.ts used item.patient_id
 * (a numeric Healthie ID) as a UUID, causing "invalid input syntax for type uuid" errors.
 * The catch block silently swallowed the error, so approvals succeeded but dates never updated.
 *
 * This script:
 * 1. Finds all approved Pre Required labs
 * 2. Resolves the correct patient UUID via healthie_client_id
 * 3. Parses collection_date (MM/DD/YYYY) → ISO date
 * 4. Sets last_lab_date = collection_date, next_lab_date = +1 year
 * 5. Only updates if current dates are NULL or older than the collection_date
 *
 * Usage:
 *   DRY RUN:  npx tsx .tmp/fix-lab-dates.ts
 *   EXECUTE:  npx tsx .tmp/fix-lab-dates.ts --execute
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query, getPool } from '../lib/db';
import { computeLabStatus } from '../lib/patientFormatting';

interface QueueRow {
    queue_id: string;
    patient_name: string;
    collection_date: string;
    approved_at: string;
    healthie_id: string;
    patient_uuid: string;
    current_last_lab: string | null;
    current_next_lab: string | null;
    has_labs_row: boolean;
}

/** Parse MM/DD/YYYY → YYYY-MM-DD */
function parseCollectionDate(raw: string): string | null {
    if (!raw) return null;
    // Handle MM/DD/YYYY format
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        const [, mm, dd, yyyy] = match;
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    // Handle YYYY-MM-DD format (already ISO)
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return null;
}

async function main() {
    const execute = process.argv.includes('--execute');
    console.log(`\n${execute ? '🔧 EXECUTE MODE' : '👀 DRY RUN MODE'} — Lab Date Repair Script\n`);

    // Find all approved Pre Required labs, deduplicated to latest per patient
    const rows = await query<QueueRow>(`
        WITH ranked AS (
            SELECT
                q.id as queue_id,
                q.patient_name,
                q.collection_date,
                q.approved_at,
                q.healthie_id,
                p.patient_id as patient_uuid,
                l.last_lab_date::text as current_last_lab,
                l.next_lab_date::text as current_next_lab,
                (l.patient_id IS NOT NULL) as has_labs_row,
                ROW_NUMBER() OVER (
                    PARTITION BY p.patient_id
                    ORDER BY q.approved_at DESC
                ) as rn
            FROM lab_review_queue q
            JOIN patients p ON p.healthie_client_id = q.healthie_id
            LEFT JOIN labs l ON l.patient_id = p.patient_id
            WHERE q.status = 'approved'
              AND q.tests_found::text ILIKE '%pre required%'
              AND p.patient_id IS NOT NULL
        )
        SELECT queue_id, patient_name, collection_date, approved_at,
               healthie_id, patient_uuid, current_last_lab, current_next_lab, has_labs_row
        FROM ranked
        WHERE rn = 1
        ORDER BY approved_at DESC
    `);

    console.log(`Found ${rows.length} unique patients with approved Pre Required labs\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const row of rows) {
        const isoDate = parseCollectionDate(row.collection_date);
        if (!isoDate) {
            console.log(`  ❌ ${row.patient_name}: could not parse collection_date "${row.collection_date}"`);
            errorCount++;
            continue;
        }

        // Calculate next_lab_date = collection_date + 1 year
        const nextDate = new Date(isoDate + 'T00:00:00Z');
        nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);
        const nextLabDate = nextDate.toISOString().slice(0, 10);

        // Check if update is needed
        const currentLastLab = row.current_last_lab;
        if (currentLastLab && currentLastLab >= isoDate) {
            console.log(`  ⏭️  ${row.patient_name}: current last_lab (${currentLastLab}) >= collection (${isoDate}) — skipping`);
            skippedCount++;
            continue;
        }

        // Compute lab status
        const labStatusInfo = computeLabStatus(isoDate, nextLabDate);

        const action = currentLastLab === null && !row.has_labs_row
            ? 'INSERT'
            : currentLastLab === null
            ? 'UPDATE (was NULL)'
            : `UPDATE (${currentLastLab} → ${isoDate})`;

        console.log(`  ${execute ? '✅' : '📋'} ${row.patient_name}: ${action} | last=${isoDate} next=${nextLabDate} status="${labStatusInfo.label}"`);

        if (execute) {
            try {
                const pool = getPool();

                if (row.has_labs_row) {
                    // Update existing labs row
                    await pool.query(
                        `UPDATE labs SET last_lab_date = $2, next_lab_date = $3, lab_status = $4, updated_at = NOW()
                         WHERE patient_id = $1`,
                        [row.patient_uuid, isoDate, nextLabDate, labStatusInfo.label]
                    );
                } else {
                    // Insert new labs row
                    await pool.query(
                        `INSERT INTO labs (patient_id, last_lab_date, next_lab_date, lab_status)
                         VALUES ($1, $2, $3, $4)`,
                        [row.patient_uuid, isoDate, nextLabDate, labStatusInfo.label]
                    );
                }

                // Also update patients.lab_status
                await pool.query(
                    `UPDATE patients SET lab_status = $2, updated_at = NOW() WHERE patient_id = $1`,
                    [row.patient_uuid, labStatusInfo.label]
                );

                fixedCount++;
            } catch (err) {
                console.error(`  ❌ ${row.patient_name}: DB error:`, err);
                errorCount++;
            }
        } else {
            fixedCount++;
        }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`  ${execute ? 'Fixed' : 'Would fix'}: ${fixedCount}`);
    console.log(`  Skipped (already current): ${skippedCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Total: ${rows.length}`);

    if (!execute && fixedCount > 0) {
        console.log(`\n💡 Run with --execute to apply changes:`);
        console.log(`   npx tsx .tmp/fix-lab-dates.ts --execute\n`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

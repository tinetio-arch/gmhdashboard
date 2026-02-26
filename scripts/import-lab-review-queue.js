/**
 * One-time import script: Load labs-review-queue.json into the lab_review_queue PostgreSQL table.
 *
 * Usage:
 *   node scripts/import-lab-review-queue.js
 *
 * Prerequisites:
 *   - The migration 20260226_lab_review_queue.sql must have been run first.
 *   - .env.production must have DATABASE_* vars set.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.production') });

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: Number(process.env.DATABASE_PORT || 5432),
    ssl: {
        rejectUnauthorized: false
    }
});

const JSON_FILE = path.join(__dirname, '..', 'data', 'labs-review-queue.json');

async function importData() {
    const client = await pool.connect();

    try {
        console.log('Reading JSON file...');
        const raw = fs.readFileSync(JSON_FILE, 'utf-8');
        const items = JSON.parse(raw);
        console.log(`Loaded ${items.length} records from JSON`);

        console.log('Starting import...');
        let inserted = 0;
        let skipped = 0;
        let errors = 0;

        // Use a transaction for the whole batch
        await client.query('BEGIN');

        for (const item of items) {
            try {
                await client.query(
                    `INSERT INTO lab_review_queue (
            id, source, accession, patient_name, dob, gender,
            collection_date, healthie_id, patient_id, match_confidence,
            matched_name, top_matches, tests_found, status,
            created_at, uploaded_at, approved_at,
            healthie_document_id, healthie_lab_order_id,
            rejection_reason, pdf_path, s3_key, upload_status,
            severity, critical_tests, approved_by,
            email_id, batch_date, batch_time, raw_result, patient_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17,
            $18, $19,
            $20, $21, $22, $23,
            $24, $25, $26,
            $27, $28, $29, $30, $31
          )
          ON CONFLICT (id) DO NOTHING`,
                    [
                        item.id,
                        item.source || null,
                        item.accession || null,
                        item.patient_name,
                        item.dob || null,
                        item.gender || null,
                        item.collection_date || null,
                        item.healthie_id || null,
                        item.patient_id || null,
                        item.match_confidence != null ? item.match_confidence : null,
                        item.matched_name || null,
                        item.top_matches ? JSON.stringify(item.top_matches) : null,
                        item.tests_found ? JSON.stringify(item.tests_found) : null,
                        item.status || 'pending_review',
                        item.created_at ? new Date(item.created_at) : new Date(),
                        item.uploaded_at ? new Date(item.uploaded_at) : null,
                        item.approved_at ? new Date(item.approved_at) : null,
                        item.healthie_document_id || null,
                        item.healthie_lab_order_id || null,
                        item.rejection_reason || null,
                        item.pdf_path || null,
                        item.s3_key || null,
                        item.upload_status || null,
                        item.severity != null ? item.severity : null,
                        item.critical_tests ? JSON.stringify(item.critical_tests) : null,
                        item.approved_by || null,
                        item.email_id || null,
                        item.batch_date || null,
                        item.batch_time || null,
                        item.raw_result ? JSON.stringify(item.raw_result) : null,
                        item.patient_active != null ? item.patient_active : null,
                    ]
                );
                inserted++;
            } catch (err) {
                if (err.code === '23505') {
                    // Duplicate key — already imported
                    skipped++;
                } else {
                    errors++;
                    console.error(`Error importing item ${item.id}:`, err.message);
                }
            }

            // Progress logging every 100 records
            if ((inserted + skipped + errors) % 100 === 0) {
                console.log(`  Progress: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
            }
        }

        await client.query('COMMIT');

        console.log('\n=== Import Complete ===');
        console.log(`  Inserted: ${inserted}`);
        console.log(`  Skipped (duplicates): ${skipped}`);
        console.log(`  Errors: ${errors}`);
        console.log(`  Total processed: ${inserted + skipped + errors}`);

        // Verify count
        const { rows } = await client.query('SELECT COUNT(*) as count FROM lab_review_queue');
        console.log(`  Rows in table: ${rows[0].count}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Import failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

importData().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

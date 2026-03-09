#!/usr/bin/env npx tsx
/**
 * Backfill patients.healthie_client_id from healthie_clients table
 * 
 * The auto-link-healthie.ts script populates the healthie_clients junction table,
 * but the iPad app reads patients.healthie_client_id directly. This script copies
 * the mapping from healthie_clients → patients.healthie_client_id so the iPad
 * shows correct ✅/❌ Healthie badges and the schedule view can match appointments
 * to local patients.
 * 
 * Usage: npx tsx scripts/backfill-healthie-ids.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('🔗 Backfill patients.healthie_client_id from healthie_clients table\n');

    // Check current state
    const before = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(healthie_client_id) as has_healthie,
            COUNT(*) - COUNT(healthie_client_id) as missing_healthie
        FROM patients WHERE status_key = 'Active'
    `);
    const stats = before.rows[0];
    console.log(`Before: ${stats.total} active patients, ${stats.has_healthie} have healthie_client_id, ${stats.missing_healthie} missing\n`);

    // Copy healthie_client_id from healthie_clients to patients
    const result = await pool.query(`
        UPDATE patients p
        SET healthie_client_id = hc.healthie_client_id
        FROM healthie_clients hc
        WHERE hc.patient_id::text = p.patient_id::text
          AND hc.is_active = TRUE
          AND (p.healthie_client_id IS NULL OR p.healthie_client_id = '')
    `);

    console.log(`✅ Updated ${result.rowCount} patients with healthie_client_id from healthie_clients table\n`);

    // Check after
    const after = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(healthie_client_id) as has_healthie,
            COUNT(*) - COUNT(healthie_client_id) as missing_healthie
        FROM patients WHERE status_key = 'Active'
    `);
    const statsAfter = after.rows[0];
    console.log(`After: ${statsAfter.total} active patients, ${statsAfter.has_healthie} have healthie_client_id, ${statsAfter.missing_healthie} still missing`);

    if (parseInt(statsAfter.missing_healthie) > 0) {
        console.log(`\n⚠️  ${statsAfter.missing_healthie} patients still have no Healthie link.`);
        console.log('    Run scripts/auto-link-healthie.ts to search Healthie by email/phone and create links.');
    }

    await pool.end();
}

run().catch(console.error);

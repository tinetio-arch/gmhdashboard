#!/usr/bin/env npx tsx
/**
 * GHL Bulk Sync Script
 * Syncs pending Men's Health patients to GoHighLevel
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
    try {
        console.log('🔄 GHL Bulk Sync - Starting...\n');

        // Get count of patients needing sync
        const countResult = await pool.query(`
      SELECT COUNT(*) as cnt
      FROM patients
      WHERE (ghl_contact_id IS NULL OR ghl_sync_status = 'pending')
        AND (status_key IS NULL OR status_key NOT IN ('inactive'))
        AND (clinic IS NULL OR clinic = 'nowmenshealth.care' OR clinic = '')
    `);

        const totalNeedingSync = parseInt(countResult.rows[0].cnt);
        console.log(`Found ${totalNeedingSync} patients needing GHL sync\n`);

        // Mark all as pending for sync
        const updateResult = await pool.query(`
      UPDATE patients
      SET ghl_sync_status = 'pending',
          updated_at = NOW()
      WHERE (ghl_contact_id IS NULL OR ghl_sync_status IS NULL)
        AND (status_key IS NULL OR status_key NOT IN ('inactive'))
        AND (clinic IS NULL OR clinic = 'nowmenshealth.care' OR clinic = '')
      RETURNING patient_id, full_name
    `);

        console.log(`✅ Marked ${updateResult.rows.length} patients as pending sync`);

        // Show current linkage stats
        const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(CASE WHEN ghl_contact_id IS NOT NULL THEN 1 END) as has_ghl,
        COUNT(CASE WHEN ghl_sync_status = 'synced' THEN 1 END) as synced,
        COUNT(CASE WHEN ghl_sync_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN ghl_sync_status = 'error' THEN 1 END) as errors
      FROM patients
      WHERE status_key IS NULL OR status_key != 'inactive'
    `);

        const stats = statsResult.rows[0];
        console.log('\n📊 Current GHL Linkage Stats:');
        console.log(`   Total Active: ${stats.total_patients}`);
        console.log(`   Has GHL ID: ${stats.has_ghl}`);
        console.log(`   Synced: ${stats.synced}`);
        console.log(`   Pending: ${stats.pending}`);
        console.log(`   Errors: ${stats.errors}`);

        console.log('\n✅ To complete sync, use the dashboard: Admin → GHL Sync');
        console.log('   Or run: curl -X POST http://localhost:3000/ops/api/admin/ghl/sync -d \'{"syncPending":true}\'');

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await pool.end();
    }
}

run();

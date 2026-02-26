#!/usr/bin/env tsx
/**
 * Manual Healthie Access Revocation Script
 * 
 * Manually revokes access in Healthie for patients where sync failed.
 * Updates app_access_controls to mark sync as successful.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query, getPool } from '../lib/db';
import { HealthieClient } from '../lib/healthie';

interface Patient {
    patient_id: string;
    full_name: string;
    email: string | null;
    healthie_client_id: string | null;
}

async function main() {
    const email = process.argv[2];
    const patientId = process.argv[3];

    if (!email && !patientId) {
        console.error('Usage: npx tsx scripts/manual-revoke-healthie.ts --email <email>');
        console.error('   or: npx tsx scripts/manual-revoke-healthie.ts --patient <patient_id>');
        process.exit(1);
    }

    // Find patient
    let patient: Patient | undefined;

    if (email) {
        const results = await query<Patient>(`
      SELECT patient_id, full_name, email, healthie_client_id
      FROM patients
      WHERE email ILIKE $1
      LIMIT 1;
    `, [email]);
        patient = results[0];
    } else {
        const results = await query<Patient>(`
      SELECT patient_id, full_name, email, healthie_client_id
      FROM patients
      WHERE patient_id = $1
      LIMIT 1;
    `, [patientId]);
        patient = results[0];
    }

    if (!patient) {
        console.error(`❌ Patient not found: ${email || patientId}`);
        process.exit(1);
    }

    console.log(`\n📋 Patient Found:`);
    console.log(`   Name: ${patient.full_name}`);
    console.log(`   Email: ${patient.email || 'N/A'}`);
    console.log(`   Patient ID: ${patient.patient_id}`);

    // Look up Healthie ID
    let healthieClientId = patient.healthie_client_id;

    if (!healthieClientId) {
        const mapping = await query<{ healthie_client_id: string }>(`
      SELECT healthie_client_id
      FROM healthie_clients
      WHERE patient_id = $1 AND is_active = true
      LIMIT 1;
    `, [patient.patient_id]);

        healthieClientId = mapping[0]?.healthie_client_id || null;
    }

    if (!healthieClientId) {
        console.error(`❌ No Healthie ID found for patient ${patient.full_name}`);
        process.exit(1);
    }

    console.log(`   Healthie ID: ${healthieClientId}\n`);

    // Check current app access status
    const accessRecords = await query<{
        id: number;
        access_status: string;
        healthie_synced: boolean;
        healthie_sync_error: string | null;
        effective_at: string;
    }>(`
    SELECT id, access_status, healthie_synced, healthie_sync_error, effective_at
    FROM app_access_controls
    WHERE patient_id = $1
    ORDER BY effective_at DESC
    LIMIT 1;
  `, [patient.patient_id]);

    const currentAccess = accessRecords[0];

    if (!currentAccess) {
        console.log(`⚠️  No access control record found (default: granted)`);
        console.log(`   Skipping sync - patient not explicitly revoked in GMH`);
        process.exit(0);
    }

    console.log(`📊 Current Access Status:`);
    console.log(`   Status: ${currentAccess.access_status.toUpperCase()}`);
    console.log(`   Healthie Synced: ${currentAccess.healthie_synced ? '✅ Yes' : '❌ No'}`);
    if (currentAccess.healthie_sync_error) {
        console.log(`   Sync Error: ${currentAccess.healthie_sync_error}`);
    }
    console.log(`   Effective: ${currentAccess.effective_at}\n`);

    if (currentAccess.access_status === 'granted') {
        console.log(`✅ Patient has granted access - no revocation needed`);
        process.exit(0);
    }

    if (currentAccess.healthie_synced) {
        console.log(`✅ Already synced to Healthie - no action needed`);
        process.exit(0);
    }

    // Perform manual sync to Healthie
    console.log(`🔄 Syncing to Healthie...`);

    const healthie = new HealthieClient({
        apiKey: process.env.HEALTHIE_API_KEY!,
        apiUrl: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql'
    });

    try {
        // Set active: false in Healthie
        await healthie.updateClient(healthieClientId, { active: false });
        console.log(`✅ Successfully set active: false in Healthie`);

        // Update our database to mark sync as successful
        await query(`
      UPDATE app_access_controls
      SET healthie_synced = true,
          healthie_sync_error = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `, [currentAccess.id]);

        console.log(`✅ Updated app_access_controls.healthie_synced = true\n`);
        console.log(`🎉 Manual revocation complete!`);
        console.log(`   Patient ${patient.full_name} should now be blocked from logging in.\n`);

    } catch (err) {
        console.error(`\n❌ Healthie sync failed:`, err);

        // Update error in database
        const errorMessage = err instanceof Error ? err.message : String(err);
        await query(`
      UPDATE app_access_controls
      SET healthie_sync_error = $1,
          updated_at = NOW()
      WHERE id = $2;
    `, [errorMessage, currentAccess.id]);

        console.log(`\n⚠️  Error logged to database. Manual intervention required.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

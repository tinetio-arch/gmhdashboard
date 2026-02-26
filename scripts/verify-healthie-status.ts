#!/usr/bin/env tsx
/**
 * Verify Healthie Account Status
 * Checks actual Healthie API to see if account is active
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';
import { HealthieClient } from '../lib/healthie';

async function main() {
    const email = process.argv[2] || 'philschafer7@gmail.com';

    console.log(`\n🔍 Checking Healthie status for: ${email}\n`);

    // Get patient and all their Healthie mappings
    const patients = await query<{
        patient_id: string;
        full_name: string;
        email: string;
        healthie_client_id: string | null;
    }>(`
    SELECT patient_id, full_name, email, healthie_client_id
    FROM patients
    WHERE email ILIKE $1;
  `, [email]);

    if (patients.length === 0) {
        console.error(`❌ No patient found with email: ${email}`);
        process.exit(1);
    }

    const patient = patients[0];
    console.log(`📋 Patient: ${patient.full_name} (${patient.patient_id})\n`);

    // Get ALL Healthie client mappings for this patient
    const mappings = await query<{
        id: number;
        healthie_client_id: string;
        match_method: string;
        is_active: boolean;
        created_at: string;
    }>(`
    SELECT id, healthie_client_id, match_method, is_active, created_at
    FROM healthie_clients
    WHERE patient_id = $1
    ORDER BY created_at DESC;
  `, [patient.patient_id]);

    console.log(`📊 Healthie Client Mappings: ${mappings.length} found\n`);

    if (mappings.length === 0 && !patient.healthie_client_id) {
        console.error(`❌ No Healthie mappings found`);
        process.exit(1);
    }

    // Create Healthie client
    const healthie = new HealthieClient({
        apiKey: process.env.HEALTHIE_API_KEY!,
        apiUrl: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql'
    });

    // Check status of each mapping
    const allHealthieIds = new Set<string>();

    if (patient.healthie_client_id) {
        allHealthieIds.add(patient.healthie_client_id);
    }

    mappings.forEach(m => allHealthieIds.add(m.healthie_client_id));

    for (const healthieId of allHealthieIds) {
        const mapping = mappings.find(m => m.healthie_client_id === healthieId);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`Healthie ID: ${healthieId}`);
        if (mapping) {
            console.log(`Mapping ID: ${mapping.id}`);
            console.log(`Method: ${mapping.match_method}`);
            console.log(`Active in DB: ${mapping.is_active ? '✅' : '❌'}`);
            console.log(`Created: ${mapping.created_at}`);
        } else {
            console.log(`Source: patients.healthie_client_id (no mapping record)`);
        }

        // Query Healthie API
        try {
            const healthieClient = await healthie.getClient(healthieId);

            console.log(`\n🔍 Healthie API Status:`);
            console.log(`   Name: ${healthieClient.first_name} ${healthieClient.last_name}`);
            console.log(`   Email: ${healthieClient.email || 'N/A'}`);
            console.log(`   Active: ${healthieClient.active ? '✅ YES (CAN LOG IN)' : '❌ NO (BLOCKED)'}`);
            console.log(`   Created: ${healthieClient.created_at}`);

            if (healthieClient.active && mapping?.is_active) {
                console.log(`\n⚠️  WARNING: This account is ACTIVE in Healthie and can log in!`);
            }

        } catch (err) {
            console.error(`\n❌ Failed to query Healthie API:`, err instanceof Error ? err.message : err);
        }
    }

    console.log(`\n${'='.repeat(60)}\n`);

    // Check app access control
    const accessRecords = await query<{
        access_status: string;
        healthie_synced: boolean;
        healthie_sync_error: string | null;
        effective_at: string;
    }>(`
    SELECT access_status, healthie_synced, healthie_sync_error, effective_at
    FROM app_access_controls
    WHERE patient_id = $1
    ORDER BY effective_at DESC
    LIMIT 1;
  `, [patient.patient_id]);

    if (accessRecords.length > 0) {
        const access = accessRecords[0];
        console.log(`📊 GMH Access Control:`);
        console.log(`   Status: ${access.access_status.toUpperCase()}`);
        console.log(`   Synced: ${access.healthie_synced ? '✅' : '❌'}`);
        if (access.healthie_sync_error) {
            console.log(`   Error: ${access.healthie_sync_error}`);
        }
        console.log(`   Effective: ${access.effective_at}\n`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

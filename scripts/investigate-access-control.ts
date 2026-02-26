#!/usr/bin/env tsx
/**
 * Investigation script: Access Control Duplicates & Phillip Schafer Login
 * 
 * This script analyzes:
 * 1. Duplicate records in app_access_controls table
 * 2. Patient records for "Phillip Schafer"
 * 3. Authentication status and access control settings
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';

interface AccessControlRecord {
    id: number;
    patient_id: string;
    healthie_client_id: string | null;
    access_status: string;
    reason: string;
    created_at: string;
    effective_at: string;
}

interface PatientRecord {
    patient_id: string;
    full_name: string;
    email: string | null;
    healthie_client_id: string | null;
    created_at: string;
}

interface HealthieClientMapping {
    id: number;
    patient_id: string;
    healthie_client_id: string;
    match_method: string;
    is_active: boolean;
    created_at: string;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('ACCESS CONTROL SYSTEM INVESTIGATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 1. Check if app_access_controls table exists
    console.log('1️⃣  Checking app_access_controls table...\n');

    const tableCheck = await query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'app_access_controls'
    );
  `);

    const tableExists = tableCheck[0]?.exists;
    console.log(`   Table exists: ${tableExists}\n`);

    if (tableExists) {
        // Get total records and unique patients
        const stats = await query<{ total_rows: string; unique_patients: string; }>(`
      SELECT 
        COUNT(*)::text as total_rows, 
        COUNT(DISTINCT patient_id)::text as unique_patients 
      FROM app_access_controls;
    `);

        console.log(`   Total records: ${stats[0]?.total_rows || 0}`);
        console.log(`   Unique patients: ${stats[0]?.unique_patients || 0}\n`);

        // Find patients with multiple access control records
        const duplicates = await query<{ patient_id: string; record_count: string; }>(`
      SELECT patient_id, COUNT(*)::text as record_count 
      FROM app_access_controls 
      GROUP BY patient_id 
      HAVING COUNT(*) > 1 
      ORDER BY COUNT(*) DESC 
      LIMIT 20;
    `);

        if (duplicates.length > 0) {
            console.log(`   ⚠️  Found ${duplicates.length} patients with multiple access control records:`);
            duplicates.forEach((d, i) => {
                console.log(`      ${i + 1}. Patient ${d.patient_id}: ${d.record_count} records`);
            });
            console.log('');
        } else {
            console.log('   ✅ No duplicate access control records found\n');
        }

        // Show recent access control changes
        const recentChanges = await query<AccessControlRecord>(`
      SELECT id, patient_id, healthie_client_id, access_status, reason, 
             created_at, effective_at
      FROM app_access_controls 
      ORDER BY created_at DESC 
      LIMIT 5;
    `);

        if (recentChanges.length > 0) {
            console.log('   Recent access control changes:');
            recentChanges.forEach((r, i) => {
                console.log(`      ${i + 1}. ${r.access_status.toUpperCase()} - ${r.reason.substring(0, 50)}...`);
                console.log(`         Patient: ${r.patient_id}, Healthie: ${r.healthie_client_id || 'N/A'}`);
                console.log(`         Effective: ${r.effective_at}\n`);
            });
        }
    }

    // 2. Search for Phillip Schafer in patients table
    console.log('2️⃣  Searching for "Phillip Schafer" in patients...\n');

    const phillipSchaferPatients = await query<PatientRecord>(`
    SELECT patient_id, full_name, email, healthie_client_id, created_at
    FROM patients 
    WHERE full_name ILIKE '%phillip%schafer%'
    OR email ILIKE '%phillip%schafer%'
    ORDER BY created_at DESC
    LIMIT 10;
  `);

    if (phillipSchaferPatients.length > 0) {
        console.log(`   Found ${phillipSchaferPatients.length} patient records:\n`);
        phillipSchaferPatients.forEach((p, i) => {
            console.log(`      ${i + 1}. ${p.full_name}`);
            console.log(`         Email: ${p.email || 'N/A'}`);
            console.log(`         Patient ID: ${p.patient_id}`);
            console.log(`         Healthie ID: ${p.healthie_client_id || 'N/A'}`);
            console.log(`         Created: ${p.created_at}\n`);
        });
    } else {
        console.log('   ❌ No patient records found for "Phillip Schafer"\n');
    }

    // 3. Check healthie_clients table for duplicate mappings
    console.log('3️⃣  Checking for duplicate Healthie client mappings...\n');

    const duplicateHealthieMappings = await query<{ healthie_client_id: string; patient_count: string; }>(`
    SELECT healthie_client_id, COUNT(DISTINCT patient_id)::text as patient_count
    FROM healthie_clients
    WHERE is_active = true
    GROUP BY healthie_client_id
    HAVING COUNT(DISTINCT patient_id) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 20;
  `);

    if (duplicateHealthieMappings.length > 0) {
        console.log(`   ⚠️  Found ${duplicateHealthieMappings.length} Healthie IDs mapped to multiple patients:`);
        duplicateHealthieMappings.forEach((d, i) => {
            console.log(`      ${i + 1}. Healthie ID ${d.healthie_client_id}: ${d.patient_count} patients`);
        });
        console.log('');

        // Show details of first duplicate
        if (duplicateHealthieMappings[0]) {
            const firstDup = duplicateHealthieMappings[0].healthie_client_id;
            const details = await query<HealthieClientMapping>(`
        SELECT *
        FROM healthie_clients
        WHERE healthie_client_id = $1
        ORDER BY created_at DESC;
      `, [firstDup]);

            console.log(`   Details for Healthie ID ${firstDup}:`);
            details.forEach((d, i) => {
                console.log(`      ${i + 1}. Patient: ${d.patient_id}`);
                console.log(`         Method: ${d.match_method}, Active: ${d.is_active}`);
                console.log(`         Created: ${d.created_at}\n`);
            });
        }
    } else {
        console.log('   ✅ No duplicate Healthie client mappings found\n');
    }

    // 4. Check for patients with multiple Healthie IDs
    console.log('4️⃣  Checking for patients with multiple Healthie IDs...\n');

    const multipleHealthieIds = await query<{ patient_id: string; healthie_count: string; }>(`
    SELECT patient_id, COUNT(DISTINCT healthie_client_id)::text as healthie_count
    FROM healthie_clients
    WHERE is_active = true
    GROUP BY patient_id
    HAVING COUNT(DISTINCT healthie_client_id) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 20;
  `);

    if (multipleHealthieIds.length > 0) {
        console.log(`   ⚠️  Found ${multipleHealthieIds.length} patients with multiple active Healthie IDs:`);
        multipleHealthieIds.forEach((d, i) => {
            console.log(`      ${i + 1}. Patient ${d.patient_id}: ${d.healthie_count} Healthie IDs`);
        });
        console.log('');

        // Show details of first case
        if (multipleHealthieIds[0]) {
            const firstPatient = multipleHealthieIds[0].patient_id;
            const details = await query<HealthieClientMapping>(`
        SELECT *
        FROM healthie_clients
        WHERE patient_id = $1
        ORDER BY created_at DESC;
      `, [firstPatient]);

            console.log(`   Details for Patient ${firstPatient}:`);
            details.forEach((d, i) => {
                console.log(`      ${i + 1}. Healthie ID: ${d.healthie_client_id}`);
                console.log(`         Method: ${d.match_method}, Active: ${d.is_active}`);
                console.log(`         Created: ${d.created_at}\n`);
            });
        }
    } else {
        console.log('   ✅ No patients with multiple active Healthie IDs found\n');
    }

    // 5. Summary and recommendations
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Key Findings:');
    console.log('  • App access control table:', tableExists ? '✅ Exists' : '❌ Missing');
    console.log('  • Phillip Schafer patient records:', phillipSchaferPatients.length);
    console.log('  • Duplicate Healthie mappings:', duplicateHealthieMappings.length);
    console.log('  • Patients with multiple Healthie IDs:', multipleHealthieIds.length);
    console.log('');

    // If Phillip Schafer exists, check their access status
    if (phillipSchaferPatients.length > 0 && tableExists) {
        console.log('Checking Phillip Schafer access status...\n');
        for (const patient of phillipSchaferPatients) {
            const accessRecords = await query<AccessControlRecord>(`
        SELECT *
        FROM app_access_controls
        WHERE patient_id = $1
        ORDER BY effective_at DESC
        LIMIT 5;
      `, [patient.patient_id]);

            console.log(`   Patient: ${patient.full_name} (${patient.patient_id})`);
            if (accessRecords.length > 0) {
                console.log(`   Access control records: ${accessRecords.length}`);
                console.log(`   Current status: ${accessRecords[0].access_status}`);
                console.log(`   Reason: ${accessRecords[0].reason}`);
                console.log(`   Effective: ${accessRecords[0].effective_at}\n`);
            } else {
                console.log(`   ✅ No access control records (default: GRANTED)\n`);
            }
        }
    }

    console.log('Done.\n');
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Audit Healthie Client Mappings
 * 
 * Analyzes all Healthie client mappings to find:
 * 1. Patients mapped to multiple active Healthie IDs
 * 2. Multiple patients mapped to same Healthie ID
 * 3. Mappings where Healthie account is archived/inactive
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';
import { HealthieClient } from '../lib/healthie';

interface HealthieMapping {
    id: number;
    patient_id: string;
    patient_name: string;
    healthie_client_id: string;
    match_method: string;
    is_active: boolean;
    created_at: string;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('HEALTHIE CLIENT MAPPING AUDIT');
    console.log('═══════════════════════════════════════════════════════════\n');

    const healthie = new HealthieClient({
        apiKey: process.env.HEALTHIE_API_KEY!,
        apiUrl: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql'
    });

    // 1. Find patients with multiple active Healthie IDs
    console.log('1️⃣  Patients with Multiple Active Healthie IDs\n');

    const multipleMappings = await query<{ patient_id: string; patient_name: string; healthie_count: string; }>(`
    SELECT 
      hc.patient_id,
      p.full_name as patient_name,
      COUNT(DISTINCT hc.healthie_client_id)::text as healthie_count
    FROM healthie_clients hc
    JOIN patients p ON p.patient_id = hc.patient_id
    WHERE hc.is_active = true
    GROUP BY hc.patient_id, p.full_name
    HAVING COUNT(DISTINCT hc.healthie_client_id) > 1
   ORDER BY COUNT(*) DESC;
  `);

    if (multipleMappings.length > 0) {
        console.log(`   ⚠️  Found ${multipleMappings.length} patients with multiple Healthie IDs:\n`);

        for (const dup of multipleMappings) {
            console.log(`   ${dup.patient_name} (${dup.patient_id}): ${dup.healthie_count} Healthie IDs`);

            // Show details
            const details = await query<HealthieMapping>(`
        SELECT hc.id, hc.patient_id, p.full_name as patient_name,
               hc.healthie_client_id, hc.match_method, hc.is_active, hc.created_at
        FROM healthie_clients hc
        JOIN patients p ON p.patient_id = hc.patient_id
        WHERE hc.patient_id = $1
        ORDER BY hc.created_at DESC;
      `, [dup.patient_id]);

            details.forEach((d, i) => {
                console.log(`      ${i + 1}. Healthie ID: ${d.healthie_client_id}`);
                console.log(`         Method: ${d.match_method}, Active: ${d.is_active}`);
                console.log(`         Created: ${d.created_at}\n`);
            });
        }
    } else {
        console.log(`   ✅ No patients with multiple active Healthie IDs\n`);
    }

    // 2. Find Healthie IDs mapped to multiple patients
    console.log('2️⃣  Healthie IDs Mapped to Multiple Patients\n');

    const duplicateHealthieIds = await query<{ healthie_client_id: string; patient_count: string; }>(`
    SELECT healthie_client_id, COUNT(DISTINCT patient_id)::text as patient_count
    FROM healthie_clients
    WHERE is_active = true
    GROUP BY healthie_client_id
    HAVING COUNT(DISTINCT patient_id) > 1
    ORDER BY COUNT(*) DESC;
  `);

    if (duplicateHealthieIds.length > 0) {
        console.log(`   ⚠️  Found ${duplicateHealthieIds.length} Healthie IDs mapped to multiple patients:\n`);

        for (const dup of duplicateHealthieIds) {
            console.log(`   Healthie ID ${dup.healthie_client_id}: ${dup.patient_count} patients`);

            const details = await query<HealthieMapping>(`
        SELECT hc.id, hc.patient_id, p.full_name as patient_name,
               hc.healthie_client_id, hc.match_method, hc.is_active, hc.created_at
        FROM healthie_clients hc
        JOIN patients p ON p.patient_id = hc.patient_id
        WHERE hc.healthie_client_id = $1
        ORDER BY hc.created_at DESC;
      `, [dup.healthie_client_id]);

            details.forEach((d, i) => {
                console.log(`      ${i + 1}. Patient: ${d.patient_name} (${d.patient_id})`);
                console.log(`         Method: ${d.match_method}, Created: ${d.created_at}\n`);
            });
        }
    } else {
        console.log(`   ✅ No Healthie IDs mapped to multiple patients\n`);
    }

    // 3. Check for archived/inactive accounts in Healthie
    console.log('3️⃣  Checking for Archived Healthie Accounts\n');
    console.log('   (This will query Healthie API for active mappings - may take a moment)\n');

    const activeMappings = await query<{
        healthie_client_id: string;
        patient_name: string;
        patient_id: string;
    }>(`
    SELECT DISTINCT hc.healthie_client_id, p.full_name as patient_name, p.patient_id
    FROM healthie_clients hc
    JOIN patients p ON p.patient_id = hc.patient_id
    WHERE hc.is_active = true
    ORDER BY p.full_name
    LIMIT  50;  -- Limit to avoid rate limits
  `);

    const archivedAccounts: Array<{
        healthie_id: string;
        patient_name: string;
        patient_id: string;
    }> = [];

    let checked = 0;
    for (const mapping of activeMappings) {
        try {
            const client = await healthie.getClient(mapping.healthie_client_id);
            checked++;

            if (!client.active) {
                archivedAccounts.push({
                    healthie_id: mapping.healthie_client_id,
                    patient_name: mapping.patient_name,
                    patient_id: mapping.patient_id
                });
                console.log(`   ⚠️  ${mapping.patient_name}: Healthie account INACTIVE`);
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
            console.log(`   ❌ ${mapping.patient_name}: API error - ${err instanceof Error ? err.message : err}`);
        }
    }

    console.log(`\n   Checked: ${checked} mappings`);

    if (archivedAccounts.length > 0) {
        console.log(`   ⚠️  Found ${archivedAccounts.length} mappings to archived Healthie accounts\n`);
    } else {
        console.log(`   ✅ All checked mappings point to active Healthie accounts\n`);
    }

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Issues found:`);
    console.log(`  • Patients with multiple Healthie IDs: ${multipleMappings.length}`);
    console.log(`  • Healthie IDs mapped to multiple patients: ${duplicateHealthieIds.length}`);
    console.log(`  • Mappings to archived accounts: ${archivedAccounts.length}\n`);

    // Recommendations
    if (multipleMappings.length > 0 || duplicateHealthieIds.length > 0 || archivedAccounts.length > 0) {
        console.log('RECOMMENDED ACTIONS:\n');

        if (multipleMappings.length > 0) {
            console.log('  1. Review patients with multiple Healthie IDs');
            console.log('     - Determine which ID is primary (most recent? most data?)');
            console.log('     - Deactivate secondary mappings');
            console.log('     - Run: npx tsx scripts/fix-duplicate-healthie-mappings.ts\n');
        }

        if (duplicateHealthieIds.length > 0) {
            console.log('  2. Review Healthie IDs mapped to multiple patients');
            console.log('     - Determine correct patient');
            console.log('     - Deactivate incorrect mappings\n');
        }

        if (archivedAccounts.length > 0) {
            console.log('  3. Deactivate mappings to archived Healthie accounts');
            console.log('     - These patients cannot log in anyway');
            console.log('     - Update is_active = false in healthie_clients\n');
        }
    } else {
        console.log('✅ No critical issues found!\n');
    }

    console.log('Done.\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

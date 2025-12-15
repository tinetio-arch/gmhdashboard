#!/usr/bin/env ts-node

/**
 * Validation script for Healthie migration
 * Usage: npx ts-node scripts/validate-healthie-migration.ts [patient-id]
 */

import { validateMigration } from '../lib/healthieMigration';
import { query } from '../lib/db';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx ts-node scripts/validate-healthie-migration.ts [patient-id]');
    console.error('Or: npx ts-node scripts/validate-healthie-migration.ts --all');
    process.exit(1);
  }

  try {
    if (args[0] === '--all') {
      // Validate all migrated patients
      const patients = await query<{
        patient_id: string;
        patient_name: string;
        healthie_client_id: string;
      }>(
        `SELECT 
          p.patient_id,
          p.full_name as patient_name,
          hc.healthie_client_id
         FROM patients p
         INNER JOIN healthie_clients hc ON p.patient_id = hc.patient_id
         WHERE hc.is_active = TRUE
         ORDER BY p.full_name`
      );

      console.log(`Validating ${patients.length} migrated patients...\n`);

      let validCount = 0;
      let invalidCount = 0;

      for (const patient of patients) {
        const validation = await validateMigration(patient.patient_id);
        
        if (validation.valid) {
          console.log(`✓ ${patient.patient_name} - Valid`);
          validCount++;
        } else {
          console.log(`✗ ${patient.patient_name} - Invalid:`);
          validation.issues.forEach(issue => {
            console.log(`  - ${issue}`);
          });
          invalidCount++;
        }
      }

      console.log(`\nValidation Summary:`);
      console.log(`Valid: ${validCount}`);
      console.log(`Invalid: ${invalidCount}`);

      process.exit(invalidCount === 0 ? 0 : 1);
    } else {
      // Validate specific patient
      const patientId = args[0];
      const validation = await validateMigration(patientId);

      const patient = await query<{ patient_name: string }>(
        `SELECT full_name as patient_name FROM patients WHERE patient_id = $1`,
        [patientId]
      );

      const patientName = patient[0]?.patient_name || patientId;

      console.log(`Validation for ${patientName}:`);
      console.log(`Valid: ${validation.valid}`);

      if (validation.issues.length > 0) {
        console.log(`Issues:`);
        validation.issues.forEach(issue => {
          console.log(`  - ${issue}`);
        });
      }

      // Get detailed migration info
      const migrationInfo = await query<{
        healthie_client_id: string;
        subscription_count: number;
        active_subscription_count: number;
      }>(
        `SELECT 
          hc.healthie_client_id,
          COUNT(hs.id) as subscription_count,
          COUNT(CASE WHEN hs.status = 'active' THEN 1 END) as active_subscription_count
         FROM healthie_clients hc
         LEFT JOIN healthie_subscriptions hs ON hc.healthie_client_id = hs.healthie_client_id AND hs.is_active = TRUE
         WHERE hc.patient_id = $1 AND hc.is_active = TRUE
         GROUP BY hc.healthie_client_id`,
        [patientId]
      );

      if (migrationInfo.length > 0) {
        const info = migrationInfo[0];
        console.log(`\nMigration Details:`);
        console.log(`Healthie Client ID: ${info.healthie_client_id}`);
        console.log(`Total Subscriptions: ${info.subscription_count}`);
        console.log(`Active Subscriptions: ${info.active_subscription_count}`);
      }

      process.exit(validation.valid ? 0 : 1);
    }
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

main();


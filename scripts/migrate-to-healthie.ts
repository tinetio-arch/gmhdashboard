#!/usr/bin/env ts-node

/**
 * CLI tool for batch migration to Healthie
 * Usage: npx ts-node scripts/migrate-to-healthie.ts [patient-id-1] [patient-id-2] ...
 */

import { migrateBatch, migratePatientToHealthie } from '../lib/healthieMigration';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx ts-node scripts/migrate-to-healthie.ts [patient-id-1] [patient-id-2] ...');
    console.error('Or: npx ts-node scripts/migrate-to-healthie.ts --all');
    process.exit(1);
  }

  try {
    if (args[0] === '--all') {
      // Get all patients with QuickBooks payment method
      const { query } = await import('../lib/db');
      const patients = await query<{ patient_id: string }>(
        `SELECT patient_id 
         FROM patients 
         WHERE payment_method_key IN ('qbo', 'quickbooks', 'jane_quickbooks')
           AND status_key IN ('active', 'active_pending')`
      );

      if (patients.length === 0) {
        console.log('No patients found to migrate');
        process.exit(0);
      }

      console.log(`Migrating ${patients.length} patients...`);
      const patientIds = patients.map(p => p.patient_id);
      const result = await migrateBatch(patientIds, {
        skipExisting: false,
        createPackages: true,
      });

      console.log('\nMigration Results:');
      console.log(`Total: ${result.totalProcessed}`);
      console.log(`Successful: ${result.successful}`);
      console.log(`Failed: ${result.failed}`);

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach((error, idx) => {
          console.log(`${idx + 1}. ${error}`);
        });
      }

      process.exit(result.success ? 0 : 1);
    } else {
      // Migrate specific patients
      const patientIds = args;

      if (patientIds.length === 1) {
        console.log(`Migrating patient ${patientIds[0]}...`);
        const result = await migratePatientToHealthie(patientIds[0], {
          skipExisting: false,
          createPackages: true,
        });

        console.log('\nMigration Result:');
        console.log(`Patient: ${result.patientName}`);
        console.log(`Success: ${result.success}`);
        console.log(`Healthie Client ID: ${result.healthieClientId || 'N/A'}`);
        console.log(`Subscriptions Created: ${result.subscriptionsCreated}`);

        if (result.errors.length > 0) {
          console.log('\nErrors:');
          result.errors.forEach((error, idx) => {
            console.log(`${idx + 1}. ${error}`);
          });
        }

        process.exit(result.success ? 0 : 1);
      } else {
        console.log(`Migrating ${patientIds.length} patients...`);
        const result = await migrateBatch(patientIds, {
          skipExisting: false,
          createPackages: true,
        });

        console.log('\nMigration Results:');
        console.log(`Total: ${result.totalProcessed}`);
        console.log(`Successful: ${result.successful}`);
        console.log(`Failed: ${result.failed}`);

        if (result.errors.length > 0) {
          console.log('\nErrors:');
          result.errors.forEach((error, idx) => {
            console.log(`${idx + 1}. ${error}`);
          });
        }

        process.exit(result.success ? 0 : 1);
      }
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();



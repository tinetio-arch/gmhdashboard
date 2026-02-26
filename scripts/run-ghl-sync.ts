#!/usr/bin/env npx tsx
/**
 * Run GHL Sync for All Pending Patients
 * Syncs patients to GoHighLevel CRM
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { syncAllPatientsToGHL } from '../lib/patientGHLSync';

async function run() {
    console.log('🔄 GHL Sync - Starting...\n');
    console.log('This may take several minutes for large batches.\n');

    try {
        const result = await syncAllPatientsToGHL(undefined, false);

        console.log('\n' + '='.repeat(50));
        console.log('📊 GHL SYNC SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total processed: ${result.total}`);
        console.log(`✅ Succeeded: ${result.succeeded}`);
        console.log(`❌ Failed: ${result.failed}`);

        if (result.errors.length > 0) {
            console.log('\n📝 Errors (first 20):');
            result.errors.slice(0, 20).forEach(e => console.log(`   - ${e}`));
        }

        console.log('\n✅ GHL Sync complete!');
    } catch (err) {
        console.error('❌ Sync error:', (err as Error).message);
    }
}

run();

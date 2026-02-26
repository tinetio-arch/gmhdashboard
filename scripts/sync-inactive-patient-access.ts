#!/usr/bin/env tsx
/**
 * Sync Inactive Patient Access
 * 
 * Automatically revokes app access for patients with status_key = 'inactive'
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';
import { revokePatientAccess, getPatientAccessStatus } from '../lib/appAccessControl';

interface InactivePatient {
    patient_id: string;
    full_name: string;
    email: string | null;
    status_key: string;
    healthie_client_id: string | null;
}

async function main() {
    console.log('🔍 Finding inactive patients...\n');

    // Find all patients with status_key = 'inactive'
    const inactivePatients = await query<InactivePatient>(`
    SELECT 
      p.patient_id,
      p.full_name,
      p.email,
      p.status_key,
      COALESCE(hc.healthie_client_id, p.healthie_client_id) as healthie_client_id
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
    WHERE p.status_key = 'inactive'
    ORDER BY p.full_name;
  `);

    console.log(`Found ${inactivePatients.length} inactive patients\n`);

    if (inactivePatients.length === 0) {
        console.log('✅ No inactive patients found');
        process.exit(0);
    }

    let revokedCount = 0;
    let alreadyRevokedCount = 0;
    let noHealthieIdCount = 0;
    const errors: string[] = [];

    for (const patient of inactivePatients) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Patient: ${patient.full_name}`);
        console.log(`Email: ${patient.email || 'N/A'}`);
        console.log(`Patient ID: ${patient.patient_id}`);
        console.log(`Healthie ID: ${patient.healthie_client_id || 'N/A'}`);

        try {
            // Check current access status
            const { status, record } = await getPatientAccessStatus(patient.patient_id);

            console.log(`Current access: ${status.toUpperCase()}`);

            if (status === 'revoked' || status === 'suspended') {
                console.log(`✅ Already revoked/suspended - skipping`);
                alreadyRevokedCount++;
                continue;
            }

            if (!patient.healthie_client_id) {
                console.log(`⚠️  No Healthie ID - cannot revoke in Healthie`);
                noHealthieIdCount++;
                // Still revoke in our system
            }

            // Revoke access
            console.log(`🔄 Revoking access...`);

            await revokePatientAccess({
                patientId: patient.patient_id,
                reason: 'Patient status set to inactive',
                reasonCategory: 'administrative',
                changedBy: '00000000-0000-0000-0000-000000000000', // System user
                notes: 'Automatic revocation via sync-inactive-patient-access script'
            });

            console.log(`✅ Access revoked`);
            revokedCount++;

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Error: ${errorMsg}`);
            errors.push(`${patient.full_name} (${patient.patient_id}): ${errorMsg}`);
        }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total inactive patients: ${inactivePatients.length}`);
    console.log(`✅ Newly revoked: ${revokedCount}`);
    console.log(`⏭️  Already revoked: ${alreadyRevokedCount}`);
    console.log(`⚠️  No Healthie ID: ${noHealthieIdCount}`);
    console.log(`❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
        console.log(`\nErrors:`);
        errors.forEach(e => console.log(`  - ${e}`));
    }

    console.log('');

    // Send Telegram summary
    if (revokedCount > 0 || errors.length > 0) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (botToken && chatId) {
            const message =
                `📊 INACTIVE PATIENT ACCESS SYNC\n\n` +
                `Total inactive patients: ${inactivePatients.length}\n` +
                `✅ Newly revoked: ${revokedCount}\n` +
                `⏭️  Already revoked: ${alreadyRevokedCount}\n` +
                `⚠️  No Healthie ID: ${noHealthieIdCount}\n` +
                `❌ Errors: ${errors.length}`;

            try {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: message }),
                });
                console.log('📱 Telegram notification sent');
            } catch (err) {
                console.error('Failed to send Telegram notification:', err);
            }
        }
    }

    console.log('Done.\n');
    process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

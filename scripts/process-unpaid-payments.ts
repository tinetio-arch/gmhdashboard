#!/usr/bin/env npx tsx
/**
 * Process Unpaid Healthie Payments
 * 
 * Finds all patients with unpaid Healthie payments and updates their status
 * to "Hold - Payment Research" so staff can follow up.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query as dbQuery } from '../lib/db';

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

async function healthieQuery(q: string) {
    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + HEALTHIE_API_KEY,
            'AuthorizationSource': 'API'
        },
        body: JSON.stringify({ query: q })
    });
    return (await response.json()).data;
}

async function main() {
    console.log('🔄 Processing Unpaid Healthie Payments...\n');

    // Get all unpaid payments from Healthie
    const result = await healthieQuery(`
        query {
            requestedPayments(status_filter: "not_yet_paid") {
                id status price recipient_id
                recipient { first_name last_name }
                created_at
            }
        }
    `);

    const unpaid = result?.requestedPayments || [];
    console.log(`📥 Found ${unpaid.length} unpaid payments in Healthie`);

    const healthieIds = unpaid.map((p: any) => p.recipient_id).filter(Boolean);

    if (healthieIds.length === 0) {
        console.log('✅ No unpaid payments to process.');
        process.exit(0);
    }

    // Get patients who are active and have unpaid payments
    const patientsToUpdate = await dbQuery(
        `SELECT hc.healthie_client_id, p.patient_id, p.full_name 
         FROM healthie_clients hc 
         JOIN patients p ON p.patient_id::text = hc.patient_id 
         WHERE hc.healthie_client_id = ANY($1) 
           AND p.status_key = 'active'`,
        [healthieIds]
    );

    console.log(`\n📋 Found ${patientsToUpdate.length} active patients with unpaid payments\n`);

    if (patientsToUpdate.length === 0) {
        console.log('✅ All patients with unpaid payments are already on hold or inactive.');
        process.exit(0);
    }

    // Update each patient
    let updated = 0;
    for (const p of patientsToUpdate) {
        const timestamp = new Date().toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        await dbQuery(
            `UPDATE patients 
             SET status_key = 'hold_payment_research', 
                 alert_status = 'Hold - Payment Research',
                 notes = COALESCE(notes, '') || E'\n[' || $1 || '] AUTO: Unpaid Healthie payment detected. Status set to Hold.',
                 last_modified = NOW() 
             WHERE patient_id = $2`,
            [timestamp, p.patient_id]
        );
        console.log(`  ✓ ${p.full_name}`);
        updated++;
    }

    console.log(`\n🎉 Updated ${updated} patients to Hold - Payment Research`);
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
});

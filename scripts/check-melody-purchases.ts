#!/usr/bin/env npx tsx

import { query } from '../lib/db';

async function checkMelodyPurchases() {
    try {
        // Find Melody
        const patients = await query<{
            patient_id: string;
            full_name: string;
        }>(
            `SELECT patient_id, full_name FROM patients WHERE full_name ILIKE '%melody%smith%' LIMIT 1`
        );

        if (patients.length === 0) {
            console.log('Melody not found');
            return;
        }

        const patient = patients[0];
        console.log('Patient:', patient.full_name);
        console.log('Patient ID:', patient.patient_id);

        // Check transactions table
        const transactions = await query<{
            transaction_id: number;
            amount: number;
            description: string;
            created_at: Date;
        }>(
            `SELECT transaction_id, amount, description, created_at
             FROM transactions
             WHERE patient_id = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [patient.patient_id]
        );

        console.log('\n=== Recent transactions ===');
        transactions.forEach(t => {
            console.log(`ID: ${t.transaction_id}`);
            console.log(`Date: ${t.created_at}`);
            console.log(`Description: "${t.description}"`);
            console.log(`Amount: $${t.amount}`);
            console.log('---');
        });

        // Check for pelleting orders specifically
        const pelletingOrders = await query(
            `SELECT * FROM pelleting_orders
             WHERE patient_id = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [patient.patient_id]
        );

        if (pelletingOrders.length > 0) {
            console.log('\n=== Pelleting Orders ===');
            console.log(pelletingOrders);
        }

        // Check service-related tables
        const tables = await query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public'
             AND (table_name LIKE '%order%' OR table_name LIKE '%service%' OR table_name LIKE '%pellet%' OR table_name LIKE '%charge%')
             ORDER BY table_name`
        );

        console.log('\n=== Service-related tables ===');
        tables.forEach(t => console.log(`- ${t.table_name}`));

    } catch (err) {
        console.error('Error:', err);
    }
    process.exit(0);
}

checkMelodyPurchases();
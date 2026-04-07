#!/usr/bin/env npx tsx

/**
 * Create a TEST receipt for Melody that admin can see but patient cannot
 */

import { uploadSimpleReceiptToHealthie } from '../lib/simpleReceiptUpload';
import { query } from '../lib/db';

async function createTestReceipt() {
    console.log('\n=== Creating TEST Receipt for Melody Smith ===');
    console.log('This receipt will be visible to admin but NOT to patient\n');

    try {
        // Find Melody and her actual payment
        const patients = await query<{
            patient_id: string;
            full_name: string;
            healthie_client_id: string;
        }>(
            `SELECT p.patient_id, p.full_name, hc.healthie_client_id
             FROM patients p
             LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id
             WHERE p.full_name ILIKE '%melody%smith%'
             LIMIT 1`
        );

        if (patients.length === 0) {
            console.log('Melody Smith not found');
            return;
        }

        const patient = patients[0];
        console.log(`Found: ${patient.full_name}`);
        console.log(`Healthie Client ID: ${patient.healthie_client_id}\n`);

        // Get her actual recent payment
        const payments = await query<{
            transaction_id: string;
            amount: string;
            description: string;
            created_at: Date;
        }>(
            `SELECT transaction_id, amount, description, created_at
             FROM payment_transactions
             WHERE patient_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [patient.patient_id]
        );

        if (payments.length === 0) {
            console.log('No payments found for Melody');
            return;
        }

        const payment = payments[0];
        const paymentAmount = parseFloat(payment.amount);

        console.log('=== Actual Payment Data ===');
        console.log(`Service: "${payment.description}"`);
        console.log(`Amount: $${paymentAmount.toFixed(2)}`);
        console.log(`Date: ${payment.created_at.toLocaleDateString()}\n`);

        // Generate TEST receipt with corrected layout
        const receiptNumber = `TEST-ADMIN-${Date.now()}`;

        console.log('=== Creating TEST Receipt ===');
        console.log('⚠️ This receipt will be marked as TEST');
        console.log('✅ Admin can see it in Healthie');
        console.log('❌ Patient CANNOT see it\n');

        const result = await uploadSimpleReceiptToHealthie({
            healthieClientId: patient.healthie_client_id,
            receiptNumber,
            date: payment.created_at,
            patientName: patient.full_name,
            description: payment.description,  // "Female pelleting"
            amount: paymentAmount,
            paymentMethod: 'Credit Card (Stripe)',
            clinicName: 'NOW Optimal Health',
            providerName: 'NOW Optimal Staff',
            isMensHealth: false,  // Pelleting is not men's health
            isTestReceipt: true   // CRITICAL: Makes it invisible to patient
        });

        if (result) {
            console.log('✅ SUCCESS: TEST receipt created!');
            console.log(`Healthie Document ID: ${result}`);
            console.log('\n=== Receipt Details ===');
            console.log(`- Service shown: "${payment.description}"`);
            console.log(`- Amount: $${paymentAmount.toFixed(2)}`);
            console.log(`- Clinic Address: 404 S. Montezuma St (on right side, not overlapping logo)`);
            console.log(`- Visibility: Admin ✅ | Patient ❌`);
            console.log('\nYou can view this receipt in Melody\'s Healthie documents.');
            console.log('She will NOT see it or receive any notifications.');
        } else {
            console.log('❌ Failed to create test receipt');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

createTestReceipt();
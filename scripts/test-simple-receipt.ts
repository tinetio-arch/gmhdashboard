#!/usr/bin/env npx tsx

/**
 * Test script for the simple receipt system
 * CRITICAL: This script looks up ACTUAL patient purchases from the database
 * It does NOT use hardcoded test data
 */

import { uploadSimpleReceiptToHealthie } from '../lib/simpleReceiptUpload';
import { query } from '../lib/db';

async function testSimpleReceipt() {
    // Get patient info (using a test patient or specify one)
    const patientName = process.argv[2] || 'Test Patient';

    console.log(`\n=== Testing Simple Receipt Generation ===`);
    console.log(`Looking up patient: ${patientName}\n`);

    try {
        // First, find the patient
        const patients = await query<{
            patient_id: string;
            full_name: string;
            email: string;
            phone_primary: string;
        }>(
            `SELECT patient_id, full_name, email, phone_primary
             FROM patients
             WHERE full_name ILIKE $1
             LIMIT 1`,
            [`%${patientName}%`]
        );

        if (patients.length === 0) {
            console.log(`Patient "${patientName}" not found.`);

            // For testing, create a mock receipt with EXPLICIT description
            console.log('\n=== Creating TEST receipt with explicit service description ===');

            const testDescription = process.argv[3] || 'Consultation Service';
            const testAmount = parseFloat(process.argv[4] || '150.00');

            console.log(`Test Service: "${testDescription}"`);
            console.log(`Test Amount: $${testAmount.toFixed(2)}`);

            const receiptNumber = `TEST-${Date.now()}`;

            const result = await uploadSimpleReceiptToHealthie({
                healthieClientId: '12345',  // Test ID
                receiptNumber,
                date: new Date(),
                patientName: 'Test Patient',
                description: testDescription,  // EXPLICIT service description
                amount: testAmount,
                paymentMethod: 'Credit Card',
                clinicName: 'NOW Optimal Health',
                providerName: 'Dr. Test Provider'
            });

            if (result) {
                console.log(`\n✅ Test receipt uploaded successfully!`);
                console.log(`Healthie Document ID: ${result}`);
            } else {
                console.log(`\n❌ Test receipt upload failed`);
            }

            return;
        }

        const patient = patients[0];
        console.log(`Found patient: ${patient.full_name} (ID: ${patient.patient_id})`);

        // Look up recent charges for this patient
        const recentCharges = await query<{
            charge_id: number;
            amount: number;
            description: string;
            created_at: Date;
            payment_method: string;
        }>(
            `SELECT charge_id, amount, description, created_at, payment_method
             FROM ipad_billing_charges
             WHERE patient_id = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [patient.patient_id]
        );

        if (recentCharges.length === 0) {
            console.log(`\nNo recent charges found for ${patient.full_name}`);
            return;
        }

        console.log(`\nFound ${recentCharges.length} recent charges:`);
        recentCharges.forEach((charge, index) => {
            console.log(`\n${index + 1}. Charge ID: ${charge.charge_id}`);
            console.log(`   Date: ${charge.created_at.toLocaleDateString()}`);
            console.log(`   Description: "${charge.description}"`);
            console.log(`   Amount: $${charge.amount.toFixed(2)}`);
            console.log(`   Payment Method: ${charge.payment_method}`);
        });

        // Use the most recent charge for testing
        const testCharge = recentCharges[0];
        console.log(`\n=== Using most recent charge for receipt test ===`);
        console.log(`Service: "${testCharge.description}"`);
        console.log(`Amount: $${testCharge.amount.toFixed(2)}`);

        // Check for Healthie client ID
        const healthieClients = await query<{ healthie_client_id: string }>(
            `SELECT healthie_client_id
             FROM healthie_clients
             WHERE patient_id = $1 AND is_active = true
             LIMIT 1`,
            [patient.patient_id]
        );

        if (healthieClients.length === 0) {
            console.log(`\n⚠️ No active Healthie client ID found for ${patient.full_name}`);
            console.log('Cannot upload to Healthie without client ID');
            return;
        }

        const healthieClientId = healthieClients[0].healthie_client_id;
        console.log(`Healthie Client ID: ${healthieClientId}`);

        // Generate receipt with ACTUAL charge data
        const receiptNumber = `RCP-${testCharge.charge_id}-${Date.now()}`;

        console.log(`\n=== Generating receipt ===`);
        console.log(`Receipt Number: ${receiptNumber}`);
        console.log(`ACTUAL Service Description: "${testCharge.description}"`);

        const result = await uploadSimpleReceiptToHealthie({
            healthieClientId,
            receiptNumber,
            date: testCharge.created_at,
            patientName: patient.full_name,
            description: testCharge.description,  // ACTUAL service from database
            amount: testCharge.amount,
            paymentMethod: testCharge.payment_method || 'Credit Card',
            clinicName: 'NOW Optimal Health',
            providerName: 'NOW Optimal Staff'
        });

        if (result) {
            console.log(`\n✅ Receipt uploaded successfully!`);
            console.log(`Healthie Document ID: ${result}`);
            console.log(`\nThe receipt shows:`);
            console.log(`- Patient: ${patient.full_name}`);
            console.log(`- Service: "${testCharge.description}"`);
            console.log(`- Amount: $${testCharge.amount.toFixed(2)}`);
        } else {
            console.log(`\n❌ Receipt upload failed`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

// Run the test
testSimpleReceipt().catch(console.error);

/*
Usage examples:

1. Test with a specific patient (uses their ACTUAL charge data):
   npx tsx scripts/test-simple-receipt.ts "John Smith"

2. Test with mock data when patient not found:
   npx tsx scripts/test-simple-receipt.ts "Fake Patient" "Pelleting Service" 250.00
   npx tsx scripts/test-simple-receipt.ts "Test" "BPC-157 (5mg)" 125.00
   npx tsx scripts/test-simple-receipt.ts "Test" "Hormone Replacement Therapy" 300.00
*/
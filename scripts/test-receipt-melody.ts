import { query } from '../lib/db';
import { uploadReceiptToHealthie } from '../lib/healthieReceiptUpload';
import { generateReceiptPdf, type ReceiptPdfParams } from '../lib/pdf/receiptPdfGenerator';
import fs from 'fs';
import path from 'path';

async function testReceiptForMelody() {
    console.log('🔍 Finding Melody Smith in database...');

    // Find Melody Smith
    const patients = await query<{
        patient_id: string;
        full_name: string;
        email: string;
        phone_primary: string;
        healthie_client_id: string;
    }>(
        `SELECT p.patient_id, p.full_name, p.email, p.phone_primary, hc.healthie_client_id
         FROM patients p
         LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id AND hc.is_active = true
         WHERE p.full_name ILIKE '%melody%smith%'
         LIMIT 1`
    );

    if (patients.length === 0) {
        console.error('❌ Melody Smith not found in database');
        process.exit(1);
    }

    const patient = patients[0];
    console.log(`✅ Found patient: ${patient.full_name}`);
    console.log(`   Patient ID: ${patient.patient_id}`);
    console.log(`   Healthie ID: ${patient.healthie_client_id || 'Not linked to Healthie'}`);

    if (!patient.healthie_client_id) {
        console.error('❌ Melody Smith is not linked to Healthie. Cannot upload receipt.');
        process.exit(1);
    }

    // Generate a test receipt for recent peptide purchase
    const receiptNumber = `RCP-${Date.now()}-TEST`;
    const receiptData: ReceiptPdfParams = {
        receiptNumber,
        transactionDate: new Date(),
        patientName: patient.full_name,
        patientEmail: patient.email,
        patientPhone: patient.phone_primary,
        items: [
            {
                name: 'BPC-157 (5mg)',
                quantity: 2,
                unitPrice: 125.00,
                total: 250.00
            },
            {
                name: 'Semaglutide (5mg)',
                quantity: 1,
                unitPrice: 295.00,
                total: 295.00
            },
            {
                name: 'NAD+ (100mg)',
                quantity: 1,
                unitPrice: 175.00,
                total: 175.00
            }
        ],
        subtotal: 720.00,
        tax: 0,
        total: 720.00,
        paymentMethod: 'Visa ending 4242',
        paymentLast4: '4242',
        notes: 'This is a test receipt generated to verify the receipt system is working correctly.',
        clinicLocation: 'Prescott'
    };

    console.log('\n📄 Generating PDF receipt...');

    try {
        // First generate the PDF to test
        const pdfBuffer = await generateReceiptPdf(receiptData);
        console.log(`✅ PDF generated successfully (${pdfBuffer.length} bytes)`);

        // Save a local copy for verification
        const testDir = '/home/ec2-user/gmhdashboard/.tmp';
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        const localPath = path.join(testDir, `test-receipt-${receiptNumber}.pdf`);
        fs.writeFileSync(localPath, pdfBuffer);
        console.log(`✅ PDF saved locally to: ${localPath}`);

        // Now upload to Healthie
        console.log('\n📤 Uploading receipt to Healthie...');
        const documentId = await uploadReceiptToHealthie({
            healthieClientId: patient.healthie_client_id,
            receiptData
        });

        if (documentId) {
            console.log(`\n✅ SUCCESS! Receipt uploaded to Healthie`);
            console.log(`   Document ID: ${documentId}`);
            console.log(`   Receipt Number: ${receiptNumber}`);
            console.log(`   Patient: ${patient.full_name}`);
            console.log(`   Total Amount: $${receiptData.total.toFixed(2)}`);
            console.log('\n📱 Melody can now view this receipt in her Healthie account under Documents.');
        } else {
            console.error('❌ Failed to upload receipt to Healthie');
        }

    } catch (error) {
        console.error('❌ Error generating/uploading receipt:', error);
        process.exit(1);
    }
}

// Run the test
testReceiptForMelody()
    .then(() => {
        console.log('\n✨ Test completed successfully!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
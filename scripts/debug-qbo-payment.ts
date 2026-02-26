import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { query, getPool } from '../lib/db';

async function debug() {
    console.log('Debugging Quickbooks payment data...\n');

    try {
        // 1. Find Jacob Jackson's patient_id
        const patients = await query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients WHERE full_name ILIKE '%jacob jackson%' LIMIT 5`
        );
        console.log('Patients matching "Jacob Jackson":');
        console.log(patients);

        if (patients.length === 0) {
            console.log('No patient found with name Jacob Jackson');
            return;
        }

        const patientId = patients[0].patient_id;
        console.log(`\nUsing patient_id: ${patientId}\n`);

        // 2. Check if quickbooks_payment_transactions table exists and has data
        const tableCheck = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM quickbooks_payment_transactions`
        );
        console.log('Total records in quickbooks_payment_transactions:', tableCheck[0]?.count);

        // 3. Check for this specific patient
        const payments = await query<any>(
            `SELECT * FROM quickbooks_payment_transactions WHERE patient_id = $1 ORDER BY payment_date DESC LIMIT 5`,
            [patientId]
        );
        console.log('\nPayments for this patient:');
        console.log(payments);

        // 4. Also check quickbooks_sales_receipts
        const receipts = await query<any>(
            `SELECT * FROM quickbooks_sales_receipts WHERE patient_id = $1 ORDER BY receipt_date DESC LIMIT 5`,
            [patientId]
        );
        console.log('\nSales receipts for this patient:');
        console.log(receipts);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await getPool().end();
    }
}

debug();

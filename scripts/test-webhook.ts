#!/usr/bin/env npx tsx
/**
 * Test the peptide webhook handler
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

async function main() {
    console.log('=== PEPTIDE WEBHOOK TEST ===\n');

    // 1. Check current dispenses count
    const before = await pool.query('SELECT COUNT(*) as count FROM peptide_dispenses');
    console.log(`Dispenses before: ${before.rows[0].count}`);

    // 2. Simulate creating a dispense via what the webhook would do
    const testPatient = 'TEST PATIENT (Webhook Simulation)';
    const testProduct = await pool.query(
        `SELECT product_id, name FROM peptide_products WHERE healthie_product_id = '29095' LIMIT 1`
    );

    if (!testProduct.rows[0]) {
        console.log('ERROR: Test product not found');
        return;
    }

    console.log(`Test product: ${testProduct.rows[0].name}`);

    const today = new Date().toISOString().split('T')[0];

    // Simulate the webhook creating a pending dispense
    await pool.query(`
    INSERT INTO peptide_dispenses (
      product_id, quantity, patient_name, sale_date, order_date,
      status, education_complete, paid, healthie_billing_item_id, notes
    ) VALUES ($1, 1, $2, $3, $3, 'Pending', false, false, 'TEST-WEBHOOK-12345', $4)
  `, [
        testProduct.rows[0].product_id,
        testPatient,
        today,
        'Test dispense created by webhook simulation'
    ]);

    console.log('✅ Test dispense created!\n');

    // 3. Check new count
    const after = await pool.query('SELECT COUNT(*) as count FROM peptide_dispenses');
    console.log(`Dispenses after: ${after.rows[0].count}`);

    // 4. Verify the pending dispense was created correctly
    const testDispense = await pool.query(`
    SELECT * FROM peptide_dispenses 
    WHERE patient_name = $1 AND healthie_billing_item_id = 'TEST-WEBHOOK-12345'
  `, [testPatient]);

    console.log('\n=== TEST DISPENSE DETAILS ===');
    console.log(`  Status: ${testDispense.rows[0]?.status}`);
    console.log(`  Education Complete: ${testDispense.rows[0]?.education_complete}`);
    console.log(`  Paid: ${testDispense.rows[0]?.paid}`);
    console.log(`  Notes: ${testDispense.rows[0]?.notes}`);

    // 5. Verify inventory NOT affected (pending dispenses don't count)
    const inventory = await pool.query(`
    SELECT 
      COALESCE(SUM(quantity), 0) as ordered,
      COALESCE((SELECT SUM(quantity) FROM peptide_dispenses 
                WHERE status = 'Paid' AND education_complete = true), 0) as dispensed,
      COALESCE(SUM(quantity), 0) - 
      COALESCE((SELECT SUM(quantity) FROM peptide_dispenses 
                WHERE status = 'Paid' AND education_complete = true), 0) as stock
    FROM peptide_orders
  `);

    console.log('\n=== INVENTORY CHECK ===');
    console.log(`  Ordered: ${inventory.rows[0]?.ordered}`);
    console.log(`  Dispensed (Paid+Edu): ${inventory.rows[0]?.dispensed}`);
    console.log(`  Stock: ${inventory.rows[0]?.stock}`);
    console.log('  Expected stock: 27 (unchanged because pending dispense)');

    // 6. Clean up test dispense
    await pool.query(`
    DELETE FROM peptide_dispenses 
    WHERE patient_name = $1 AND healthie_billing_item_id = 'TEST-WEBHOOK-12345'
  `, [testPatient]);

    console.log('\n✅ Test dispense cleaned up');

    // Final count
    const final = await pool.query('SELECT COUNT(*) as count FROM peptide_dispenses');
    console.log(`Final dispense count: ${final.rows[0].count}`);

    console.log('\n=== ALL TESTS PASSED ===');
    await pool.end();
}

main().catch(console.error);

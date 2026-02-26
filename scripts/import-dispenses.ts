#!/usr/bin/env npx tsx
/**
 * Import historical patient dispenses from Excel Peptide Therapy sheet
 */

import { Pool } from 'pg';
import * as fs from 'fs';
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

interface Dispense {
    patient_name: string;
    peptide_name: string;
    status: string;
    order_date: string | null;
    received_date: string | null;
    education_complete: boolean;
    notes: string | null;
}

async function main() {
    console.log('Loading dispenses from JSON...');
    const dispenses: Dispense[] = JSON.parse(
        fs.readFileSync('/tmp/peptide_dispenses_full.json', 'utf-8')
    );
    console.log(`Found ${dispenses.length} dispenses to import`);

    // Get product mapping
    const { rows: products } = await pool.query(
        'SELECT product_id, name FROM peptide_products'
    );
    const productMap = new Map<string, string>();
    for (const p of products) {
        productMap.set(p.name.toLowerCase(), p.product_id);
    }
    console.log(`Loaded ${products.length} products for matching`);

    let imported = 0;
    let skipped = 0;

    for (const d of dispenses) {
        // Find matching product
        const productId = productMap.get(d.peptide_name.toLowerCase());
        if (!productId) {
            // Try partial match
            let found = false;
            for (const [name, id] of productMap) {
                if (name.includes(d.peptide_name.toLowerCase().substring(0, 10)) ||
                    d.peptide_name.toLowerCase().includes(name.substring(0, 10))) {
                    // Close enough match
                    try {
                        await pool.query(`
              INSERT INTO peptide_dispenses (
                product_id, quantity, patient_name, sale_date, order_date, 
                received_date, status, education_complete, paid, notes
              ) VALUES ($1, 1, $2, COALESCE($3::date, $4::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
            `, [
                            id,
                            d.patient_name,
                            d.order_date,
                            d.received_date,
                            d.status || 'Paid',
                            d.education_complete,
                            d.status === 'Paid',
                            d.notes,
                        ]);
                        imported++;
                        found = true;
                        break;
                    } catch (e) {
                        console.error(`Error inserting: ${e}`);
                    }
                }
            }
            if (!found) {
                console.log(`Skipped: ${d.peptide_name} (no match)`);
                skipped++;
            }
            continue;
        }

        try {
            await pool.query(`
        INSERT INTO peptide_dispenses (
          product_id, quantity, patient_name, sale_date, order_date, 
          received_date, status, education_complete, paid, notes
        ) VALUES ($1, 1, $2, COALESCE($3::date, $4::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
      `, [
                productId,
                d.patient_name,
                d.order_date,
                d.received_date,
                d.status || 'Paid',
                d.education_complete,
                d.status === 'Paid',
                d.notes,
            ]);
            imported++;
        } catch (e) {
            console.error(`Error inserting ${d.patient_name} - ${d.peptide_name}: ${e}`);
            skipped++;
        }
    }

    console.log(`\nImported: ${imported}, Skipped: ${skipped}`);

    await pool.end();
}

main().catch(console.error);

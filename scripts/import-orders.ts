#!/usr/bin/env npx tsx
/**
 * Import ALL peptide orders from Excel Peptide Orders sheet
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

interface Order {
    peptide_name: string;
    quantity: number;
    order_date: string | null;
    po_number: string | null;
}

async function main() {
    console.log('Loading orders from JSON...');
    const orders: Order[] = JSON.parse(
        fs.readFileSync('/tmp/peptide_orders_full.json', 'utf-8')
    );
    console.log(`Found ${orders.length} orders to import`);

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
    let totalQty = 0;

    for (const o of orders) {
        const productId = productMap.get(o.peptide_name.toLowerCase());
        if (!productId) {
            console.log(`Skipped: ${o.peptide_name} (no match)`);
            skipped++;
            continue;
        }

        try {
            await pool.query(`
        INSERT INTO peptide_orders (product_id, quantity, order_date, po_number)
        VALUES ($1, $2, $3::date, $4)
      `, [productId, o.quantity, o.order_date, o.po_number]);
            imported++;
            totalQty += o.quantity;
        } catch (e) {
            console.error(`Error: ${e}`);
            skipped++;
        }
    }

    console.log(`\nImported: ${imported} orders, Total qty: ${totalQty}, Skipped: ${skipped}`);
    await pool.end();
}

main().catch(console.error);

/**
 * Import Peptide Inventory from Excel
 * 
 * Imports:
 * 1. 28 peptide products with reorder points
 * 2. Historical order data from 'Peptide Orders' sheet
 * 
 * Usage: npx tsx scripts/import-peptide-inventory.ts
 */

import { query, getClient } from '../lib/db';

// Map Healthie product names to IDs (from our earlier import)
const HEALTHIE_PRODUCT_MAP: Record<string, string> = {
    'AOD 9604 (3mg)': '29082',
    'AOD 9604 (5mg)': '29083',
    'BPC-157 (10mg)': '29084',
    'BPC-157 (10mg) / TB 500 ( 10mg)': '29085',
    'BPC-157 (20mg)': '29086',
    'BPC-157 (5mg)': '29087',
    'CJC 1295 without DAC (10mg)': '29088',
    'CJC 1295 with DAC (10mg)': '29089',
    'CJC-1295 with Ipamorelin (5mg)': '29090',
    'Gonadorelin (10mg)': '29091',
    'HCG ( 10,000 iu)': '29092',
    'PT 141 (10 mg)': '29093',
    'PT 141 (5mg)': '29094',
    'Retatrutide (12 mg)': '29095',
    'Retatrutide (24 mg)': '29096',
    'Semax (30mg)': '29097',
    'Semorelin (10mg)': '29098',
    'TB500 Thymosin Beta 4 (10mg)': '29099',
    'TB500 Thymosin Beta 4 (5mg)': '29100',
    'Tesamorelin (10mg)': '29101',
    'Tesamorelin (10mg) / Ipamorelin (5mg)': '29102',
    '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)': '29103',
    '2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)': '29104',
    '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)': '29105',
    '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)': '29106',
    '4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)': '29107',
    'GHRP-6 (5mg)': '29108',
    'HCG (5000) IU': '29109',
};

// Peptide products from Excel
const PEPTIDE_PRODUCTS = [
    { name: 'AOD 9604 (3mg)', reorder_point: 1, category: 'C' },
    { name: 'AOD 9604 (5mg)', reorder_point: 1, category: 'C' },
    { name: 'BPC-157 (10mg)', reorder_point: 1, category: 'C' },
    { name: 'BPC-157 (10mg) / TB 500 ( 10mg)', reorder_point: 1, category: 'X-1' },
    { name: 'BPC-157 (20mg)', reorder_point: 1, category: 'C' },
    { name: 'BPC-157 (5mg)', reorder_point: 1, category: 'C' },
    { name: 'CJC 1295 without DAC (10mg)', reorder_point: 1, category: 'C' },
    { name: 'CJC 1295 with DAC (10mg)', reorder_point: 1, category: 'C' },
    { name: 'CJC-1295 with Ipamorelin (5mg)', reorder_point: 1, category: 'C' },
    { name: 'Gonadorelin (10mg)', reorder_point: 1, category: 'C' },
    { name: 'HCG ( 10,000 iu)', reorder_point: 1, category: 'C' },
    { name: 'PT 141 (10 mg)', reorder_point: 1, category: 'C' },
    { name: 'PT 141 (5mg)', reorder_point: 1, category: 'C' },
    { name: 'Retatrutide (12 mg)', reorder_point: 1, category: 'C' },
    { name: 'Retatrutide (24 mg)', reorder_point: 1, category: 'C' },
    { name: 'Semax (30mg)', reorder_point: 1, category: 'C' },
    { name: 'Semorelin (10mg)', reorder_point: 1, category: 'C' },
    { name: 'TB500 Thymosin Beta 4 (10mg)', reorder_point: 1, category: 'C' },
    { name: 'TB500 Thymosin Beta 4 (5mg)', reorder_point: 1, category: 'C' },
    { name: 'Tesamorelin (10mg)', reorder_point: 1, category: 'C' },
    { name: 'Tesamorelin (10mg) / Ipamorelin (5mg)', reorder_point: 1, category: 'C' },
    { name: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', reorder_point: 1, category: 'C' },
    { name: '2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)', reorder_point: 1, category: 'C' },
    { name: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', reorder_point: 1, category: 'C' },
    { name: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', reorder_point: 1, category: 'C' },
    { name: '4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', reorder_point: 1, category: 'C' },
    { name: 'GHRP-6 (5mg)', reorder_point: 1, category: 'C' },
    { name: 'HCG (5000) IU', reorder_point: 1, category: 'C' },
];

// Historical orders from Excel 'Peptide Orders' sheet
const HISTORICAL_ORDERS = [
    { peptide: 'Retatrutide (12 mg)', quantity: 5, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: 'Retatrutide (24 mg)', quantity: 1, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 1, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 1, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 1, order_date: '2024-06-03', po_number: 'INITIAL' },
    { peptide: 'Retatrutide (12 mg)', quantity: 4, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'Gonadorelin (10mg)', quantity: 5, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'BPC-157 (20mg)', quantity: 4, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 5, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'BPC-157 (10mg)', quantity: 3, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 3, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'CJC 1295 with DAC (10mg)', quantity: 5, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: 'CJC 1295 without DAC (10mg)', quantity: 2, order_date: '2025-06-02', po_number: 'ABM-15581' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 2, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'BPC-157 (20mg)', quantity: 5, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'Retatrutide (24 mg)', quantity: 2, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'Retatrutide (12 mg)', quantity: 5, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'BPC-157 (10mg)', quantity: 5, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 4, order_date: '2025-07-06', po_number: 'ABM-24929' },
    { peptide: 'CJC 1295 without DAC (10mg)', quantity: 3, order_date: '2025-07-18', po_number: 'ABM-28928' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2025-07-18', po_number: 'ABM-28928' },
    { peptide: 'BPC-157 (20mg)', quantity: 3, order_date: '2025-07-18', po_number: 'ABM-28928' },
    { peptide: 'Retatrutide (24 mg)', quantity: 5, order_date: '2025-07-18', po_number: 'ABM-28928' },
    { peptide: 'Retatrutide (12 mg)', quantity: 5, order_date: '2025-07-18', po_number: 'ABM-28928' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 5, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: 'BPC-157 (20mg)', quantity: 3, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: 'Retatrutide (24 mg)', quantity: 4, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: 'Retatrutide (12 mg)', quantity: 3, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 4, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', quantity: 4, order_date: '2025-08-21', po_number: 'ABM-40665' },
    { peptide: 'CJC 1295 without DAC (10mg)', quantity: 3, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 5, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: 'BPC-157 (20mg)', quantity: 4, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: 'Retatrutide (24 mg)', quantity: 4, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: 'Retatrutide (12 mg)', quantity: 4, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 5, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 3, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2025-09-22', po_number: 'ABM-50878' },
    { peptide: '2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)', quantity: 5, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: 'Retatrutide (12 mg)', quantity: 6, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: 'Retatrutide (24 mg)', quantity: 6, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: 'BPC-157 (20mg)', quantity: 4, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 5, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 3, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', quantity: 5, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 4, order_date: '2025-10-22', po_number: 'ABM-57167' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 4, order_date: '2025-11-20', po_number: 'ABM-62205' },
    { peptide: 'Retatrutide (24 mg)', quantity: 6, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'Retatrutide (12 mg)', quantity: 5, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'BPC-157 (20mg)', quantity: 4, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', quantity: 4, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'CJC 1295 without DAC (10mg)', quantity: 3, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'Semorelin (10mg)', quantity: 2, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'HCG ( 10,000 iu)', quantity: 2, order_date: '2025-11-21', po_number: 'ABM-62109' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 5, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: 'Retatrutide (24 mg)', quantity: 5, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: '4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 4, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: 'Retatrutide (12 mg)', quantity: 4, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', quantity: 3, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: '2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)', quantity: 3, order_date: '2025-12-08', po_number: 'ABM-67924' },
    { peptide: 'Retatrutide (12 mg)', quantity: 5, order_date: '2025-12-15', po_number: 'ABM-71513' },
    { peptide: 'Retatrutide (24 mg)', quantity: 5, order_date: '2025-12-15', po_number: 'ABM-71513' },
    { peptide: 'BPC-157 (10mg) / TB 500 ( 10mg)', quantity: 5, order_date: '2025-12-15', po_number: 'ABM-71513' },
    { peptide: 'Retatrutide (24 mg)', quantity: 10, order_date: '2025-12-24', po_number: 'ABM-75402' },
];

async function importPeptideProducts(): Promise<Map<string, string>> {
    console.log('📦 Importing peptide products...');
    const productIdMap = new Map<string, string>();

    for (const product of PEPTIDE_PRODUCTS) {
        const healthieId = HEALTHIE_PRODUCT_MAP[product.name] || null;

        const result = await query<{ product_id: string }>(
            `INSERT INTO peptide_products (name, healthie_product_id, reorder_point, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         healthie_product_id = EXCLUDED.healthie_product_id,
         reorder_point = EXCLUDED.reorder_point,
         category = EXCLUDED.category
       RETURNING product_id`,
            [product.name, healthieId, product.reorder_point, product.category]
        );

        if (result[0]) {
            productIdMap.set(product.name, result[0].product_id);
            console.log(`  ✅ ${product.name}`);
        }
    }

    console.log(`\n✅ Imported ${productIdMap.size} peptide products\n`);
    return productIdMap;
}

async function importOrders(productIdMap: Map<string, string>): Promise<void> {
    console.log('📋 Importing historical orders...');
    let imported = 0;
    let skipped = 0;

    for (const order of HISTORICAL_ORDERS) {
        const productId = productIdMap.get(order.peptide);

        if (!productId) {
            console.log(`  ⚠️ Skipping order - unknown peptide: ${order.peptide}`);
            skipped++;
            continue;
        }

        await query(
            `INSERT INTO peptide_orders (product_id, quantity, order_date, po_number)
       VALUES ($1, $2, $3, $4)`,
            [productId, order.quantity, order.order_date, order.po_number]
        );

        imported++;
    }

    console.log(`\n✅ Imported ${imported} orders (${skipped} skipped)\n`);
}

async function main() {
    console.log('🚀 Peptide Inventory Import\n');
    console.log('═'.repeat(50));

    try {
        // Import products first
        const productIdMap = await importPeptideProducts();

        // Import orders
        await importOrders(productIdMap);

        // Show summary
        const [summary] = await query<{ products: string; orders: string; sales: string }>(
            `SELECT 
         (SELECT COUNT(*) FROM peptide_products) as products,
         (SELECT COUNT(*) FROM peptide_orders) as orders,
         (SELECT COUNT(*) FROM peptide_sales) as sales`
        );

        console.log('═'.repeat(50));
        console.log('📊 IMPORT SUMMARY');
        console.log('═'.repeat(50));
        console.log(`Products: ${summary.products}`);
        console.log(`Orders: ${summary.orders}`);
        console.log(`Sales: ${summary.sales}`);
        console.log('═'.repeat(50));

    } catch (error) {
        console.error('❌ Import failed:', error);
        process.exit(1);
    }

    process.exit(0);
}

main();

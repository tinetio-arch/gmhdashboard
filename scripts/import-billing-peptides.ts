import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';

interface Product {
  name: string;
  sell_price: number;
  unit_cost: number | null;
  supplier: string;
  category: string;
}

const products: Product[] = [
  { name: 'AOD 9604 (3mg)', sell_price: 150, unit_cost: 60, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'AOD 9604 (5mg)', sell_price: 150, unit_cost: 150, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'BPC-157 (10mg)', sell_price: 130, unit_cost: 130, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'BPC-157 (10mg) / TB 500 (10mg)', sell_price: 196, unit_cost: 83, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'BPC-157 (20mg)', sell_price: 180, unit_cost: 75, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'BPC-157 (5mg)', sell_price: 120, unit_cost: 45, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'CJC 1295 without DAC (10mg)', sell_price: 150, unit_cost: null, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'CJC 1295 with DAC (10mg)', sell_price: 170, unit_cost: 170, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'CJC-1295 with Ipamorelin (5mg)', sell_price: 140, unit_cost: null, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Gonadorelin (10mg)', sell_price: 150, unit_cost: 60, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Gonadorelin (5mg)', sell_price: 120, unit_cost: 45, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'HCG (10,000 iu)', sell_price: 198, unit_cost: 84, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'HCG (5000) IU', sell_price: 128, unit_cost: 49, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'PT 141 (10 mg)', sell_price: 130, unit_cost: 50, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'PT 141 (5mg)', sell_price: 110, unit_cost: 40, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Retatrutide (10 mg)', sell_price: 375, unit_cost: 80, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Retatrutide (12 mg)', sell_price: 410, unit_cost: null, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Retatrutide (24 mg)', sell_price: 664, unit_cost: null, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Semax (30mg)', sell_price: 120, unit_cost: 45, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Sermorelin (10mg)', sell_price: 160, unit_cost: 65, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Sermorelin (5mg)', sell_price: 120, unit_cost: 45, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'TB500 Thymosin Beta 4 (10mg)', sell_price: 150, unit_cost: 60, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'TB500 Thymosin Beta 4 (5mg)', sell_price: 130, unit_cost: 50, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Tesamorelin (10mg)', sell_price: 160, unit_cost: 65, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Tesamorelin (8mg)', sell_price: 148, unit_cost: 59, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Tesamorelin (10mg) / Ipamorelin (5mg)', sell_price: 160, unit_cost: 65, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: '2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', sell_price: 140, unit_cost: 55, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: '2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)', sell_price: 160, unit_cost: 65, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: '2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', sell_price: 140, unit_cost: 55, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: '3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', sell_price: 150, unit_cost: 60, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: '4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', sell_price: 160, unit_cost: 65, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Ipamorelin (10mg)', sell_price: 120, unit_cost: 45, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'GHRP-6 (5mg)', sell_price: 90, unit_cost: 90, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Staff 2x CJC/Ipamorelin', sell_price: 75, unit_cost: null, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'GHK-CU 100mg', sell_price: 130, unit_cost: 52, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'GHK-CU 50mg', sell_price: 100, unit_cost: 40, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'DSIP (10mg)', sell_price: 120, unit_cost: 47, supplier: 'Alpha BioMed', category: 'peptide' },
  { name: 'Oxytocin 10mg', sell_price: 160, unit_cost: 80, supplier: 'Alpha BioMed', category: 'peptide' },
];

async function importProducts() {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    // Check if exists (case-insensitive, fuzzy on spaces/dashes)
    const existing = await query<{ product_id: string; sell_price: number; unit_cost: number | null }>(
      `SELECT product_id, sell_price, unit_cost FROM peptide_products
       WHERE LOWER(REPLACE(REPLACE(name, '-', ''), ' ', ''))
           = LOWER(REPLACE(REPLACE($1, '-', ''), ' ', ''))
       LIMIT 1`,
      [p.name]
    );

    if (existing.length === 0) {
      // Insert new product
      await query(
        `INSERT INTO peptide_products (name, sell_price, unit_cost, supplier, category, active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [p.name, p.sell_price, p.unit_cost, p.supplier, p.category]
      );
      console.log(`INSERTED: ${p.name} — $${p.sell_price}`);
      inserted++;
    } else {
      const ex = existing[0];
      const priceChanged = Number(ex.sell_price) !== p.sell_price;
      const costChanged = p.unit_cost !== null && Number(ex.unit_cost) !== p.unit_cost;

      if (priceChanged || costChanged) {
        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (priceChanged) {
          updates.push(`sell_price = $${idx++}`);
          values.push(p.sell_price);
        }
        if (costChanged) {
          updates.push(`unit_cost = $${idx++}`);
          values.push(p.unit_cost);
        }

        values.push(ex.product_id);
        await query(
          `UPDATE peptide_products SET ${updates.join(', ')} WHERE product_id = $${idx}`,
          values
        );
        console.log(`UPDATED: ${p.name} — price: $${ex.sell_price} -> $${p.sell_price}`);
        updated++;
      } else {
        console.log(`SKIPPED: ${p.name} (already exists, price matches)`);
        skipped++;
      }
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

importProducts().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});

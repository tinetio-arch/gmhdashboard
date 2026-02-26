import { query } from '../lib/db';

async function main() {
  const rows: any[] = await query(`
    SELECT p.name, p.sell_price, p.unit_cost,
           COUNT(d.id) FILTER (WHERE d.status = 'Paid') as paid
    FROM peptide_products p
    LEFT JOIN peptide_dispenses d ON p.product_id = d.product_id
    GROUP BY p.product_id, p.name, p.sell_price, p.unit_cost
    ORDER BY paid DESC, p.name
  `);
  for (const r of rows) {
    console.log(`${r.name} | sell=$${r.sell_price ?? 'NULL'} | cost=$${r.unit_cost ?? 'NULL'} | paid_dispenses=${r.paid}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

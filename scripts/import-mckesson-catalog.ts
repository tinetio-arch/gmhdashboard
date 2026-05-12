/**
 * Idempotent import of McKesson catalog (List 46820644) into supply_items.
 *
 * Reads .tmp/mckesson/catalog.json produced from the xls exports and upserts
 * rows keyed by mckesson_item_id (unique partial index). Re-running is safe.
 *
 * Discontinued items are stored with active=false so staff can't accidentally
 * order them, but historical references still resolve.
 *
 *   tsx scripts/import-mckesson-catalog.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../lib/db';

interface CatalogItem {
  item_number: string;
  description: string;
  manufacturer: string | null;
  manufacturer_part_number: string | null;
  shopping_qty: number | null;
  unit_of_measure: string;
  major_category: string;
  minor_category: string | null;
  stock_status: string | null;
  source_file: string;
}

async function main() {
  const path = '/home/ec2-user/gmhdashboard/.tmp/mckesson/catalog.json';
  const items: CatalogItem[] = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Loading ${items.length} items from ${path}`);

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let withReorderQty = 0;
  let inactive = 0;

  try {
    await client.query('BEGIN');
    for (const it of items) {
      const isDiscontinued = it.stock_status === 'Discontinued';
      if (isDiscontinued) inactive++;
      if (it.shopping_qty !== null) withReorderQty++;

      const result = await client.query(
        `
        INSERT INTO supply_items (
          name, category, unit, par_level, reorder_qty, notes, active,
          mckesson_item_id, mckesson_unit_of_measure,
          manufacturer, manufacturer_part_number, minor_category, stock_status
        ) VALUES (
          $1, $2, $3, NULL, $4, NULL, $5,
          $6, $7,
          $8, $9, $10, $11
        )
        ON CONFLICT (mckesson_item_id) WHERE mckesson_item_id IS NOT NULL
        DO UPDATE SET
          name                      = EXCLUDED.name,
          category                  = EXCLUDED.category,
          unit                      = EXCLUDED.unit,
          mckesson_unit_of_measure  = EXCLUDED.mckesson_unit_of_measure,
          manufacturer              = EXCLUDED.manufacturer,
          manufacturer_part_number  = EXCLUDED.manufacturer_part_number,
          minor_category            = EXCLUDED.minor_category,
          stock_status              = EXCLUDED.stock_status,
          active                    = EXCLUDED.active,
          -- preserve existing reorder_qty unless we have a new one to set
          reorder_qty               = COALESCE(EXCLUDED.reorder_qty, supply_items.reorder_qty),
          updated_at                = NOW()
        RETURNING (xmax = 0) AS inserted
        `,
        [
          it.description,                         // $1 name
          it.major_category,                      // $2 category
          it.unit_of_measure,                     // $3 unit
          it.shopping_qty,                        // $4 reorder_qty
          !isDiscontinued,                        // $5 active
          it.item_number,                         // $6 mckesson_item_id
          it.unit_of_measure,                     // $7 mckesson_unit_of_measure
          it.manufacturer,                        // $8
          it.manufacturer_part_number,            // $9
          it.minor_category,                      // $10
          it.stock_status,                        // $11
        ]
      );
      if (result.rows[0].inserted) inserted++;
      else updated++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`\n✓ Done.`);
  console.log(`  inserted: ${inserted}`);
  console.log(`  updated:  ${updated}`);
  console.log(`  active=false (discontinued): ${inactive}`);
  console.log(`  with reorder_qty (shopping cart): ${withReorderQty}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[IMPORT]', e);
  process.exit(1);
});

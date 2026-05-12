/**
 * Sync McKesson product availability into supply_items cache.
 *
 * For every active row in supply_items with a mckesson_item_id, calls
 * /v1/products/availability in batches and stores:
 *   - SELL/BUY UOM names + eaches per unit
 *   - Per-BUY-unit weight
 *   - Last-known purchasable flag
 *   - Replacement item id (when McKesson discontinued the item)
 *   - Storage requirement
 *   - Sync timestamp
 *
 * Idempotent. Designed to run nightly via cron once we wire it up.
 *
 *   tsx scripts/sync-mckesson-availability.ts [--limit N] [--include-inactive]
 */
import 'dotenv/config';
import { query, getPool } from '../lib/db';
import { checkItemAvailability, getMcKessonAccountId, getMcKessonShipToAccountId } from '../lib/mckesson';

const ACCOUNT_ID = getMcKessonAccountId();        // bill-to (path)
const SHIP_TO_ID = getMcKessonShipToAccountId();  // ship-to (body)
const BATCH_SIZE = 25;

interface Row {
  id: number;
  mckesson_item_id: string;
  mckesson_unit_of_measure: string | null;
  stock_status: string | null;
}

function pickUOM(uoms: any[] | undefined, type: 'SELL' | 'BUY') {
  if (!uoms) return null;
  return uoms.find((u) => u?.type === type) || null;
}

async function main() {
  if (!ACCOUNT_ID) throw new Error('MCKESSON_ACCOUNT_ID not set');
  console.log(`bill-to=${ACCOUNT_ID} ship-to=${SHIP_TO_ID}`);

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const includeInactive = args.includes('--include-inactive');

  const rows = await query<Row>(
    `SELECT id, mckesson_item_id, mckesson_unit_of_measure, stock_status
     FROM supply_items
     WHERE mckesson_item_id IS NOT NULL
       ${includeInactive ? '' : 'AND active = true'}
     ORDER BY id
     ${limit ? `LIMIT ${limit}` : ''}`
  );
  console.log(`Syncing ${rows.length} items in batches of ${BATCH_SIZE}…`);

  const pool = getPool();
  let synced = 0;
  let purchasable = 0;
  let uomMismatch = 0;
  let invalid = 0;
  let errors = 0;
  const mismatches: Array<{ id: number; itemId: string; catalogUOM: string; apiSellUOM: string }> = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const itemsRequest = chunk.map((r) => ({
      itemId: parseInt(r.mckesson_item_id, 10),
      quantity: 1,
      // Use 'EA' as a neutral probe — McKesson echoes back the full
      // unitOfMeasures array regardless. We store both SELL and BUY.
      unitOfMeasure: 'EA',
    }));

    let response: any[];
    try {
      response = await checkItemAvailability(ACCOUNT_ID, itemsRequest, SHIP_TO_ID);
    } catch (e: any) {
      errors += chunk.length;
      console.error(`  batch ${i}-${i + chunk.length}: ${(e.message || e).slice(0, 200)}`);
      continue;
    }

    // Map response back to rows by itemId. McKesson echoes the input itemId
    // (or "0" for unknown items).
    const byItem = new Map<string, any>();
    for (const r of response) {
      if (r.itemId) byItem.set(String(r.itemId), r);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of chunk) {
        const apiRow = byItem.get(row.mckesson_item_id);
        if (!apiRow) {
          invalid++;
          await client.query(
            `UPDATE supply_items
             SET mckesson_purchasable = false,
                 mckesson_last_synced_at = NOW()
             WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        const sell = pickUOM(apiRow.unitOfMeasures, 'SELL');
        const buy = pickUOM(apiRow.unitOfMeasures, 'BUY');
        const isPurchasable = !!apiRow.status?.purchasable;
        if (isPurchasable) purchasable++;

        // Detect SELL UOM mismatch between catalog xls and live API
        if (sell && row.mckesson_unit_of_measure && sell.unitOfMeasure !== row.mckesson_unit_of_measure) {
          uomMismatch++;
          mismatches.push({
            id: row.id,
            itemId: row.mckesson_item_id,
            catalogUOM: row.mckesson_unit_of_measure,
            apiSellUOM: sell.unitOfMeasure,
          });
        }

        // lastPurchaseDate may appear on either SELL or BUY UOM. Take whichever
        // is non-zero ("00000000" means never purchased).
        const lastPurchaseRaw =
          (buy?.lastPurchaseDate && buy.lastPurchaseDate !== '00000000' ? buy.lastPurchaseDate : null) ||
          (sell?.lastPurchaseDate && sell.lastPurchaseDate !== '00000000' ? sell.lastPurchaseDate : null) ||
          null;

        await client.query(
          `UPDATE supply_items
           SET mckesson_buy_unit_of_measure = $1,
               mckesson_buy_eaches          = $2,
               mckesson_sell_eaches         = $3,
               mckesson_weight_lb           = $4,
               mckesson_purchasable         = $5,
               mckesson_replacement_id      = $6,
               mckesson_storage_requirement = $7,
               mckesson_last_purchase_date  = $8,
               mckesson_last_synced_at      = NOW()
           WHERE id = $9`,
          [
            buy?.unitOfMeasure ?? null,
            buy?.eaches ?? null,
            sell?.eaches ?? null,
            buy?.weight?.weight ?? sell?.weight?.weight ?? null,
            isPurchasable,
            apiRow.replacement?.replacementId ?? null,
            apiRow.storageRequirement ?? null,
            lastPurchaseRaw,
            row.id,
          ]
        );
        synced++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    process.stdout.write(`  batch ${i / BATCH_SIZE + 1}: ${synced}/${rows.length} synced\r`);
  }

  console.log(`\n\n✓ Synced ${synced}/${rows.length}`);
  console.log(`  purchasable: ${purchasable}`);
  console.log(`  invalid item id (not echoed by API): ${invalid}`);
  console.log(`  errors: ${errors}`);
  console.log(`  SELL-UOM mismatches (catalog vs API): ${uomMismatch}`);
  if (mismatches.length > 0 && mismatches.length <= 20) {
    console.log('\nMismatches:');
    for (const m of mismatches) {
      console.log(`  id=${m.id} item=${m.itemId} catalog=${m.catalogUOM} api=${m.apiSellUOM}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[SYNC]', e);
  process.exit(1);
});

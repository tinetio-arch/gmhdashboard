/**
 * Run the fuzzy matcher across all unmapped hand-curated supply_items and
 * print a ranked report. Does NOT mutate the database — that's a separate
 * apply step (--apply flag below).
 *
 * Modes:
 *   tsx scripts/match-supplies-mckesson.ts            # report only
 *   tsx scripts/match-supplies-mckesson.ts --apply    # apply HIGH confidence matches
 *   tsx scripts/match-supplies-mckesson.ts --apply --include-medium  # also auto-apply MEDIUM
 *   tsx scripts/match-supplies-mckesson.ts --json     # print JSON suggestions for UI
 *
 * Apply mechanics (when --apply is set):
 *   For each matched pair (curated_row, mckesson_row):
 *     1. Move any supply_counts / supply_count_history rows from mckesson_row.id
 *        to curated_row.id (defensive — usually empty, since McKesson rows
 *        haven't been counted)
 *     2. Copy McKesson catalog fields onto curated_row
 *     3. Delete the duplicate mckesson_row (now redundant)
 */
import 'dotenv/config';
import { query, getPool } from '../lib/db';
import {
  buildIDF,
  rankMatches,
  classifyConfidence,
  tokenize,
  extractSpecs,
  type CuratedItem,
  type McKessonCandidate,
  type ScoredMatch,
  type Confidence,
} from '../lib/mckessonMatcher';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_MEDIUM = args.includes('--include-medium');
const JSON_OUT = args.includes('--json');

interface Suggestion {
  curated: CuratedItem;
  topMatches: Array<{ candidate: McKessonCandidate; score: number; reason: string }>;
  confidence: Confidence;
}

async function main() {
  const curated = await query<CuratedItem>(`
    SELECT id, name, category, unit
    FROM supply_items
    WHERE mckesson_item_id IS NULL AND active = true
    ORDER BY id
  `);

  const candidates = await query<McKessonCandidate>(`
    SELECT id, mckesson_item_id, name, category, minor_category,
           manufacturer, manufacturer_part_number, stock_status,
           mckesson_unit_of_measure, mckesson_buy_unit_of_measure,
           mckesson_purchasable, mckesson_last_purchase_date
    FROM supply_items
    WHERE mckesson_item_id IS NOT NULL AND active = true
  `);

  if (!JSON_OUT) {
    console.log(`Matching ${curated.length} curated items against ${candidates.length} McKesson catalog rows…\n`);
  }

  // Pre-tokenize candidates and build IDF
  const candCache = new Map<number, { tokens: string[]; specs: string[] }>();
  for (const c of candidates) {
    const t = tokenize(c.name);
    candCache.set(c.id, { tokens: t, specs: extractSpecs(t) });
  }
  const idf = buildIDF(Array.from(candCache.values()));

  // Score every curated item
  const suggestions: Suggestion[] = [];
  for (const cur of curated) {
    const top = rankMatches(cur, candidates, idf, candCache, 5);
    const confidence = classifyConfidence(top[0], top[1]);
    suggestions.push({
      curated: cur,
      topMatches: top.map((m) => ({ candidate: m.candidate, score: m.score, reason: m.reason })),
      confidence,
    });
  }

  // ─── JSON mode (for UI) ─────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify(suggestions, null, 2));
    process.exit(0);
  }

  // ─── Print human report ─────────────────────────────
  const buckets: Record<Confidence, Suggestion[]> = { high: [], medium: [], low: [], none: [] };
  for (const s of suggestions) buckets[s.confidence].push(s);

  for (const conf of ['high', 'medium', 'low', 'none'] as Confidence[]) {
    const list = buckets[conf];
    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`  ${conf.toUpperCase()} confidence — ${list.length} item(s)`);
    console.log(`══════════════════════════════════════════════════════`);
    for (const s of list) {
      console.log(`\n  curated #${s.curated.id} [${s.curated.category}] "${s.curated.name}"`);
      for (let i = 0; i < Math.min(s.topMatches.length, conf === 'high' ? 1 : 3); i++) {
        const m = s.topMatches[i];
        const prefix = i === 0 ? '➜' : ' ';
        const purchasable = m.candidate.mckesson_purchasable ? '✓' : '·';
        const ordered = m.candidate.mckesson_last_purchase_date && m.candidate.mckesson_last_purchase_date !== '00000000' ? `📦${m.candidate.mckesson_last_purchase_date.slice(0, 6)}` : '';
        console.log(`     ${prefix} [${m.score.toFixed(2)}] ${purchasable} ${m.candidate.mckesson_item_id.padEnd(8)} ${ordered.padEnd(9)} | ${m.candidate.name.slice(0, 80)}`);
        if (i === 0 && m.reason) console.log(`         reason: ${m.reason}`);
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`Summary: high=${buckets.high.length} medium=${buckets.medium.length} low=${buckets.low.length} none=${buckets.none.length}`);

  if (!APPLY) {
    console.log(`\n(Report-only mode. Re-run with --apply to merge HIGH confidence matches.)`);
    process.exit(0);
  }

  // ─── Apply mode ─────────────────────────────────────
  const toApply = INCLUDE_MEDIUM ? [...buckets.high, ...buckets.medium] : [...buckets.high];
  console.log(`\nApplying ${toApply.length} ${INCLUDE_MEDIUM ? '(high+medium)' : '(high only)'} match(es)…`);

  const pool = getPool();
  const client = await pool.connect();
  let merged = 0;
  let mergeErrors = 0;
  try {
    await client.query('BEGIN');
    for (const s of toApply) {
      const target = s.topMatches[0].candidate;
      try {
        // 1. Move supply_counts / supply_count_history from McKesson row → curated row
        await client.query(
          `UPDATE supply_counts SET item_id = $1 WHERE item_id = $2 AND NOT EXISTS (
              SELECT 1 FROM supply_counts sc2 WHERE sc2.item_id = $1 AND sc2.location = supply_counts.location
            )`,
          [s.curated.id, target.id]
        );
        await client.query(`DELETE FROM supply_counts WHERE item_id = $1`, [target.id]);
        await client.query(`UPDATE supply_count_history SET item_id = $1 WHERE item_id = $2`, [s.curated.id, target.id]);

        // 2. Snapshot McKesson row's catalog fields BEFORE we null its
        // mckesson_item_id (UNIQUE partial index would otherwise reject the
        // copy onto the curated row).
        const snap = await client.query(
          `SELECT mckesson_item_id, mckesson_unit_of_measure, mckesson_buy_unit_of_measure,
                  mckesson_buy_eaches, mckesson_sell_eaches, mckesson_weight_lb,
                  mckesson_purchasable, mckesson_replacement_id, mckesson_storage_requirement,
                  mckesson_last_purchase_date, mckesson_last_synced_at,
                  manufacturer, manufacturer_part_number, minor_category, stock_status
             FROM supply_items WHERE id = $1`,
          [target.id]
        );
        const f = snap.rows[0];

        // 3. NULL the old row's mckesson_item_id to free the unique index.
        await client.query(`UPDATE supply_items SET mckesson_item_id = NULL WHERE id = $1`, [target.id]);

        // 4. Copy snapshot onto curated row.
        await client.query(
          `UPDATE supply_items SET
              mckesson_item_id              = $2,
              mckesson_unit_of_measure      = $3,
              mckesson_buy_unit_of_measure  = $4,
              mckesson_buy_eaches           = $5,
              mckesson_sell_eaches          = $6,
              mckesson_weight_lb            = $7,
              mckesson_purchasable          = $8,
              mckesson_replacement_id       = $9,
              mckesson_storage_requirement  = $10,
              mckesson_last_purchase_date   = $11,
              mckesson_last_synced_at       = $12,
              manufacturer                  = COALESCE(manufacturer, $13),
              manufacturer_part_number      = COALESCE(manufacturer_part_number, $14),
              minor_category                = COALESCE(minor_category, $15),
              stock_status                  = $16,
              updated_at                    = NOW()
           WHERE id = $1`,
          [
            s.curated.id,
            f.mckesson_item_id, f.mckesson_unit_of_measure, f.mckesson_buy_unit_of_measure,
            f.mckesson_buy_eaches, f.mckesson_sell_eaches, f.mckesson_weight_lb,
            f.mckesson_purchasable, f.mckesson_replacement_id, f.mckesson_storage_requirement,
            f.mckesson_last_purchase_date, f.mckesson_last_synced_at,
            f.manufacturer, f.manufacturer_part_number, f.minor_category, f.stock_status,
          ]
        );

        // 5. Delete the now-empty old row.
        await client.query(`DELETE FROM supply_items WHERE id = $1`, [target.id]);

        merged++;
      } catch (e: any) {
        mergeErrors++;
        console.error(`  merge failed for curated #${s.curated.id} → ${target.mckesson_item_id}: ${e.message}`);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`\n✓ Merged ${merged} item(s). errors=${mergeErrors}`);
  process.exit(mergeErrors > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[MATCH]', e); process.exit(1); });

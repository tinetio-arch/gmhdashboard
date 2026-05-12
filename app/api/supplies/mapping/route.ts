import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  buildIDF,
  rankMatches,
  classifyConfidence,
  tokenize,
  extractSpecs,
  type CuratedItem,
  type McKessonCandidate,
} from '@/lib/mckessonMatcher';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supplies/mapping
 * Returns ranked McKesson catalog suggestions for every unmapped curated item.
 * Each curated item gets up to 5 candidate matches with score + reason.
 */
export async function GET(request: NextRequest) {
  try {
    const curated = await query<CuratedItem>(`
      SELECT id, name, category, unit
      FROM supply_items
      WHERE mckesson_item_id IS NULL
        AND active = true
        AND COALESCE(notes, '') NOT LIKE '%[no-mckesson-match]%'
      ORDER BY category, name
    `);

    const candidates = await query<McKessonCandidate>(`
      SELECT id, mckesson_item_id, name, category, minor_category,
             manufacturer, manufacturer_part_number, stock_status,
             mckesson_unit_of_measure, mckesson_buy_unit_of_measure,
             mckesson_purchasable, mckesson_last_purchase_date
      FROM supply_items
      WHERE mckesson_item_id IS NOT NULL AND active = true
    `);

    // Items that have been skipped (tagged [no-mckesson-match]) but don't yet
    // have a supplier_name recorded — these are the "Non-McKesson, needs supplier"
    // queue that Phil can review separately to assign supplier+cost info.
    const skipped = await query<{
      id: number; name: string; category: string | null; unit: string | null;
      supplier_name: string | null; unit_cost: string | null; unit_cost_uom: string | null;
      supplier_part_number: string | null; supplier_url: string | null;
    }>(`
      SELECT id, name, category, unit,
             supplier_name, unit_cost, unit_cost_uom,
             supplier_part_number, supplier_url
      FROM supply_items
      WHERE mckesson_item_id IS NULL
        AND active = true
        AND COALESCE(notes, '') LIKE '%[no-mckesson-match]%'
        AND (supplier_name IS NULL OR supplier_name = '')
      ORDER BY category, name
    `);

    const candCache = new Map<number, { tokens: string[]; specs: string[] }>();
    for (const c of candidates) {
      const t = tokenize(c.name);
      candCache.set(c.id, { tokens: t, specs: extractSpecs(t) });
    }
    const idf = buildIDF(Array.from(candCache.values()));

    const items = curated.map((cur) => {
      const top = rankMatches(cur, candidates, idf, candCache, 5);
      const confidence = classifyConfidence(top[0], top[1]);
      return {
        curated: cur,
        confidence,
        candidates: top.map((m) => ({
          id: m.candidate.id,
          mckesson_item_id: m.candidate.mckesson_item_id,
          name: m.candidate.name,
          category: m.candidate.category,
          minor_category: m.candidate.minor_category,
          manufacturer: m.candidate.manufacturer,
          stock_status: m.candidate.stock_status,
          buy_uom: m.candidate.mckesson_buy_unit_of_measure,
          sell_uom: m.candidate.mckesson_unit_of_measure,
          purchasable: m.candidate.mckesson_purchasable,
          last_purchase_date: m.candidate.mckesson_last_purchase_date,
          score: Number(m.score.toFixed(3)),
          reason: m.reason,
        })),
      };
    });

    return NextResponse.json({
      items,
      skipped,
      totals: {
        curated: curated.length,
        candidates: candidates.length,
        high: items.filter((i) => i.confidence === 'high').length,
        medium: items.filter((i) => i.confidence === 'medium').length,
        low: items.filter((i) => i.confidence === 'low').length,
        none: items.filter((i) => i.confidence === 'none').length,
        skipped: skipped.length,
      },
    });
  } catch (error: any) {
    console.error('[SUPPLIES] mapping fetch failed:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/supplies/mapping
 * Apply a single mapping decision:
 *   - 'merge': curatedId ← mckessonRowId (transfers counts, copies catalog data)
 *   - 'skip': mark as "no McKesson match" so it disappears from suggestions
 *   - 'different-supplier': mark as non-McKesson AND record supplier+cost info
 *
 * Body: {
 *   curatedId: number,
 *   action: 'merge' | 'skip' | 'different-supplier',
 *   mckessonRowId?: number,                          // for 'merge'
 *   supplier_name?: string,                          // for 'different-supplier'
 *   unit_cost?: number,
 *   unit_cost_uom?: string,
 *   supplier_part_number?: string,
 *   supplier_url?: string,
 *   notes?: string,                                  // free-form, appended to notes
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { curatedId, action, mckessonRowId } = body;

    if (!curatedId || !action) {
      return NextResponse.json({ error: 'curatedId and action required' }, { status: 400 });
    }

    if (action === 'skip') {
      // Tag the row so the matcher skips it on subsequent runs.
      // Idempotent: only append if the tag isn't already present.
      await query(
        `UPDATE supply_items
         SET notes = CASE
                       WHEN COALESCE(notes, '') LIKE '%[no-mckesson-match]%'
                       THEN notes
                       ELSE COALESCE(notes, '') || E'\n[no-mckesson-match]'
                     END,
             updated_at = NOW()
         WHERE id = $1`,
        [curatedId]
      );
      return NextResponse.json({ ok: true, action: 'skip' });
    }

    if (action === 'undo-skip') {
      // Strip the [no-mckesson-match] tag so the item flows back into the matcher.
      // Preserves any other notes the user has entered.
      await query(
        `UPDATE supply_items
         SET notes = NULLIF(REPLACE(REPLACE(COALESCE(notes, ''), E'\n[no-mckesson-match]', ''), '[no-mckesson-match]', ''), ''),
             updated_at = NOW()
         WHERE id = $1`,
        [curatedId]
      );
      return NextResponse.json({ ok: true, action: 'undo-skip' });
    }

    if (action === 'different-supplier') {
      const {
        supplier_name,
        unit_cost,
        unit_cost_uom,
        supplier_part_number,
        supplier_url,
        notes,
      } = body;
      if (!supplier_name || typeof supplier_name !== 'string') {
        return NextResponse.json({ error: 'supplier_name required' }, { status: 400 });
      }
      if (unit_cost !== undefined && unit_cost !== null && (typeof unit_cost !== 'number' || unit_cost < 0)) {
        return NextResponse.json({ error: 'unit_cost must be a number >= 0' }, { status: 400 });
      }
      // Tag with [no-mckesson-match] so it disappears from suggestions, and
      // record supplier+cost. unit_cost_source defaults to 'manual'.
      await query(
        `UPDATE supply_items
         SET supplier_name           = $2,
             unit_cost                = $3::numeric,
             unit_cost_uom            = $4,
             unit_cost_source         = COALESCE(unit_cost_source, 'manual'),
             unit_cost_updated_at     = CASE WHEN $3::numeric IS NOT NULL THEN NOW() ELSE unit_cost_updated_at END,
             supplier_part_number     = COALESCE($5, supplier_part_number),
             supplier_url             = COALESCE($6, supplier_url),
             notes                    = CASE
                                          WHEN COALESCE(notes, '') LIKE '%[no-mckesson-match]%'
                                          THEN notes
                                          ELSE COALESCE(notes, '') || E'\n[no-mckesson-match]'
                                        END
                                        || COALESCE(E'\n' || $7::text, ''),
             updated_at               = NOW()
         WHERE id = $1`,
        [
          curatedId,
          supplier_name.trim(),
          unit_cost ?? null,
          unit_cost_uom?.trim() || null,
          supplier_part_number?.trim() || null,
          supplier_url?.trim() || null,
          notes?.trim() || null,
        ]
      );
      return NextResponse.json({ ok: true, action: 'different-supplier', supplier_name });
    }

    if (action === 'merge') {
      if (!mckessonRowId) {
        return NextResponse.json({ error: 'mckessonRowId required for merge' }, { status: 400 });
      }
      // Move counts/history from McKesson row → curated row, copy McKesson fields,
      // delete the now-redundant McKesson row.
      const { getPool } = await import('@/lib/db');
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 1. Verify both rows exist, curated is unmapped, and McKesson row is
        // still pristine. SELECT FOR UPDATE serializes parallel "Use this" clicks
        // so the second one waits for the first to commit, then sees the merged
        // state and short-circuits with a clear error instead of silently no-op'ing.
        const c = await client.query(
          `SELECT id, mckesson_item_id FROM supply_items WHERE id = $1 FOR UPDATE`,
          [curatedId]
        );
        if (c.rows.length === 0) throw new Error(`curated #${curatedId} not found`);
        if (c.rows[0].mckesson_item_id) throw new Error(`curated #${curatedId} already mapped to ${c.rows[0].mckesson_item_id}`);

        const m = await client.query(
          `SELECT id, mckesson_item_id FROM supply_items WHERE id = $1 FOR UPDATE`,
          [mckessonRowId]
        );
        if (m.rows.length === 0) throw new Error(`McKesson row #${mckessonRowId} not found`);
        if (!m.rows[0].mckesson_item_id) throw new Error(`McKesson row #${mckessonRowId} no longer has a mckesson_item_id (already merged elsewhere?)`);

        // 2. Move counts (avoid duplicate item+location violations)
        await client.query(
          `UPDATE supply_counts SET item_id = $1
             WHERE item_id = $2
               AND NOT EXISTS (
                 SELECT 1 FROM supply_counts sc2
                 WHERE sc2.item_id = $1 AND sc2.location = supply_counts.location
               )`,
          [curatedId, mckessonRowId]
        );
        await client.query(`DELETE FROM supply_counts WHERE item_id = $1`, [mckessonRowId]);
        await client.query(`UPDATE supply_count_history SET item_id = $1 WHERE item_id = $2`, [curatedId, mckessonRowId]);

        // 3. Snapshot the McKesson row's catalog fields. We must read them
        // BEFORE we null the unique mckesson_item_id, because once both rows
        // would hold the same value the UNIQUE partial index throws.
        const snap = await client.query(
          `SELECT mckesson_item_id, mckesson_unit_of_measure, mckesson_buy_unit_of_measure,
                  mckesson_buy_eaches, mckesson_sell_eaches, mckesson_weight_lb,
                  mckesson_purchasable, mckesson_replacement_id, mckesson_storage_requirement,
                  mckesson_last_purchase_date, mckesson_last_synced_at,
                  manufacturer, manufacturer_part_number, minor_category, stock_status
             FROM supply_items WHERE id = $1`,
          [mckessonRowId]
        );
        const s = snap.rows[0];

        // 4. NULL the old row's mckesson_item_id so the unique index frees up.
        await client.query(`UPDATE supply_items SET mckesson_item_id = NULL WHERE id = $1`, [mckessonRowId]);

        // 5. Copy snapshot onto curated row
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
            curatedId,
            s.mckesson_item_id, s.mckesson_unit_of_measure, s.mckesson_buy_unit_of_measure,
            s.mckesson_buy_eaches, s.mckesson_sell_eaches, s.mckesson_weight_lb,
            s.mckesson_purchasable, s.mckesson_replacement_id, s.mckesson_storage_requirement,
            s.mckesson_last_purchase_date, s.mckesson_last_synced_at,
            s.manufacturer, s.manufacturer_part_number, s.minor_category, s.stock_status,
          ]
        );

        // 6. Delete the old row (now stripped of catalog data)
        await client.query(`DELETE FROM supply_items WHERE id = $1`, [mckessonRowId]);

        await client.query('COMMIT');
        return NextResponse.json({ ok: true, action: 'merge', curatedId, deletedRow: mckessonRowId });
      } catch (e: any) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[SUPPLIES] mapping action failed:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

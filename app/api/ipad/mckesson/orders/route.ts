import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import {
  placeAndRecordOrderWithIdempotency,
  isMcKessonConfigured,
  getMcKessonAccountId,
  getMcKessonShipToAccountId,
  getMcKessonEnvironment,
} from '@/lib/mckesson';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ipad/mckesson/orders
 *
 * iPad-namespaced "New Order" endpoint. Lets staff put together a fresh order
 * from the McKesson catalog and either preview it (dryRun, default) or submit
 * it (live, subject to MCKESSON_ALLOW_PRODUCTION_ORDERS).
 *
 * Body:
 *   {
 *     items: [{ mckItemId, quantity, unitOfMeasure?, supplyItemId? }],   // required, 1..50 items
 *     poNumber?: string,                                                  // optional, <=30 chars
 *     accountId?: string,                                                 // optional, defaults to env bill-to
 *     shipToAccountId?: string,                                           // optional, defaults to env ship-to
 *     dryRun?: boolean,                                                   // default true
 *     idempotencyKey?: string,                                            // required when dryRun=false
 *   }
 *
 * Behaviour:
 *   - dryRun=true (default): no McKesson call, no DB write. Returns a
 *     preview enriched with supply_items metadata + warnings.
 *   - dryRun=false: requires idempotencyKey (uuid). Calls
 *     placeAndRecordOrderWithIdempotency, which respects the production gate
 *     in submitOrder().
 *   - Gate engaged → 503 with { gateEngaged: true }.
 *
 * Safety:
 *   - All non-purchasable items are warnings on dryRun, hard rejection on live.
 *   - Quantity capped at 999 per line.
 *   - PO number capped at 30 chars (McKesson limit).
 *   - items[] capped at 50 lines (a single iPad order shouldn't exceed this).
 */

const MAX_ITEMS = 50;
const MAX_QTY = 999;
const MAX_PO_LEN = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SupplyEnrichment {
  id: number;
  mckesson_item_id: string;
  name: string;
  manufacturer: string | null;
  manufacturer_part_number: string | null;
  mckesson_purchasable: boolean | null;
  mckesson_buy_unit_of_measure: string | null;
  mckesson_unit_of_measure: string | null;
  unit_cost: string | null;
  unit_cost_uom: string | null;
}

export async function POST(request: NextRequest) {
  // ── Auth ──
  try {
    await requireApiUser(request, 'write');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    if (!isMcKessonConfigured()) {
      return NextResponse.json({ error: 'McKesson not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({} as any));

    // ── Validate items[] ──
    const items: Array<{ mckItemId: string; quantity: number; unitOfMeasure?: string; supplyItemId?: number }> = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'items[] is required (at least one item)' }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json({ error: `items[] too large (max ${MAX_ITEMS} per order)` }, { status: 400 });
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it.mckItemId !== 'string' || !it.mckItemId.trim()) {
        return NextResponse.json({ error: `items[${i}].mckItemId missing` }, { status: 400 });
      }
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY || Math.floor(qty) !== qty) {
        return NextResponse.json({ error: `items[${i}].quantity must be an integer 1..${MAX_QTY}` }, { status: 400 });
      }
      it.quantity = qty;
      if (it.unitOfMeasure && typeof it.unitOfMeasure !== 'string') {
        return NextResponse.json({ error: `items[${i}].unitOfMeasure must be a string` }, { status: 400 });
      }
    }

    // ── Validate poNumber ──
    let poNumber: string | undefined = body.poNumber;
    if (poNumber !== undefined && poNumber !== null) {
      if (typeof poNumber !== 'string') {
        return NextResponse.json({ error: 'poNumber must be a string' }, { status: 400 });
      }
      poNumber = poNumber.trim();
      if (poNumber.length === 0) poNumber = undefined;
      else if (poNumber.length > MAX_PO_LEN) {
        return NextResponse.json({ error: `poNumber too long (max ${MAX_PO_LEN} chars)` }, { status: 400 });
      }
    }

    const accountId = (body.accountId as string) || getMcKessonAccountId();
    const shipToAccountId = (body.shipToAccountId as string) || getMcKessonShipToAccountId();
    if (!accountId || !shipToAccountId) {
      return NextResponse.json({ error: 'McKesson accountId/shipToAccountId not configured' }, { status: 503 });
    }

    const dryRun = body.dryRun !== false; // default true

    // ── Enrich items from supply_items (single SQL) ──
    const mckIds = items.map((i) => i.mckItemId);
    const enrich = await query<SupplyEnrichment>(
      `SELECT id, mckesson_item_id, name, manufacturer, manufacturer_part_number,
              mckesson_purchasable, mckesson_buy_unit_of_measure, mckesson_unit_of_measure,
              unit_cost, unit_cost_uom
         FROM supply_items
        WHERE mckesson_item_id = ANY($1::text[])`,
      [mckIds]
    );
    const byMckId = new Map(enrich.map((r) => [r.mckesson_item_id, r]));

    const warnings: string[] = [];
    const notPurchasable: string[] = [];
    const unknown: string[] = [];

    const previewLines = items.map((it) => {
      const enrichment = byMckId.get(it.mckItemId);
      if (!enrichment) {
        unknown.push(it.mckItemId);
        warnings.push(`Unknown SKU ${it.mckItemId} — not in supply_items catalog`);
      } else {
        if (enrichment.mckesson_purchasable === false) {
          notPurchasable.push(`${it.mckItemId} (${enrichment.name})`);
          warnings.push(`Not currently purchasable: ${enrichment.name} (${it.mckItemId})`);
        }
      }
      const unitCost = enrichment?.unit_cost ? Number(enrichment.unit_cost) : 0;
      const lineTotal = Number((unitCost * it.quantity).toFixed(2));
      const uom = it.unitOfMeasure || enrichment?.mckesson_unit_of_measure || enrichment?.mckesson_buy_unit_of_measure || 'EA';
      return {
        product_id: it.mckItemId,
        supply_item_id: enrichment?.id ?? null,
        name: enrichment?.name ?? `Unknown SKU ${it.mckItemId}`,
        manufacturer: enrichment?.manufacturer ?? null,
        manufacturer_part_number: enrichment?.manufacturer_part_number ?? null,
        purchasable: enrichment?.mckesson_purchasable ?? null,
        quantity: it.quantity,
        uom,
        unit_cost: unitCost || null,
        unit_cost_uom: enrichment?.unit_cost_uom ?? null,
        line_total: lineTotal,
      };
    });

    const totalEstimate = Number(previewLines.reduce((s, l) => s + (l.line_total || 0), 0).toFixed(2));

    const draft = {
      accountId,
      shipToAccountId,
      poNumber: poNumber ?? null,
      items: items.map((i) => ({
        mckItemId: i.mckItemId,
        quantity: i.quantity,
        unitOfMeasure: i.unitOfMeasure || byMckId.get(i.mckItemId)?.mckesson_unit_of_measure || 'EA',
        supplyItemId: byMckId.get(i.mckItemId)?.id ?? i.supplyItemId,
      })),
      preview: {
        lineCount: previewLines.length,
        totalEstimate,
        items: previewLines,
        warnings,
        notPurchasable,
        unknown,
        gateEngaged: process.env.MCKESSON_ALLOW_PRODUCTION_ORDERS !== 'true',
        environment: getMcKessonEnvironment(),
      },
    };

    // ── DryRun path ──
    if (dryRun) {
      return NextResponse.json({ dryRun: true, draft });
    }

    // ── Live submit path ──
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Cannot submit unknown SKUs: ${unknown.join(', ')}` }, { status: 400 });
    }
    if (notPurchasable.length > 0) {
      return NextResponse.json({ error: `Cannot submit non-purchasable items: ${notPurchasable.join(', ')}` }, { status: 400 });
    }

    const idempotencyKey: unknown = body.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey)) {
      return NextResponse.json({ error: 'idempotencyKey (UUID v4) is required for live submit' }, { status: 400 });
    }

    let result;
    try {
      result = await placeAndRecordOrderWithIdempotency(
        accountId,
        draft.items,
        shipToAccountId,
        poNumber,
        'ipad',
        idempotencyKey,
      );
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('Production orders are disabled')) {
        return NextResponse.json(
          { error: msg, gateEngaged: true, environment: getMcKessonEnvironment() },
          { status: 503 }
        );
      }
      throw e;
    }

    return NextResponse.json({
      dryRun: false,
      submitted: true,
      replay: result.replay,
      orderId: result.mckResponse.orderId || null,
      dbOrderId: result.dbOrder.id,
      poNumber: result.dbOrder.po_number,
      accepted: result.mckResponse.accepted ?? null,
      validation: result.mckResponse.validation ?? null,
      environment: getMcKessonEnvironment(),
    });
  } catch (error: any) {
    console.error('[IPAD/MCKESSON] new order failed:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

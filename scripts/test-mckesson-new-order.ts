/**
 * Acceptance tests for POST /api/ipad/mckesson/orders
 *
 * Hits the deployed route on localhost:3011 with the INTERNAL_AUTH_SECRET
 * header for auth. Verifies:
 *   1. dryRun default + preview shape
 *   2. validation errors (empty items, qty bounds, poNumber length, items[] cap)
 *   3. not-purchasable warning on dryRun
 *   4. not-purchasable rejection on live submit
 *   5. gate-engaged 503 (CRITICAL safety test — production gate must stay OFF)
 *   6. idempotencyKey required on live submit
 *   7. idempotencyKey replay (pre-seeded row in DB)
 *
 * No live McKesson submissions. The gate-engaged test (#5) IS the proof
 * that the safety check works — if it ever returns anything other than 503
 * gateEngaged:true, the build is BLOCKED.
 *
 * Run:
 *   cd ~/gmhdashboard && npx tsx scripts/test-mckesson-new-order.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query, getPool } from '../lib/db';

const BASE = process.env.MCK_TEST_BASE || 'http://localhost:3011';
const ENDPOINT = `${BASE}/ops/api/ipad/mckesson/orders`;
const AUTH = process.env.INTERNAL_AUTH_SECRET;

if (!AUTH) {
  console.error('INTERNAL_AUTH_SECRET not set in .env.local — cannot authenticate to test endpoint');
  process.exit(2);
}

// Known purchasable test SKUs (verified 2026-05-12)
const SKU_VIAL_ADAPTER_CLEARLINK = '455132';
const SKU_VIAL_ADAPTER_CLAVE = '1141132';
const SKU_NEEDLE_25G_1IN_SAFETY = '1150038';

// Known non-purchasable SKU (verified 2026-05-12)
const SKU_BAG_NOT_PURCHASABLE = '1163770';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function post(body: any, extraHeaders: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-auth': AUTH!,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function countOrders(): Promise<number> {
  const r = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mckesson_orders`);
  return Number(r[0].n);
}

async function main() {
  console.log(`\n=== POST /api/ipad/mckesson/orders acceptance tests ===`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Gate (MCKESSON_ALLOW_PRODUCTION_ORDERS): ${process.env.MCKESSON_ALLOW_PRODUCTION_ORDERS}`);
  console.log(`Environment: ${process.env.MCKESSON_ENVIRONMENT}\n`);

  // ── #1 dryRun default ──
  console.log('[#1] dryRun defaults to true');
  {
    const before = await countOrders();
    const r = await post({
      items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 2 }],
    });
    const after = await countOrders();
    check('returns 200', r.status === 200, `got ${r.status}`);
    check('dryRun=true in response', r.json.dryRun === true, JSON.stringify(r.json).slice(0, 200));
    check('no mckesson_orders row created', after === before, `before=${before} after=${after}`);
  }

  // ── #2 dryRun preview shape ──
  console.log('\n[#2] dryRun preview shape (3-item test order)');
  {
    const r = await post({
      items: [
        { mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 2 },
        { mckItemId: SKU_VIAL_ADAPTER_CLAVE, quantity: 2 },
        { mckItemId: SKU_NEEDLE_25G_1IN_SAFETY, quantity: 5 },
      ],
      poNumber: 'TEST-DRYRUN-001',
    });
    check('returns 200', r.status === 200);
    check('draft.preview.lineCount == 3', r.json?.draft?.preview?.lineCount === 3);
    check('draft.items.length == 3', r.json?.draft?.items?.length === 3);
    check('preview includes name for vial adapter', /Vial Adapter/i.test(r.json?.draft?.preview?.items?.[0]?.name || ''));
    check('preview.warnings is array', Array.isArray(r.json?.draft?.preview?.warnings));
    check('preview.gateEngaged is true (gate is OFF)', r.json?.draft?.preview?.gateEngaged === true);
    check('draft.poNumber == TEST-DRYRUN-001', r.json?.draft?.poNumber === 'TEST-DRYRUN-001');
  }

  // ── #3 validation: empty items ──
  console.log('\n[#3] validation: empty items');
  {
    const r = await post({ items: [] });
    check('returns 400', r.status === 400);
    check('error mentions items[]', /items/i.test(r.json?.error || ''));
  }

  // ── #4 validation: qty=0 ──
  console.log('\n[#4] validation: qty=0');
  {
    const r = await post({ items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 0 }] });
    check('returns 400', r.status === 400);
    check('error mentions quantity', /quantity/i.test(r.json?.error || ''));
  }

  // ── #5 validation: qty=1000 ──
  console.log('\n[#5] validation: qty=1000');
  {
    const r = await post({ items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1000 }] });
    check('returns 400', r.status === 400);
    check('error mentions quantity', /quantity/i.test(r.json?.error || ''));
  }

  // ── #6 validation: poNumber too long ──
  console.log('\n[#6] validation: poNumber=31 chars');
  {
    const r = await post({
      items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1 }],
      poNumber: 'X'.repeat(31),
    });
    check('returns 400', r.status === 400);
    check('error mentions poNumber', /poNumber|too long/i.test(r.json?.error || ''));
  }

  // ── #7 validation: items[] cap ──
  console.log('\n[#7] validation: items[] over 50 items');
  {
    const items = Array.from({ length: 51 }, () => ({ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1 }));
    const r = await post({ items });
    check('returns 400', r.status === 400);
  }

  // ── #8 not-purchasable warning on dryRun ──
  console.log('\n[#8] not-purchasable warning on dryRun');
  {
    const r = await post({
      items: [{ mckItemId: SKU_BAG_NOT_PURCHASABLE, quantity: 1 }],
    });
    check('returns 200 (warning, not error)', r.status === 200);
    const warnings: string[] = r.json?.draft?.preview?.warnings || [];
    check('warnings includes "Not currently purchasable"', warnings.some(w => /Not currently purchasable/i.test(w)));
    check('notPurchasable array is non-empty', (r.json?.draft?.preview?.notPurchasable || []).length > 0);
  }

  // ── #9 idempotencyKey required on live submit ──
  console.log('\n[#9] idempotencyKey required when dryRun=false');
  {
    const r = await post({
      items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1 }],
      dryRun: false,
    });
    check('returns 400', r.status === 400);
    check('error mentions idempotencyKey', /idempotencyKey|UUID/i.test(r.json?.error || ''));
  }

  // ── #10 non-purchasable rejection on live submit ──
  console.log('\n[#10] not-purchasable rejection on live submit');
  {
    const r = await post({
      items: [{ mckItemId: SKU_BAG_NOT_PURCHASABLE, quantity: 1 }],
      dryRun: false,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    check('returns 400', r.status === 400);
    check('error mentions non-purchasable', /non-purchasable|not.+purchasable/i.test(r.json?.error || ''));
  }

  // ── #11 CRITICAL: gate engaged 503 ──
  console.log('\n[#11] CRITICAL: production gate engaged returns 503 (gate must stay OFF)');
  {
    // Clean any pre-existing test idempotency keys
    await query(`DELETE FROM mckesson_orders WHERE idempotency_key LIKE 'aaaaaaaa-%'`);

    const beforeOrders = await countOrders();
    const r = await post({
      items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1 }],
      dryRun: false,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      poNumber: 'TEST-GATE-001',
    });
    const afterOrders = await countOrders();
    check('returns 503', r.status === 503, `got ${r.status} body=${JSON.stringify(r.json).slice(0,200)}`);
    check('gateEngaged:true in response', r.json?.gateEngaged === true);
    check('error mentions "Production orders are disabled"', /Production orders are disabled/i.test(r.json?.error || ''));
    check('NO mckesson_orders row was created', afterOrders === beforeOrders, `before=${beforeOrders} after=${afterOrders}`);
  }

  // ── #12 idempotency replay ──
  console.log('\n[#12] idempotencyKey replay returns existing row without calling McKesson');
  {
    // Seed a fake "accepted" row directly in DB
    const replayKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await query(`DELETE FROM mckesson_orders WHERE idempotency_key = $1`, [replayKey]);
    const inserted = await query<{ id: number }>(
      `INSERT INTO mckesson_orders (mckesson_order_id, account_id, po_number, status, order_data, response_data, total_items, created_by, idempotency_key)
       VALUES ('FAKE-12345', '62477188', 'TEST-REPLAY-001', 'accepted', $1::jsonb, $2::jsonb, 1, 'replay-test', $3)
       RETURNING id`,
      [
        JSON.stringify({ items: [{ itemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1, unitOfMeasure: 'EA' }] }),
        JSON.stringify({ accepted: true, orderId: 'FAKE-12345', validation: [] }),
        replayKey,
      ]
    );
    const seededId = inserted[0].id;

    const beforeCount = await countOrders();
    const r = await post({
      items: [{ mckItemId: SKU_VIAL_ADAPTER_CLEARLINK, quantity: 1 }],
      dryRun: false,
      idempotencyKey: replayKey,
      poNumber: 'TEST-REPLAY-001',
    });
    const afterCount = await countOrders();
    check('returns 200', r.status === 200, `got ${r.status} body=${JSON.stringify(r.json).slice(0,200)}`);
    check('submitted:true in response', r.json?.submitted === true);
    check('replay:true in response', r.json?.replay === true);
    check('orderId == FAKE-12345', r.json?.orderId === 'FAKE-12345');
    check('dbOrderId == seeded row id', r.json?.dbOrderId === seededId);
    check('NO new row created (replay only)', afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`);

    // Clean up
    await query(`DELETE FROM mckesson_orders WHERE idempotency_key = $1`, [replayKey]);
  }

  // ── Final cleanup ──
  await query(`DELETE FROM mckesson_orders WHERE idempotency_key LIKE 'aaaaaaaa-%' OR idempotency_key LIKE 'bbbbbbbb-%'`);

  console.log(`\n=== Results ===`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  await getPool().end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(2);
});

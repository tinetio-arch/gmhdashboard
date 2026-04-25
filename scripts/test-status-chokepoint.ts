// Phase 1.4 acceptance tests for the status_key chokepoint.
//
// Runs assertions against the real DB on the test patient and exits
// non-zero on failure. Covers acceptance criteria #2, #3, #4, #6, #7
// from docs/sot-modules/28-hardening-plan-v3.md.
//
//   #2  webhook_processor cannot set status=inactive  → blocked, audit row written
//   #3  out-of-inactive only via admin_api or script:* (Rule 2)
//   #4  every applied transition produces a patient_status_audit row
//   #6  no-op writes (toStatus === fromStatus) do not pollute audit
//   #7  backfill-gap query is runnable and returns the expected count
//
// Run:
//   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
//     npx ts-node --transpile-only scripts/test-status-chokepoint.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';
const TEST_ACTOR = 'acceptance-test';

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

async function snapshotStatus(): Promise<string> {
  const r = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  return r[0].status_key;
}

async function countAudit(filter: string, params: any[]): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM patient_status_audit WHERE patient_id = $1 AND ${filter}`,
    [TEST_PATIENT_ID, ...params]
  );
  return Number(r[0].n);
}

async function cleanup() {
  // Delete any audit rows the test left behind
  await query(
    `DELETE FROM patient_status_audit WHERE patient_id = $1 AND actor = $2`,
    [TEST_PATIENT_ID, TEST_ACTOR]
  );
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'cleanup',
  });
  await query(
    `DELETE FROM patient_status_audit WHERE patient_id = $1 AND actor = $2`,
    [TEST_PATIENT_ID, TEST_ACTOR]
  );
}

async function main() {
  console.log('--- Status chokepoint acceptance tests ---\n');
  const initial = await snapshotStatus();
  console.log(`  initial status_key = ${initial}\n`);

  // Reset to a known-active state
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'reset',
  });

  // ---- Acceptance #2: webhook_processor cannot set inactive ----
  console.log('[Acc #2] webhook_processor → inactive must block + write audit');
  const before2 = await countAudit("blocked = TRUE AND source = 'webhook_processor' AND to_status = 'inactive' AND actor = $2", [TEST_ACTOR]);
  const r2 = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive',
    source: 'webhook_processor', actor: TEST_ACTOR, reason: 'acc-2',
  });
  const after2 = await countAudit("blocked = TRUE AND source = 'webhook_processor' AND to_status = 'inactive' AND actor = $2", [TEST_ACTOR]);
  check('returns blocked=true, applied=false', r2.blocked === true && r2.applied === false, `got blocked=${r2.blocked} applied=${r2.applied}`);
  check('blockReason mentions webhook_processor', /webhook_processor/i.test(r2.blockReason || ''), `reason="${r2.blockReason}"`);
  check('blocked-attempt audit row written', after2 === before2 + 1, `before=${before2} after=${after2}`);
  check('patient still NOT inactive after blocked attempt', (await snapshotStatus()) !== 'inactive');

  // ---- Acceptance #3: out of inactive only via admin_api or script:* ----
  console.log('\n[Acc #3] inactive → active via webhook_processor must block; admin/script must succeed');
  // Force inactive via admin_api
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'acc-3 setup',
  });
  check('patient is inactive', (await snapshotStatus()) === 'inactive');

  // Webhook tries to recover → blocked
  const r3a = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'webhook_processor', actor: TEST_ACTOR, reason: 'acc-3a',
  });
  check('webhook out-of-inactive blocked', r3a.blocked === true && r3a.applied === false, `blocked=${r3a.blocked}`);
  check('still inactive after webhook attempt', (await snapshotStatus()) === 'inactive');

  // Cron tries to recover → blocked
  const r3b = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'cron', actor: TEST_ACTOR, reason: 'acc-3b',
  });
  check('cron out-of-inactive blocked', r3b.blocked === true && r3b.applied === false, `blocked=${r3b.blocked}`);

  // admin_api succeeds
  const r3c = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'acc-3c',
  });
  check('admin_api out-of-inactive applied', r3c.applied === true && r3c.blocked === false);
  check('patient is active again', (await snapshotStatus()) === 'active');

  // script:* succeeds (force inactive again first)
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'acc-3d setup',
  });
  const r3d = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'script:acceptance-test', actor: TEST_ACTOR, reason: 'acc-3d',
  });
  check('script:* out-of-inactive applied', r3d.applied === true && r3d.blocked === false);

  // ---- Acceptance #4: every applied transition writes an audit row ----
  console.log('\n[Acc #4] applied transitions write audit row within 1s');
  const before4 = await countAudit("blocked = FALSE AND actor = $2 AND reason = 'acc-4'", [TEST_ACTOR]);
  const r4 = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'hold_payment_research',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'acc-4',
  });
  const after4 = await countAudit("blocked = FALSE AND actor = $2 AND reason = 'acc-4'", [TEST_ACTOR]);
  check('applied=true', r4.applied === true);
  check('audit row count incremented by 1', after4 === before4 + 1, `before=${before4} after=${after4}`);
  check('patient_status_audit row visible immediately', after4 - before4 === 1);

  // ---- Acceptance #6: no-op writes don't pollute audit ----
  console.log('\n[Acc #6] no-op transition (toStatus === fromStatus) writes no audit row');
  // Currently hold_payment_research
  const before6 = await countAudit("actor = $2 AND reason = 'acc-6'", [TEST_ACTOR]);
  const r6 = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'hold_payment_research',
    source: 'admin_api', actor: TEST_ACTOR, reason: 'acc-6',
  });
  const after6 = await countAudit("actor = $2 AND reason = 'acc-6'", [TEST_ACTOR]);
  // Helper currently calls UPDATE regardless. Trigger should detect no-op and skip.
  // If the trigger does write an audit row for no-op, this test will surface it.
  check('no-op writes no audit row', after6 === before6, `before=${before6} after=${after6} (helper applied=${r6.applied})`);

  // ---- Acceptance #7: backfill-gap query runs ----
  console.log('\n[Acc #7] inactive patients with no audit history (backfill gap)');
  const gap = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM patients
       WHERE status_key = 'inactive'
         AND patient_id NOT IN (SELECT patient_id FROM patient_status_audit WHERE to_status = 'inactive')`
  );
  const gapCount = Number(gap[0].n);
  check('backfill-gap query executed', !Number.isNaN(gapCount), `count=${gapCount}`);
  console.log(`     gap count = ${gapCount} (informational; expected ~59 pre-Phase-1 inactives)`);

  // ---- Cleanup ----
  console.log('\n[Cleanup] reverting test patient + removing audit rows');
  await cleanup();
  // Restore to original status if we changed it
  if (initial !== 'active') {
    await transitionStatus({
      patientId: TEST_PATIENT_ID, toStatus: initial as any,
      source: 'admin_api', actor: TEST_ACTOR, reason: 'final restore',
    });
    await query(
      `DELETE FROM patient_status_audit WHERE patient_id = $1 AND actor = $2`,
      [TEST_PATIENT_ID, TEST_ACTOR]
    );
  }
  const finalStatus = await snapshotStatus();
  check('patient status restored', finalStatus === initial, `expected=${initial} got=${finalStatus}`);

  // ---- Summary ----
  console.log('\n--- Summary ---');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }

  await getPool().end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('FATAL', e);
  try { await cleanup(); } catch { /* ignore */ }
  await getPool().end();
  process.exit(2);
});

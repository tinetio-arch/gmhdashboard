// E2E debug for the 5 webhook writers I migrated but didn't yet exercise:
//  #5 recurring-payment-failed via healthie_id (process-healthie-webhooks.ts ~line 470)
//  #6 recurring-payment-failed via name fallback
//  #7 declined-webhook via name match (the writer where I added the inactive filter)
//  #8 scheduled-payment-failed via healthie_clients JOIN (~line 1054)
//  #9 scheduled-payment-failed via name fallback
//
// Each block mirrors the migrated flow inline against Phil's test patient,
// validates audit row + alert_status + candidates filter, then reverts.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';
const TEST_HEALTHIE_ID = '12123979';
const TEST_NAME = 'Phillip Schafer';

async function ensureActive() {
  const cur = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  if (cur[0].status_key !== 'active') {
    await transitionStatus({
      patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api',
      actor: 'debug-writers-5-9-setup', reason: 'reset to active',
    });
  }
}

async function inspectAudit(label: string) {
  const r = await query(
    `SELECT from_status, to_status, source, actor, reason, blocked, metadata
       FROM patient_status_audit
      WHERE patient_id = $1 ORDER BY audit_id DESC LIMIT 1`,
    [TEST_PATIENT_ID]
  );
  console.log(`  AUDIT[${label}]:`, r[0]);
}

async function readState(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  STATE[${label}]:`, r[0]);
  return r[0];
}

// --- Writer #5: recurring-payment-failed via healthie_id ---
async function debugWriter5() {
  console.log('\n=== Writer #5: recurring-payment-failed (healthie_id match) ===');
  await ensureActive();
  const pool = getPool();

  const candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE healthie_client_id = $1
        AND status_key NOT IN ('hold_payment_research', 'inactive')`,
    [TEST_HEALTHIE_ID]
  )).rows;
  console.log('  candidates:', candidates.length);

  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: `Recurring payment failed: card declined`,
      metadata: { fn: 'debug5', state: 'failed', amount: 140, packageName: 'TRT', patientHealthieId: TEST_HEALTHIE_ID },
    });
    console.log('  transition:', t);
    if (!t.applied) continue;
    await pool.query(
      `UPDATE patients
          SET alert_status = 'Hold - Payment Research',
              notes = CASE WHEN notes IS NULL OR notes = '' THEN $1 ELSE notes || E'\n' || $1 END,
              last_modified = NOW()
        WHERE patient_id = $2::uuid`,
      [`[debug5] note`, cand.patient_id]
    );
  }
  await readState('after #5');
  await inspectAudit('after #5');
}

// --- Writer #6: recurring-payment-failed via name fallback (simulate empty healthie_id) ---
async function debugWriter6() {
  console.log('\n=== Writer #6: recurring-payment-failed (name fallback) ===');
  await ensureActive();
  const pool = getPool();

  // Simulate empty healthie_id match by using a non-existent ID
  let candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE healthie_client_id = $1
        AND status_key NOT IN ('hold_payment_research', 'inactive')`,
    ['ZZZ_NONEXISTENT_HEALTHIE_ID']
  )).rows;
  console.log('  candidates after healthie_id (should be 0):', candidates.length);

  if (candidates.length === 0) {
    candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
      `SELECT patient_id, full_name AS patient_name
         FROM patients
        WHERE LOWER(full_name) = LOWER($1)
          AND status_key NOT IN ('hold_payment_research', 'inactive')`,
      [TEST_NAME]
    )).rows;
    console.log('  candidates after name fallback:', candidates.length);
  }

  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: 'Recurring payment failed via name fallback',
      metadata: { fn: 'debug6' },
    });
    console.log('  transition:', t);
  }
  await readState('after #6');
  await inspectAudit('after #6');
}

// --- Writer #7: declined-webhook patient lookup by name; INACTIVE-SKIP behavior change ---
async function debugWriter7() {
  console.log('\n=== Writer #7: declined-webhook (with inactive-skip behavior change) ===');

  // First test: patient is active → should get put on hold
  await ensureActive();
  const pool = getPool();
  let candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE LOWER(full_name) = LOWER($1)
        AND status_key NOT IN ('hold_payment_research', 'inactive')`,
    [TEST_NAME]
  )).rows;
  console.log('  active patient → candidates (expect 1):', candidates.length);
  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: 'Declined webhook test',
      metadata: { fn: 'debug7-active' },
    });
    console.log('  transition (active→hold):', t.applied);
  }
  await readState('after #7 active path');

  // Second test: now patient is on hold → still should match (filter excludes already-hold)
  // Wait, my filter excludes already-hold. So candidates should be 0 on second call.
  candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE LOWER(full_name) = LOWER($1)
        AND status_key NOT IN ('hold_payment_research', 'inactive')`,
    [TEST_NAME]
  )).rows;
  console.log('  already-on-hold → candidates (expect 0, no double-hold):', candidates.length);

  // Third test: inactive-skip behavior change.
  // Move patient to inactive (admin source allowed) and check the filter excludes them.
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive', source: 'admin_api',
    actor: 'debug7-make-inactive', reason: 'test inactive-skip',
  });
  candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE LOWER(full_name) = LOWER($1)
        AND status_key NOT IN ('hold_payment_research', 'inactive')`,
    [TEST_NAME]
  )).rows;
  console.log('  inactive patient → candidates (expect 0 — webhook silently skips):', candidates.length);

  // Bonus: verify the trigger backstop would block if a webhook tried to flip inactive→hold
  // This is a defense-in-depth check. We'll attempt it directly.
  try {
    await transitionStatus({
      patientId: TEST_PATIENT_ID, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: 'should be blocked',
    });
    console.log('  ❌ Trigger did NOT block inactive→hold from webhook (BUG)');
  } catch (e: any) {
    // Helper pre-check rejects this BEFORE hitting the trigger; we should see {applied:false, blocked:true} not an exception
    console.log('  unexpected exception:', e.message);
  }
  // Helper actually returns blocked instead of throwing for inactive→other from non-admin/script
  const r = await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'hold_payment_research',
    source: 'webhook_processor', actor: 'system', reason: 'expect blocked',
  });
  console.log('  helper response for webhook trying inactive→hold (expect blocked):', r);

  // Cleanup: revert to active via admin
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api',
    actor: 'debug7-cleanup', reason: 'reset',
  });
  await readState('after #7 cleanup');
}

// --- Writer #8: scheduled-payment-failed via healthie_clients JOIN ---
async function debugWriter8() {
  console.log('\n=== Writer #8: scheduled-payment-failed (healthie_clients JOIN) ===');
  await ensureActive();
  const pool = getPool();

  const candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT p.patient_id, p.full_name AS patient_name
       FROM patients p
       JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text
      WHERE hc.healthie_client_id = $1
        AND hc.is_active = TRUE
        AND p.status_key NOT IN ('hold_payment_research', 'inactive')`,
    [TEST_HEALTHIE_ID]
  )).rows;
  console.log('  candidates from JOIN (expect 1):', candidates.length);

  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: 'Scheduled payment failed: insufficient_funds',
      metadata: { fn: 'debug8', healthiePatientId: TEST_HEALTHIE_ID },
    });
    console.log('  transition:', t);
  }
  await readState('after #8');
  await inspectAudit('after #8');
}

// --- Writer #9: scheduled-payment-failed via name fallback (when JOIN finds nothing) ---
async function debugWriter9() {
  console.log('\n=== Writer #9: scheduled-payment-failed (name fallback) ===');
  await ensureActive();
  const pool = getPool();

  // Simulate JOIN finding nothing
  let candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT p.patient_id, p.full_name AS patient_name
       FROM patients p
       JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text
      WHERE hc.healthie_client_id = $1
        AND hc.is_active = TRUE
        AND p.status_key NOT IN ('hold_payment_research', 'inactive')`,
    ['ZZZ_NONEXISTENT']
  )).rows;
  console.log('  JOIN candidates (expect 0):', candidates.length);

  if (candidates.length === 0) {
    candidates = (await pool.query<{ patient_id: string; patient_name: string }>(
      `SELECT patient_id, full_name AS patient_name
         FROM patients
        WHERE LOWER(full_name) = LOWER($1)
          AND status_key NOT IN ('hold_payment_research', 'inactive')`,
      [TEST_NAME]
    )).rows;
    console.log('  name-fallback candidates (expect 1):', candidates.length);
  }

  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id, toStatus: 'hold_payment_research',
      source: 'webhook_processor', actor: 'system',
      reason: 'Scheduled payment failed name fallback',
      metadata: { fn: 'debug9' },
    });
    console.log('  transition:', t);
  }
  await readState('after #9');
}

async function cleanupAll() {
  console.log('\n=== Cleanup ===');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api',
    actor: 'debug-writers-5-9-final', reason: 'final restore',
  });
  const del = await query(
    `DELETE FROM patient_status_audit
      WHERE patient_id = $1
        AND (actor LIKE 'debug-writers-5-9%' OR actor LIKE 'debug7%'
             OR (metadata->>'fn' IN ('debug5','debug6','debug7-active','debug8','debug9')))
      RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log('  cleaned up audit rows:', del.length);
  await readState('FINAL');
}

async function main() {
  await readState('initial');
  try {
    await debugWriter5();
    await ensureActive();
    await debugWriter6();
    await ensureActive();
    await debugWriter7();
    await ensureActive();
    await debugWriter8();
    await ensureActive();
    await debugWriter9();
  } finally {
    await cleanupAll();
    await getPool().end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });

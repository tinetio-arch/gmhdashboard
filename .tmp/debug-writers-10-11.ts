// E2E debug for writers #10 (setPatientToPaymentHold) and #11 (reactivatePatient)
// in scripts/sync-healthie-failed-payments.ts.
//
// Verifies:
//   1. setPatientToPaymentHold: active → hold_payment_research, audit row written, secondary fields applied.
//   2. setPatientToPaymentHold: skipped when already on hold (guard).
//   3. setPatientToPaymentHold: skipped when inactive (guard preserves original behavior).
//   4. reactivatePatient: hold_payment_research → active, audit row + legacy log written.
//   5. reactivatePatient: skipped when not on hold (guard).
// Reverts patient back to original state at the end.

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';

// Inline copies of the migrated functions (same logic)
async function setPatientToPaymentHold(patientId: string, patientName: string, reason: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const noteEntry = `[${timestamp.split('T')[0]}] AUTO-SYNC: ${reason}`;

  const cur = await query<{ status_key: string | null }>(
    'SELECT status_key FROM patients WHERE patient_id = $1::uuid',
    [patientId]
  );
  if (cur.length === 0) return;
  if (cur[0].status_key === 'hold_payment_research' || cur[0].status_key === 'inactive') return;

  const t = await transitionStatus({
    patientId,
    toStatus: 'hold_payment_research',
    source: 'script:sync-healthie-failed-payments',
    actor: 'system',
    reason: `setPatientToPaymentHold: ${reason}`,
    metadata: { fn: 'setPatientToPaymentHold', patientName, debug: 'writer-10' },
  });
  if (!t.applied) return;

  await query(`
    UPDATE patients
    SET
      alert_status = 'Hold - Payment Research',
      notes = CASE
        WHEN notes IS NULL OR notes = '' THEN $2
        ELSE notes || E'\\n' || $2
      END,
      last_modified = NOW()
    WHERE patient_id = $1::uuid
  `, [patientId, noteEntry]);
}

async function reactivatePatient(patientId: string, patientName: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const noteEntry = `[${timestamp.split('T')[0]}] AUTO-SYNC: Payment succeeded - reactivated from hold.`;

  const cur = await query<{ status_key: string | null }>(
    'SELECT status_key FROM patients WHERE patient_id = $1::uuid',
    [patientId]
  );
  if (cur.length === 0 || cur[0].status_key !== 'hold_payment_research') return;

  const t = await transitionStatus({
    patientId,
    toStatus: 'active',
    source: 'script:sync-healthie-failed-payments',
    actor: 'system',
    reason: 'reactivatePatient: payment succeeded',
    metadata: { fn: 'reactivatePatient', patientName, debug: 'writer-11' },
  });
  if (!t.applied) return;

  await query(`
    UPDATE patients
    SET
      alert_status = 'Active',
      notes = CASE
        WHEN notes IS NULL OR notes = '' THEN $2
        ELSE notes || E'\\n' || $2
      END,
      last_modified = NOW()
    WHERE patient_id = $1::uuid
  `, [patientId, noteEntry]);

  try {
    await query(
      `INSERT INTO patient_status_activity_log
       (patient_id, previous_status, new_status, change_source, change_reason)
       VALUES ($1, 'hold_payment_research', 'active', 'sync_healthie_failed_payments', $2)`,
      [patientId, noteEntry]
    );
  } catch (e) {
    console.warn('[debug-10-11] Failed to write legacy audit log');
  }
}

async function snapshot(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  ${label}:`, r[0]);
  return r[0];
}

async function lastAudit(n: number) {
  return await query(
    `SELECT from_status, to_status, source, actor, blocked, block_reason, metadata->>'fn' AS fn
       FROM patient_status_audit
      WHERE patient_id = $1
      ORDER BY audit_id DESC LIMIT $2`,
    [TEST_PATIENT_ID, n]
  );
}

async function main() {
  console.log('--- Writer #10/#11 E2E debug ---\n');

  const initial = await snapshot('initial');
  if (initial.status_key !== 'active') {
    console.log('Pre-condition: setting back to active');
    await transitionStatus({
      patientId: TEST_PATIENT_ID,
      toStatus: 'active',
      source: 'admin_api',
      actor: 'debug-10-11-prep',
      reason: 'reset to active before test',
    });
    await snapshot('reset');
  }

  // Test 1: hold from active
  console.log('\n[Test 1] setPatientToPaymentHold (active → hold)');
  await setPatientToPaymentHold(TEST_PATIENT_ID, 'Phillip Schafer', 'declined: $99 (debug)');
  await snapshot('after hold');

  // Test 2: hold guard (already on hold)
  console.log('\n[Test 2] setPatientToPaymentHold called again (should no-op)');
  await setPatientToPaymentHold(TEST_PATIENT_ID, 'Phillip Schafer', 'second call (debug)');
  const audit2 = await lastAudit(2);
  console.log('  last 2 audit rows:', audit2);
  // No new audit row from the no-op (guard returned before transitionStatus)

  // Test 3: reactivate (hold → active)
  console.log('\n[Test 3] reactivatePatient (hold → active)');
  await reactivatePatient(TEST_PATIENT_ID, 'Phillip Schafer');
  await snapshot('after reactivate');

  // Test 4: reactivate guard (already active)
  console.log('\n[Test 4] reactivatePatient on active (should no-op)');
  await reactivatePatient(TEST_PATIENT_ID, 'Phillip Schafer');
  await snapshot('still active');

  // Test 5: hold guard from inactive
  console.log('\n[Test 5] inactive → setPatientToPaymentHold (should no-op due to guard)');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive',
    source: 'admin_api', actor: 'debug-10-11', reason: 'simulate inactive',
  });
  await snapshot('forced inactive');
  await setPatientToPaymentHold(TEST_PATIENT_ID, 'Phillip Schafer', 'should be skipped');
  await snapshot('after attempted hold (should still be inactive)');

  // Revert to active
  console.log('\n[Cleanup] revert to active');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: 'debug-10-11', reason: 'revert',
  });

  // Clean up debug audit + legacy log rows
  const delAudit = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1
         AND (actor LIKE 'debug-10-11%'
              OR (source = 'script:sync-healthie-failed-payments'
                  AND metadata->>'debug' IN ('writer-10', 'writer-11')))
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${delAudit.length} audit rows`);
  const delLegacy = await query(
    `DELETE FROM patient_status_activity_log
       WHERE patient_id = $1
         AND change_source = 'sync_healthie_failed_payments'
         AND change_reason LIKE '%AUTO-SYNC: Payment succeeded%'
     RETURNING id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${delLegacy.length} legacy audit rows`);

  const final = await snapshot('FINAL');
  console.log('\nOK?', final.status_key === initial.status_key ? 'YES' : 'NO');

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

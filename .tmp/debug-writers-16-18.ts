// E2E debug for writers #16–#18
//   #16: scripts/fix-payment-hold-patients.ts (hold → active)
//   #17: scripts/process-unpaid-payments.ts (active → hold)
//   #18: scripts/merge-duplicate-patients.ts (active → inactive + secondary GHL fields)
//
// Mirrors the migrated logic inline against test patient and reverts.

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';

async function snapshot(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null; ghl_sync_status: string | null; ghl_sync_error: string | null }>(
    'SELECT status_key, alert_status, ghl_sync_status, ghl_sync_error FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  ${label}:`, r[0]);
  return r[0];
}

async function main() {
  console.log('--- Writer #16–#18 E2E debug ---\n');
  const initial = await snapshot('initial');

  // ---- Writer #17: active → hold via process-unpaid-payments ----
  console.log('\n[#17] active → hold (process-unpaid-payments)');
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api', actor: 'debug-16-18', reason: 'reset' });
  await snapshot('reset to active');
  const t17 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'hold_payment_research',
    source: 'script:process-unpaid-payments',
    actor: 'system',
    reason: 'Unpaid Healthie payment detected',
    metadata: { fn: 'process-unpaid-payments', debug: 'writer-17' },
  });
  console.log('  applied?', t17.applied);
  if (t17.applied) {
    await query(`UPDATE patients SET alert_status = 'Hold - Payment Research', notes = COALESCE(notes,'') || E'\\n[debug] AUTO: Unpaid Healthie payment detected. Status set to Hold.', last_modified = NOW() WHERE patient_id = $1::uuid`, [TEST_PATIENT_ID]);
  }
  await snapshot('after #17');

  // ---- Writer #16: hold → active via fix-payment-hold-patients ----
  console.log('\n[#16] hold → active (fix-payment-hold-patients)');
  const t16 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'script:fix-payment-hold-patients',
    actor: 'system',
    reason: 'Cron loop bug remediation: payment confirmed succeeded',
    metadata: { fn: 'fix-payment-hold', debug: 'writer-16' },
  });
  console.log('  applied?', t16.applied);
  if (t16.applied) {
    await query(`UPDATE patients SET alert_status = 'Active', notes = '[debug] cleaned', last_modified = NOW() WHERE patient_id = $1::uuid`, [TEST_PATIENT_ID]);
  }
  await snapshot('after #16');

  // ---- Writer #18: active → inactive via merge-duplicate-patients ----
  console.log('\n[#18] active → inactive (merge-duplicate-patients)');
  const t18 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'inactive',
    source: 'script:merge-duplicate-patients',
    actor: 'system',
    reason: 'Duplicate record - merged with FAKE_KEEP_ID',
    metadata: { fn: 'merge-duplicate-patients', keepId: 'FAKE_KEEP_ID', pair: 'debug-pair', debug: 'writer-18' },
  });
  console.log('  applied?', t18.applied);
  if (t18.applied) {
    await query(`UPDATE patients SET ghl_sync_status = 'skipped', ghl_sync_error = 'Duplicate record - merged with FAKE_KEEP_ID (debug)' WHERE patient_id = $1::uuid`, [TEST_PATIENT_ID]);
  }
  await snapshot('after #18 (should be inactive + ghl skipped)');

  // ---- Recovery: only admin_api/script:* can move out of inactive ----
  console.log('\n[Recovery] move out of inactive via admin_api');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: 'debug-16-18', reason: 'recover',
  });
  // Restore ghl_sync_status to whatever the initial was
  await query(
    `UPDATE patients SET ghl_sync_status = $2, ghl_sync_error = $3 WHERE patient_id = $1::uuid`,
    [TEST_PATIENT_ID, initial.ghl_sync_status, initial.ghl_sync_error]
  );

  // Cleanup audit rows
  const del = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1
         AND (actor = 'debug-16-18'
              OR metadata->>'debug' IN ('writer-16','writer-17','writer-18'))
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${del.length} audit rows`);

  const final = await snapshot('FINAL');
  const ok = final.status_key === initial.status_key
    && final.ghl_sync_status === initial.ghl_sync_status
    && final.ghl_sync_error === initial.ghl_sync_error;
  console.log('\nOK?', ok ? 'YES' : 'NO');

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

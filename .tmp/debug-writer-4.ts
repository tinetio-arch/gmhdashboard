// End-to-end debug of writer #4 (reactivatePatient in process-healthie-webhooks.ts).
// Set Phil's test patient to hold_payment_research, run the migrated reactivation
// flow inline (mirrors the function), verify audit + alert_status, then revert.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';
const TEST_NAME = 'Phillip Schafer';

async function setupHoldState() {
  const r = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'hold_payment_research',
    source: 'admin_api',
    actor: 'debug-writer-4-setup',
    reason: 'debug setup',
  });
  console.log('Setup → hold_payment_research:', r);
}

async function inlineReactivate(patientName: string, timestamp: string) {
  // Mirror the migrated function's logic without spinning up a duplicate pool
  const pool = getPool();
  const noteEntry = `[${timestamp}] PAYMENT RECEIVED - debug-writer-4 test`;

  const candidates = await pool.query<{ patient_id: string; patient_name: string }>(
    `SELECT patient_id, full_name AS patient_name
       FROM patients
      WHERE LOWER(full_name) = LOWER($1)
        AND status_key = 'hold_payment_research'`,
    [patientName]
  );
  console.log('Candidates found:', candidates.rows.length);

  const reactivated: any[] = [];
  for (const cand of candidates.rows) {
    const t = await transitionStatus({
      patientId: cand.patient_id,
      toStatus: 'active',
      source: 'webhook_processor',
      actor: 'system',
      reason: 'Payment received — auto-reactivated from hold',
      metadata: { fn: 'reactivatePatient', timestamp, patientName },
    });
    console.log('  transitionStatus result:', t);
    if (!t.applied) continue;
    await pool.query(
      `UPDATE patients
          SET alert_status = 'Active',
              notes = CASE WHEN notes IS NULL OR notes = '' THEN $1 ELSE notes || E'\\n' || $1 END,
              last_modified = NOW()
        WHERE patient_id = $2::uuid`,
      [noteEntry, cand.patient_id]
    );
    reactivated.push(cand);
  }
  return reactivated;
}

async function revertToActive() {
  const r = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'admin_api',
    actor: 'debug-writer-4-revert',
    reason: 'debug revert',
  });
  console.log('Revert ensures active:', r);
}

async function cleanup() {
  const del = await query(
    `DELETE FROM patient_status_audit WHERE patient_id = $1 AND
       (actor LIKE 'debug-writer-4%' OR
        (source = 'webhook_processor' AND metadata->>'fn' = 'reactivatePatient' AND metadata->>'patientName' = $2))
     RETURNING audit_id`,
    [TEST_PATIENT_ID, TEST_NAME]
  );
  console.log('Cleaned up audit rows:', del.length);
}

async function main() {
  const before = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('Initial state:', before[0]);

  await setupHoldState();

  const onHold = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('After setup (should be hold_payment_research):', onHold[0]);

  const reactivated = await inlineReactivate(TEST_NAME, new Date().toISOString());
  console.log('Reactivated rows:', reactivated.length);

  const afterReact = await query<{ status_key: string; alert_status: string | null; status_key_updated_at: Date | null }>(
    'SELECT status_key, alert_status, status_key_updated_at FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('After reactivation (should be active, alert_status=Active):', afterReact[0]);

  // Inspect audit rows from this run
  const audit = await query(
    `SELECT from_status, to_status, source, actor, reason, blocked
       FROM patient_status_audit
      WHERE patient_id = $1
      ORDER BY audit_id DESC LIMIT 3`,
    [TEST_PATIENT_ID]
  );
  console.log('Recent 3 audit rows:');
  console.log(audit);

  await revertToActive();
  await cleanup();

  const final = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('FINAL state:', final[0]);
  console.log('OK?', final[0].status_key === before[0].status_key ? 'YES' : 'NO');
  await getPool().end();
}
main().catch(e => { console.error(e); process.exit(1); });

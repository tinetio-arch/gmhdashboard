// End-to-end debug of writer #2's helper path: no-client (helper manages own tx).
// Mutates DB then reverts. Phil's test patient only.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0'; // philschafer7@gmail.com

async function main() {
  const before = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  const originalStatus = before[0].status_key;
  console.log('Original status_key:', originalStatus);

  const tempStatus = originalStatus === 'active' ? 'active_pending' : 'active';

  // Step 1: forward transition (no client — helper auto-commits)
  const r1 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: tempStatus as any,
    source: 'admin_api',
    actor: 'debug-writer-2-forward',
    reason: 'writer #2 debug forward',
    metadata: { phase: 'forward' },
  });
  console.log('FORWARD result:', r1);

  const afterFwd = await query<{ status_key: string; status_key_updated_at: Date }>(
    'SELECT status_key, status_key_updated_at FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('AFTER forward (committed):', afterFwd[0]);

  // Step 2: revert
  const r2 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: originalStatus as any,
    source: 'admin_api',
    actor: 'debug-writer-2-revert',
    reason: 'writer #2 debug revert',
    metadata: { phase: 'revert' },
  });
  console.log('REVERT result:', r2);

  const afterRev = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('AFTER revert:', afterRev[0]);

  // Step 3: inspect audit rows
  const audit = await query(
    `SELECT from_status, to_status, source, actor, reason, blocked, metadata
       FROM patient_status_audit
      WHERE patient_id = $1 AND actor LIKE 'debug-writer-2%'
      ORDER BY audit_id ASC`,
    [TEST_PATIENT_ID]
  );
  console.log('Audit rows from this debug run:');
  console.log(audit);

  // Step 4: clean up the debug audit rows
  const del = await query(
    `DELETE FROM patient_status_audit WHERE patient_id = $1 AND actor LIKE 'debug-writer-2%' RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log('Cleaned up audit rows:', del.length);

  // Step 5: confirm original state restored
  const final = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log('FINAL status_key (should match original):', final[0].status_key);
  console.log('Match:', final[0].status_key === originalStatus ? 'OK' : 'MISMATCH');

  await getPool().end();
}
main().catch(e => { console.error(e); process.exit(1); });

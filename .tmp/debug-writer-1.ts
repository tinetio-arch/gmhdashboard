// End-to-end debug of writer #1's helper path. Mirrors what merge/route.ts
// does: get a client, BEGIN, call transitionStatus, do alert_status follow-up,
// inspect audit row, then ROLLBACK so nothing persists.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0'; // philschafer7@gmail.com

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<{ status_key: string | null }>(
      'SELECT status_key FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
    );
    console.log('BEFORE status_key:', before.rows[0]?.status_key);

    // Force a real status change so the trigger fires (rollback at the end)
    const targetStatus = before.rows[0]?.status_key === 'active' ? 'active_pending' : 'active';

    const result = await transitionStatus({
      patientId: TEST_PATIENT_ID,
      toStatus: targetStatus as any,
      source: 'admin_api',
      actor: 'debug-writer-1',
      reason: 'end-to-end helper plumbing debug',
      metadata: { debug: true },
      client,
    });
    console.log('transitionStatus result:', result);

    // Mirror the alert_status override in merge/route.ts
    await client.query(
      `UPDATE patients SET alert_status = 'Debug (Test)' WHERE patient_id = $1::uuid`,
      [TEST_PATIENT_ID]
    );

    const audit = await client.query(
      `SELECT from_status, to_status, source, actor, reason, blocked, metadata
         FROM patient_status_audit
        WHERE patient_id = $1
        ORDER BY audit_id DESC LIMIT 1`,
      [TEST_PATIENT_ID]
    );
    console.log('LATEST audit row:', audit.rows[0]);

    const after = await client.query<{ status_key: string | null; alert_status: string | null; status_key_updated_at: Date | null }>(
      'SELECT status_key, alert_status, status_key_updated_at FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
    );
    console.log('AFTER (in-tx):', after.rows[0]);

    await client.query('ROLLBACK');
    console.log('Rolled back. Verifying no persistence...');

    const persisted = await client.query<{ count: string }>(
      `SELECT count(*)::text FROM patient_status_audit
        WHERE patient_id = $1 AND actor = 'debug-writer-1'`,
      [TEST_PATIENT_ID]
    );
    console.log('Persisted audit rows from this debug run:', persisted.rows[0]?.count);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });

// E2E debug for writers #12–#15 in scripts/startup-payment-sync.ts
//
// Verifies:
//   - One-time JOIN path (writer #12): hold via healthie_client_id match
//   - One-time name fallback (writer #13): hold via name match when no JOIN row
//   - Recurring JOIN path (writer #14): hold via healthie_client_id match
//   - Recurring name fallback (writer #15): hold via name match
//   - Guard: skipped when already hold or inactive (preserves NOT IN filter)

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';
const TEST_NAME = 'Phillip Schafer';

async function snapshot(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null }>(
    'SELECT status_key, alert_status FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  ${label}:`, r[0]);
  return r[0];
}

async function reset(toStatus: 'active' | 'inactive') {
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus,
    source: 'admin_api', actor: 'debug-12-15', reason: 'reset',
  });
}

async function joinPathHold(healthieId: string, patientName: string, reason: string, fnTag: string) {
  const noteEntry = `[debug] AUTO-SYNC: ${reason}`;
  const candidates = await query<{ patient_id: string; full_name: string }>(`
    SELECT p.patient_id::text, p.full_name
      FROM patients p
      JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text
     WHERE hc.healthie_client_id = $1
       AND hc.is_active = TRUE
       AND p.status_key NOT IN ('hold_payment_research', 'inactive')
  `, [healthieId]);
  console.log(`    [join-path] candidates: ${candidates.length}`);
  let any = false;
  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id,
      toStatus: 'hold_payment_research',
      source: 'script:startup-payment-sync',
      actor: 'system',
      reason,
      metadata: { fn: fnTag, healthieId, patientName, debug: 'writer-12-15' },
    });
    if (!t.applied) continue;
    await query(`
      UPDATE patients SET alert_status = 'Hold - Payment Research',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || E'\\n' || $2 END,
        last_modified = NOW()
      WHERE patient_id = $1::uuid
    `, [cand.patient_id, noteEntry]);
    any = true;
  }
  return any;
}

async function namePathHold(patientName: string, reason: string, fnTag: string) {
  const noteEntry = `[debug] AUTO-SYNC: ${reason}`;
  const candidates = await query<{ patient_id: string }>(`
    SELECT patient_id::text FROM patients
     WHERE LOWER(full_name) = LOWER($1)
       AND status_key NOT IN ('hold_payment_research', 'inactive')
  `, [patientName]);
  console.log(`    [name-path] candidates: ${candidates.length}`);
  let any = false;
  for (const cand of candidates) {
    const t = await transitionStatus({
      patientId: cand.patient_id,
      toStatus: 'hold_payment_research',
      source: 'script:startup-payment-sync',
      actor: 'system',
      reason,
      metadata: { fn: fnTag, patientName, debug: 'writer-12-15' },
    });
    if (!t.applied) continue;
    await query(`
      UPDATE patients SET alert_status = 'Hold - Payment Research',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || E'\\n' || $2 END,
        last_modified = NOW()
      WHERE patient_id = $1::uuid
    `, [cand.patient_id, noteEntry]);
    any = true;
  }
  return any;
}

async function main() {
  console.log('--- Writer #12–#15 E2E debug ---\n');
  const initial = await snapshot('initial');

  // Look up Phil's healthie_client_id row
  const hcRow = await query<{ healthie_client_id: string; is_active: boolean }>(
    `SELECT healthie_client_id, is_active FROM healthie_clients
      WHERE patient_id::text = $1::text AND is_active = TRUE LIMIT 1`,
    [TEST_PATIENT_ID]
  );
  if (hcRow.length === 0) {
    console.warn('  ⚠️  No active healthie_clients row for test patient — JOIN path will not be testable.');
  } else {
    console.log('  test healthie_client_id:', hcRow[0].healthie_client_id);
  }

  // Test 1: JOIN path (writer #12 / #14)
  console.log('\n[Test 1] JOIN-path hold (writer #12)');
  await reset('active');
  await snapshot('after reset');
  if (hcRow.length > 0) {
    const ok = await joinPathHold(hcRow[0].healthie_client_id, TEST_NAME, 'one-time payment declined: $99 (debug)', 'one-time-by-healthie-id');
    console.log('  applied?', ok);
    await snapshot('after JOIN hold');
  }

  // Test 2: Name fallback (writer #13 / #15)
  console.log('\n[Test 2] Name-fallback hold (writer #13)');
  await reset('active');
  await snapshot('after reset');
  const ok2 = await namePathHold(TEST_NAME, 'recurring payment failed (name match, debug)', 'recurring-by-name');
  console.log('  applied?', ok2);
  await snapshot('after name hold');

  // Test 3: Already on hold — guard
  console.log('\n[Test 3] Already on hold — guard skips');
  const ok3 = await joinPathHold(hcRow[0]?.healthie_client_id || 'never', TEST_NAME, 'second hold (should be skipped)', 'guard-test');
  console.log('  applied?', ok3, '(should be false)');
  const ok3b = await namePathHold(TEST_NAME, 'second name hold (should be skipped)', 'guard-test');
  console.log('  applied?', ok3b, '(should be false)');

  // Test 4: inactive — guard
  console.log('\n[Test 4] inactive → guard skips');
  await reset('inactive');
  await snapshot('forced inactive');
  const ok4 = await namePathHold(TEST_NAME, 'should be skipped (inactive)', 'guard-test-inactive');
  console.log('  applied?', ok4, '(should be false)');
  await snapshot('after attempted hold');

  // Cleanup
  console.log('\n[Cleanup]');
  await reset('active');
  const del = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1
         AND (actor = 'debug-12-15'
              OR (source = 'script:startup-payment-sync'
                  AND metadata->>'debug' = 'writer-12-15'))
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${del.length} audit rows`);

  const final = await snapshot('FINAL');
  console.log('\nOK?', final.status_key === initial.status_key ? 'YES' : 'NO');

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

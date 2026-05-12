// E2E debug for writers #19–#22
//   #19: lib/healthiePaymentAutomation.activatePatientBilling (hold→active via webhook_processor)
//   #20: lib/healthiePaymentAutomation.deactivatePatientBilling (active→hold via webhook_processor)
//   #21: app/api/admin/quickbooks/resolve-payment-issue (issueId path: hold→active via admin_api)
//   #22: app/api/admin/quickbooks/resolve-payment-issue (patientId path: hold→active via admin_api)

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';

async function snapshot(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null; payment_method: string | null; client_type: string | null }>(
    'SELECT status_key, alert_status, payment_method, client_type FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  ${label}:`, r[0]);
  return r[0];
}

async function main() {
  console.log('--- Writer #19–#22 E2E debug ---\n');
  const initial = await snapshot('initial');

  // #20: deactivate from active (webhook_processor)
  console.log('\n[#20] active → hold via webhook_processor (deactivatePatientBilling)');
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api', actor: 'debug-19-22', reason: 'reset' });
  await snapshot('reset to active');

  const t20 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'hold_payment_research',
    source: 'webhook_processor',
    actor: 'healthie_payment_automation',
    reason: 'Payment failed — Healthie status: declined',
    metadata: { fn: 'deactivatePatientBilling', healthieStatus: 'declined', debug: 'writer-20' },
  });
  console.log('  applied?', t20.applied);
  if (t20.applied) {
    // Custom alert_status override
    await query(`UPDATE patients SET alert_status = 'Payment Failed', updated_at = NOW() WHERE patient_id = $1::uuid`, [TEST_PATIENT_ID]);
  }
  await snapshot('after #20 (alert_status should be "Payment Failed")');

  // #19: reactivate from hold (webhook_processor)
  console.log('\n[#19] hold → active via webhook_processor (activatePatientBilling)');
  const t19 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'webhook_processor',
    actor: 'healthie_payment_automation',
    reason: 'Payment marked paid — auto-activated',
    metadata: { fn: 'activatePatientBilling', clientType: 'nowmenshealth_care', debug: 'writer-19' },
  });
  console.log('  applied?', t19.applied);
  // Skip secondary payment_method/client_type fields (FK to lookup tables; orthogonal to chokepoint)
  await snapshot('after #19');

  // #21: hold → active via admin_api (resolve-payment-issue issueId path)
  console.log('\n[#21] hold → active via admin_api (resolve-payment-issue issue path)');
  // First put back on hold
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'hold_payment_research',
    source: 'admin_api', actor: 'debug-19-22', reason: 'set hold for #21',
  });
  await snapshot('forced hold');
  const t21 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'admin_api',
    actor: 'admin@example.com',
    reason: 'Payment issue resolved - charge cleared in financial system',
    metadata: { fn: 'resolve-payment-issue', issueId: 'fake-issue-id', issueType: 'payment_declined', debug: 'writer-21' },
  });
  console.log('  applied?', t21.applied);
  await snapshot('after #21');

  // #22: hold → active via admin_api (resolve-payment-issue patientId path)
  console.log('\n[#22] hold_contract_renewal → active via admin_api (resolve-payment-issue bulk path)');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'hold_contract_renewal',
    source: 'admin_api', actor: 'debug-19-22', reason: 'set hold_contract_renewal for #22',
  });
  await snapshot('forced hold_contract_renewal');
  const t22 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'admin_api',
    actor: 'admin@example.com',
    reason: 'Payment issues manually resolved',
    metadata: { fn: 'resolve-payment-issue-bulk', previousStatus: 'hold_contract_renewal', debug: 'writer-22' },
  });
  console.log('  applied?', t22.applied);
  await snapshot('after #22');

  // Rule check: webhook_processor cannot move out of inactive (Rule 2)
  console.log('\n[Rule 2 check] Force inactive, then attempt webhook_processor → active (must block)');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'inactive',
    source: 'admin_api', actor: 'debug-19-22', reason: 'simulate inactive',
  });
  const tBlocked = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'active',
    source: 'webhook_processor',
    actor: 'healthie_payment_automation',
    reason: 'attempt #19 from inactive',
    metadata: { fn: 'activatePatientBilling', debug: 'rule2-check' },
  });
  console.log('  applied?', tBlocked.applied, 'blocked?', tBlocked.blocked, 'reason:', tBlocked.blockReason);

  // Cleanup: revert to active via admin_api, restore payment fields
  console.log('\n[Cleanup]');
  await transitionStatus({
    patientId: TEST_PATIENT_ID, toStatus: 'active',
    source: 'admin_api', actor: 'debug-19-22', reason: 'revert',
  });
  await query(
    `UPDATE patients SET payment_method = $2, client_type = $3 WHERE patient_id = $1::uuid`,
    [TEST_PATIENT_ID, initial.payment_method, initial.client_type]
  );
  const del = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1
         AND (actor IN ('debug-19-22', 'healthie_payment_automation', 'admin@example.com')
              OR metadata->>'debug' IN ('writer-19','writer-20','writer-21','writer-22','rule2-check'))
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${del.length} audit rows`);

  const final = await snapshot('FINAL');
  const ok = final.status_key === initial.status_key
    && final.payment_method === initial.payment_method
    && final.client_type === initial.client_type;
  console.log('\nOK?', ok ? 'YES' : 'NO');
  console.log('Rule 2 blocked correctly?', tBlocked.blocked && !tBlocked.applied ? 'YES' : 'NO');

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

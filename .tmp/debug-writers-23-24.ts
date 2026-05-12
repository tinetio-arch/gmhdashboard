// E2E debug for writers #23–#24 (caught by Phase 1.4 ESLint rule):
//   #23: lib/patientQueries.updatePatient (admin patient-edit form, multi-field UPDATE in caller-managed transaction)
//   #24: scripts/daily-payment-check.js (overdue-invoice → rule.target_status_key)

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getPool, query } from '../lib/db';
import { transitionStatus } from '../lib/status-transitions';
import { updatePatient, fetchPatientById } from '../lib/patientQueries';

const TEST_PATIENT_ID = 'e3dda809-92b3-42e2-aaba-cffddd6636c0';

async function snapshot(label: string) {
  const r = await query<{ status_key: string; alert_status: string | null; full_name: string; notes: string | null }>(
    'SELECT status_key, alert_status, full_name, notes FROM patients WHERE patient_id = $1', [TEST_PATIENT_ID]
  );
  console.log(`  ${label}:`, r[0]);
  return r[0];
}

async function main() {
  console.log('--- Writer #23–#24 E2E debug ---\n');
  const initialFull = await fetchPatientById(TEST_PATIENT_ID);
  if (!initialFull) throw new Error('test patient not found');
  const initial = await snapshot('initial');

  // --- Writer #23: updatePatient via admin_api ---
  console.log('\n[#23] active → hold_payment_research via updatePatient (admin_api)');
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api', actor: 'debug-23-24', reason: 'reset' });
  await snapshot('reset to active');

  const asStr = (v: any) => v == null ? null : (typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v)));
  const upd = await updatePatient({
    patientId: TEST_PATIENT_ID,
    patientName: initialFull.patient_name,
    statusKey: 'hold_payment_research',
    paymentMethodKey: initialFull.payment_method_key,
    clientTypeKey: initialFull.client_type_key,
    regimen: initialFull.regimen,
    patientNotes: initialFull.patient_notes,
    lastLab: asStr(initialFull.last_lab),
    nextLab: asStr(initialFull.next_lab),
    labStatus: initialFull.lab_status,
    labNotes: initialFull.lab_notes,
    serviceStartDate: asStr(initialFull.service_start_date),
    contractEndDate: asStr(initialFull.contract_end),
    dateOfBirth: asStr(initialFull.date_of_birth),
    address: [initialFull.address_line1, initialFull.city, initialFull.state, initialFull.postal_code].filter(Boolean).join(', ') || null,
    phoneNumber: initialFull.phone_primary,
    addedBy: 'debug-23-24',
    dateAdded: asStr(initialFull.date_added),
    lastModified: new Date().toISOString(),
    email: initialFull.email,
    regularClient: initialFull.regular_client,
    isVerified: initialFull.is_verified,
    membershipOwes: initialFull.membership_owes,
    eligibleForNextSupply: null,
    supplyStatus: null,
    membershipProgram: null,
    membershipStatus: null,
    membershipBalance: null,
    nextChargeDate: null,
    lastChargeDate: null,
    lastSupplyDate: null,
    lastControlledDispenseAt: null,
    lastDeaDrug: null,
  });
  console.log('  returned status_key:', upd.status_key, 'alert:', upd.alert_status);
  await snapshot('after #23 (should be hold_payment_research + alert "Hold - Payment Research")');

  // Audit row should exist with source=admin_api, actor=debug-23-24
  const audit23 = await query<{ source: string; actor: string | null; from_status: string | null; to_status: string }>(
    `SELECT source, actor, from_status, to_status FROM patient_status_audit
       WHERE patient_id = $1 AND metadata->>'fn' = 'updatePatient'
       ORDER BY created_at DESC LIMIT 1`,
    [TEST_PATIENT_ID]
  );
  console.log('  audit row:', audit23[0]);

  // --- Writer #23 guard: inactive → anything must throw ---
  console.log('\n[#23 guard] inactive → active via updatePatient must throw');
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: 'inactive', source: 'admin_api', actor: 'debug-23-24', reason: 'force inactive' });
  let threw = false;
  try {
    await updatePatient({
      patientId: TEST_PATIENT_ID,
      patientName: initialFull.patient_name,
      statusKey: 'active',
      paymentMethodKey: initialFull.payment_method_key,
      clientTypeKey: initialFull.client_type_key,
      regimen: initialFull.regimen,
      patientNotes: initialFull.patient_notes,
      lastLab: asStr(initialFull.last_lab),
      nextLab: asStr(initialFull.next_lab),
      labStatus: initialFull.lab_status,
      labNotes: initialFull.lab_notes,
      serviceStartDate: asStr(initialFull.service_start_date),
      contractEndDate: asStr(initialFull.contract_end),
      dateOfBirth: asStr(initialFull.date_of_birth),
      address: null,
      phoneNumber: initialFull.phone_primary,
      addedBy: 'debug-23-24',
      dateAdded: asStr(initialFull.date_added),
      lastModified: new Date().toISOString(),
      email: initialFull.email,
      regularClient: initialFull.regular_client,
      isVerified: initialFull.is_verified,
      membershipOwes: initialFull.membership_owes,
      eligibleForNextSupply: null, supplyStatus: null, membershipProgram: null, membershipStatus: null,
      membershipBalance: null, nextChargeDate: null, lastChargeDate: null, lastSupplyDate: null,
      lastControlledDispenseAt: null, lastDeaDrug: null,
    });
  } catch (e: any) {
    threw = true;
    console.log('  threw correctly:', e.message);
  }
  console.log('  guard worked?', threw ? 'YES' : 'NO');
  // Recover
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: 'active', source: 'admin_api', actor: 'debug-23-24', reason: 'recover' });

  // --- Writer #24: daily-payment-check ---
  console.log('\n[#24] active → hold_payment_research via script:daily-payment-check');
  const t24 = await transitionStatus({
    patientId: TEST_PATIENT_ID,
    toStatus: 'hold_payment_research',
    source: 'script:daily-payment-check',
    actor: 'system',
    reason: 'Overdue invoice TEST-INV-99 (45d)',
    metadata: { fn: 'daily-payment-check', ruleId: 'fake-rule', qbInvoiceId: 'TEST-INV-99', daysOverdue: 45, previousStatus: 'active' },
  });
  console.log('  applied?', t24.applied);
  await snapshot('after #24');

  // --- Cleanup: revert + delete audit rows ---
  console.log('\n[Cleanup]');
  await transitionStatus({ patientId: TEST_PATIENT_ID, toStatus: initial.status_key as any, source: 'admin_api', actor: 'debug-23-24', reason: 'final revert' });
  // Restore notes if they changed
  await query(`UPDATE patients SET full_name = $2, notes = $3, alert_status = $4 WHERE patient_id = $1::uuid`,
    [TEST_PATIENT_ID, initial.full_name, initial.notes, initial.alert_status]);
  const del = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1
         AND (actor IN ('debug-23-24', 'system')
              AND metadata->>'fn' IN ('updatePatient', 'daily-payment-check'))
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${del.length} audit rows`);
  // Also remove debug-23-24 actor rows even if fn-less
  const del2 = await query(
    `DELETE FROM patient_status_audit
       WHERE patient_id = $1 AND actor = 'debug-23-24'
     RETURNING audit_id`,
    [TEST_PATIENT_ID]
  );
  console.log(`  cleaned ${del2.length} additional audit rows`);

  const final = await snapshot('FINAL');
  const ok = final.status_key === initial.status_key
    && final.full_name === initial.full_name
    && final.notes === initial.notes;
  console.log('\nOK?', ok ? 'YES' : 'NO');

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

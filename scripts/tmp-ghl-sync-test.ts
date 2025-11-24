import 'dotenv/config';
import { query } from '../lib/db';
import { syncPatientToGHL } from '../lib/patientGHLSync';
import type { PatientDataEntryRow } from '../lib/patientQueries';

async function main() {
  const patientId = process.argv[2];
  if (!patientId) {
    console.error('Usage: tsx scripts/tmp-ghl-sync-test.ts <patient_id>');
    process.exit(1);
  }

  console.log('Syncing patient', patientId);
  const patients = await query<PatientDataEntryRow>(
    'SELECT * FROM patient_data_entry_v WHERE patient_id = $1 LIMIT 1',
    [patientId]
  );

  console.log('Rows returned:', patients.length);
  if (patients.length === 0) {
    console.error('Patient not found');
    process.exit(1);
  }

  const result = await syncPatientToGHL(patients[0], 'cli-test');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


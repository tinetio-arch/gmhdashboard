import 'dotenv/config';
import { query } from '../lib/db';
import { syncHealthiePatientDemographics } from '../lib/healthieDemographics';

async function main() {
  const patientsToSync = await query<{ patient_id: string }>(
    `
      SELECT patient_id
      FROM patient_data_entry_v
      WHERE method_of_payment ILIKE '%healthie%'
        AND client_type IN ('NowMensHealth.Care', 'NowPrimary.Care')
    `
  );

  console.log(`Syncing ${patientsToSync.length} Healthie patients...`);

  for (const row of patientsToSync) {
    try {
      const result = await syncHealthiePatientDemographics(row.patient_id);
      console.log(
        result.status === 'synced'
          ? `Synced ${row.patient_id}`
          : `Skipped ${row.patient_id}: ${result.reason}`
      );
    } catch (error) {
      console.error(`Failed to sync ${row.patient_id}:`, error);
    }
  }

  console.log(`Finished syncing ${patientsToSync.length} Healthie patients.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


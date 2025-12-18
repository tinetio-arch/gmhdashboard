// @ts-nocheck
import 'dotenv/config';
import { query } from '../lib/db';
import { syncHealthieTrtMetadata } from '../lib/trtSync';

async function main() {
  const rows = await query<{ patient_id: string }>(
    `
      SELECT DISTINCT patient_id
      FROM healthie_clients
      WHERE patient_id IS NOT NULL
    `
  );

  console.log(`Syncing TRT metadata for ${rows.length} Healthie patients...`);

  for (const row of rows) {
    const patientId = row.patient_id;
    if (!patientId) continue;

    try {
      await syncHealthieTrtMetadata(patientId);
      console.log(`Synced regimen metadata for ${patientId}`);
    } catch (error) {
      console.error(`Failed to sync ${patientId}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('Finished syncing TRT metadata.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


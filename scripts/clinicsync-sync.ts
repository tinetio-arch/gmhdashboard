import 'dotenv/config';
import { reprocessClinicSyncMemberships, upsertClinicSyncPatient } from '../lib/clinicsync';

async function main() {
  const syncUrl = process.env.CLINICSYNC_SYNC_URL;

  if (!syncUrl) {
    console.warn(
      '[ClinicSync] No CLINICSYNC_SYNC_URL configured. Re-applying membership holds from cached records.'
    );
    await reprocessClinicSyncMemberships();
    console.info('[ClinicSync] Reprocess complete.');
    return;
  }

  const fetchImpl = typeof fetch === 'undefined' ? (await import('node-fetch')).default : fetch;

  console.info(`[ClinicSync] Fetching membership data from ${syncUrl}`);
  const response = await fetchImpl(syncUrl, {
    method: process.env.CLINICSYNC_SYNC_METHOD ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLINICSYNC_API_KEY ?? ''
    }
  });

  if (!response.ok) {
    throw new Error(`ClinicSync sync failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const records: unknown =
    Array.isArray(payload) ? payload : payload?.data ?? payload?.patients ?? payload?.results;

  if (!Array.isArray(records)) {
    console.warn('[ClinicSync] Sync payload did not include a patient array. Nothing to import.');
    return;
  }

  let processed = 0;
  for (const record of records) {
    try {
      await upsertClinicSyncPatient(record as Record<string, unknown>, {
        source: 'sync',
        skipWebhookLog: true
      });
      processed += 1;
    } catch (error) {
      console.error('[ClinicSync] Failed to import record', error);
    }
  }

  console.info(`[ClinicSync] Imported ${processed} record(s) from sync feed.`);
}

main().catch((error) => {
  console.error('[ClinicSync] Sync job failed:', error);
  process.exit(1);
});


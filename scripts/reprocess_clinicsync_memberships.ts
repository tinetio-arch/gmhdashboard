/**
 * Manual ClinicSync reprocess helper.
 * Usage:
 *   npx tsx scripts/reprocess_clinicsync_memberships.ts
 *   npx tsx scripts/reprocess_clinicsync_memberships.ts --ids=123,456
 *   npx tsx scripts/reprocess_clinicsync_memberships.ts --limit=25
 *   npx tsx scripts/reprocess_clinicsync_memberships.ts --jane
 */

import 'dotenv/config';
import { reprocessClinicSyncMemberships } from '@/lib/clinicsync';

function parseArgs(): {
  ids?: string[];
  limit?: number;
  skipWithoutPatient?: boolean;
  syncJane?: boolean;
} {
  const args = process.argv.slice(2);
  const options: {
    ids?: string[];
    limit?: number;
    skipWithoutPatient?: boolean;
    syncJane?: boolean;
  } = {};

  for (const arg of args) {
    if (arg.startsWith('--ids=')) {
      const list = arg.slice('--ids='.length).split(',').map((value) => value.trim());
      options.ids = list.filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
      }
    } else if (arg === '--include-unmapped') {
      options.skipWithoutPatient = false;
    } else if (arg === '--jane') {
      options.syncJane = true;
    }
  }

  return options;
}

async function main() {
  const { ids, limit, skipWithoutPatient = true, syncJane = false } = parseArgs();

  console.log('[ClinicSync] Reprocess starting…');
  if (ids?.length) {
    console.log(`→ Clinicsync patient IDs: ${ids.join(', ')}`);
  }
  if (limit) {
    console.log(`→ Limit: ${limit}`);
  }
  if (!skipWithoutPatient) {
    console.log('→ Including records that are not yet mapped to a patient.');
  }
  if (syncJane) {
    console.log('→ Filtering patients where the payment method is set to Jane.');
  }

  const result = await reprocessClinicSyncMemberships({
    clinicsyncPatientIds: ids,
    limit,
    skipWithoutPatient,
    paymentMethodKeys: syncJane ? ['jane', 'jane_quickbooks'] : undefined,
    paymentMethodLike: syncJane ? ['%jane%'] : undefined,
  });

  console.log('[ClinicSync] Reprocess complete.');
  console.log(`→ Processed: ${result.processed}`);
  console.log(`→ Skipped:   ${result.skipped}`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[ClinicSync] Reprocess failed:', error);
    process.exit(1);
  });


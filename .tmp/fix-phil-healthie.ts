// One-off: fix Phillip Schafer's Healthie record (client 12123979 ONLY).
// Approved by Phil on 2026-04-15.
import 'dotenv/config';
import { createHealthieClient } from '../lib/healthie';

const PHIL_ID = '12123979';

async function main() {
  const hc = createHealthieClient();
  if (!hc) throw new Error('Healthie client not configured');

  console.log('1. Fixing first_name/last_name...');
  await hc.updateClient(PHIL_ID, { first_name: 'Phillip', last_name: 'Schafer' });

  console.log('2. Upserting primary location (will dedupe stale copies)...');
  const locId = await hc.upsertClientLocation(PHIL_ID, {
    name: 'Primary',
    line1: '616 Sunrise Blvd',
    city: 'Prescott',
    state: 'AZ',
    zip: '86301',
    country: 'US',
  });
  console.log('   Primary location id:', locId);

  console.log('3. Re-reading from Healthie to verify...');
  const locs = await hc.getClientLocations(PHIL_ID);
  console.log('   locations remaining:', locs.length);
  for (const l of locs) console.log('   -', l.id, '|', l.line1, '|', l.city, l.state, l.zip);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });

import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function archive() {
  console.log("== ARCHIVING EMPTY ACTIVE VIALS ==");
  try {
    // V0368 is 0.0ml but Active — this triggers the "Complete Vial" prompt
    await query("UPDATE vials SET status = 'Completed', updated_at = NOW() WHERE external_id = 'V0368' AND remaining_volume_ml::numeric <= 0");
    console.log("Archived V0368");
  } catch (err) {
    console.error("ARCHIVE FAILED:", err);
  }
  process.exit(0);
}
archive();

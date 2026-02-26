import { query } from './lib/db';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function migrate() {
  console.log("== STARTING MIGRATION: dispense_history_dispense_id_fkey ==");
  try {
    // 1. Drop the existing CASCADE constraint
    await query('ALTER TABLE dispense_history DROP CONSTRAINT dispense_history_dispense_id_fkey');
    console.log("Dropped old constraint.");

    // 2. Add the new constraint without CASCADE (defaults to NO ACTION / RESTRICT if not specified, 
    // but we want the dispense to be deletable while history stays. 
    // Wait, if history has a foreign key to dispense_id, we can't delete the dispense without deleting history 
    // UNLESS we make the foreign key nullable or use SET NULL.
    // In lib/inventoryQueries.ts, we record the event BEFORE deleting. 
    // If we want the history to survive the deletion of the dispense, 
    // we should either:
    // A) nullify dispense_id in history on delete
    // B) remove the foreign key constraint entirely (not ideal for data integrity)
    // C) Keep the ID but remove the FK check.

    // Given existing code records { dispenseId, ...payload } in history, 
    // B or A is best. Let's go with A: ON DELETE SET NULL so we keep the ID for reference in the payload but the FK doesn't block.
    
    await query('ALTER TABLE dispense_history ADD CONSTRAINT dispense_history_dispense_id_fkey FOREIGN KEY (dispense_id) REFERENCES dispenses(dispense_id) ON DELETE SET NULL');
    console.log("Added new constraint: ON DELETE SET NULL");
    
    console.log("MIGRATION SUCCESSFUL");
  } catch (err) {
    console.error("MIGRATION FAILED:", err);
  }
  process.exit(0);
}
migrate();

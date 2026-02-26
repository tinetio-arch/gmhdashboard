/**
 * DEA Log Reconciliation Script - CORRECTED VERSION
 * 
 * Proper FIFO logic:
 * 1. Use up one vial completely before moving to the next
 * 2. When a dispense doesn't fit in current vial, split it:
 *    - Take what's left from current vial (empties it)
 *    - Take remainder from next vial
 * 3. Result: At most 1 partially-used vial at any time
 */

import { getPool } from '../lib/db';

const DRY_RUN = process.argv.includes('--dry-run');

interface Vial {
    vial_id: string;
    external_id: string;
    size_ml: number;
    date_received: Date;
    // Tracking
    used_ml: number;
}

interface Dispense {
    dispense_id: string;
    dispense_date: Date;
    vial_id: string;
    vial_external_id: string;
    total_dispensed_ml: number;
    waste_ml: number;
    patient_name: string;
}

async function reconcileVials() {
    const pool = getPool();
    const client = await pool.connect();

    try {
        console.log('\n=== DEA LOG RECONCILIATION (CORRECTED) ===');
        console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚠️ LIVE - Will make changes!'}`);
        console.log('');

        // 1. Get all Carrie Boyd vials ordered by date_received (FIFO)
        const vialResult = await client.query<{
            vial_id: string;
            external_id: string;
            size_ml: string;
            date_received: string;
        }>(`
      SELECT vial_id, external_id, size_ml, date_received
      FROM vials
      WHERE controlled_substance = true
        AND status = 'Active'
        AND (size_ml::numeric >= 20 OR dea_drug_name ILIKE '%carrie%')
      ORDER BY date_received ASC, external_id ASC
    `);

        const vials: Vial[] = vialResult.rows.map(r => ({
            vial_id: r.vial_id,
            external_id: r.external_id,
            size_ml: parseFloat(r.size_ml) || 30,
            date_received: new Date(r.date_received),
            used_ml: 0
        }));

        console.log(`Found ${vials.length} Carrie Boyd vials\n`);

        // 2. Get all Carrie Boyd dispenses in chronological order
        const dispenseResult = await client.query<{
            dispense_id: string;
            dispense_date: string;
            vial_id: string;
            vial_external_id: string;
            total_dispensed_ml: string;
            waste_ml: string;
            patient_name: string;
        }>(`
      SELECT 
        d.dispense_id,
        d.dispense_date,
        d.vial_id,
        d.vial_external_id,
        d.total_dispensed_ml,
        d.waste_ml,
        COALESCE(p.full_name, d.patient_name) as patient_name
      FROM dispenses d
      LEFT JOIN patients p ON d.patient_id = p.patient_id
      LEFT JOIN vials v ON d.vial_id = v.vial_id
      WHERE (v.size_ml::numeric >= 20 OR v.dea_drug_name ILIKE '%carrie%')
      ORDER BY d.dispense_date ASC, d.dispense_id ASC
    `);

        const dispenses: Dispense[] = dispenseResult.rows.map(r => ({
            dispense_id: r.dispense_id,
            dispense_date: new Date(r.dispense_date),
            vial_id: r.vial_id,
            vial_external_id: r.vial_external_id,
            total_dispensed_ml: parseFloat(r.total_dispensed_ml) || 0,
            waste_ml: parseFloat(r.waste_ml) || 0,
            patient_name: r.patient_name
        }));

        const totalUsed = dispenses.reduce((sum, d) => sum + d.total_dispensed_ml + d.waste_ml, 0);
        console.log(`Found ${dispenses.length} dispenses (${totalUsed.toFixed(1)}ml total used)\n`);

        // 3. Assign dispenses to vials - PROPERLY drain each vial before moving on
        console.log('=== PROPER FIFO ASSIGNMENT ===\n');

        let currentVialIndex = 0;
        const reassignments: { dispense_id: string; old_vial: string; new_vial: string; new_vial_id: string }[] = [];

        for (const dispense of dispenses) {
            const totalRemoval = dispense.total_dispensed_ml + dispense.waste_ml;
            let remainingToAssign = totalRemoval;

            while (remainingToAssign > 0.001 && currentVialIndex < vials.length) {
                const currentVial = vials[currentVialIndex];
                const vialAvailable = currentVial.size_ml - currentVial.used_ml;

                if (vialAvailable <= 0.001) {
                    // Vial is empty, move to next
                    currentVialIndex++;
                    continue;
                }

                // Take as much as we can from this vial
                const takeFromThisVial = Math.min(remainingToAssign, vialAvailable);
                currentVial.used_ml += takeFromThisVial;
                remainingToAssign -= takeFromThisVial;

                // If we're assigning to a different vial than recorded
                if (dispense.vial_external_id !== currentVial.external_id) {
                    // Only log first assignment per dispense (for clarity)
                    if (remainingToAssign <= 0.001 || takeFromThisVial === totalRemoval) {
                        reassignments.push({
                            dispense_id: dispense.dispense_id,
                            old_vial: dispense.vial_external_id,
                            new_vial: currentVial.external_id,
                            new_vial_id: currentVial.vial_id
                        });
                    }
                }

                // Check if vial is now empty
                if (currentVial.size_ml - currentVial.used_ml < 0.001) {
                    console.log(`  Vial ${currentVial.external_id} EMPTIED (30ml used)`);
                    currentVialIndex++;
                }
            }

            if (remainingToAssign > 0.001) {
                console.log(`  ❌ ERROR: Ran out of vials! ${remainingToAssign.toFixed(2)}ml unassigned for ${dispense.patient_name}`);
            }
        }

        // 4. Calculate and show new remaining volumes
        console.log('\n=== VIAL STATUS AFTER RECONCILIATION ===\n');

        let emptyCount = 0;
        let partialCount = 0;
        let fullCount = 0;
        let totalRemaining = 0;

        for (const vial of vials) {
            const remaining = Math.max(0, vial.size_ml - vial.used_ml);
            totalRemaining += remaining;

            if (remaining <= 0.001) {
                emptyCount++;
            } else if (Math.abs(remaining - vial.size_ml) < 0.01) {
                fullCount++;
                console.log(`  ${vial.external_id}: FULL (${remaining.toFixed(1)}ml)`);
            } else {
                partialCount++;
                console.log(`  ${vial.external_id}: IN PROGRESS (${remaining.toFixed(1)}ml remaining)`);
            }
        }

        console.log(`\nEmpty: ${emptyCount} vials (fully used)`);
        console.log(`Full: ${fullCount} vials (untouched)`);
        console.log(`In Progress: ${partialCount} vials (currently being dispensed from)`);
        console.log(`\nTotal remaining: ${totalRemaining.toFixed(1)}ml (${(totalRemaining / 30).toFixed(2)} vials)`);

        // 5. Apply changes if not dry run
        if (!DRY_RUN) {
            console.log('\n=== APPLYING CHANGES ===\n');

            await client.query('BEGIN');

            try {
                // Update dispenses to point to correct vials (for major reassignments)
                let updateCount = 0;
                for (const r of reassignments) {
                    await client.query(`
            UPDATE dispenses 
            SET vial_id = $1, vial_external_id = $2
            WHERE dispense_id = $3
          `, [r.new_vial_id, r.new_vial, r.dispense_id]);

                    await client.query(`
            UPDATE dea_transactions 
            SET vial_id = $1
            WHERE dispense_id = $2
          `, [r.new_vial_id, r.dispense_id]);
                    updateCount++;
                }
                console.log(`✅ Updated ${updateCount} dispense records`);

                // Update vial remaining volumes
                for (const vial of vials) {
                    const newRemaining = Math.max(0, vial.size_ml - vial.used_ml);
                    await client.query(`
            UPDATE vials 
            SET remaining_volume_ml = $1
            WHERE vial_id = $2
          `, [newRemaining.toFixed(3), vial.vial_id]);
                }
                console.log(`✅ Updated ${vials.length} vial remaining volumes`);

                await client.query('COMMIT');
                console.log('\n✅ All changes committed successfully!');

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('❌ Error applying changes, rolled back:', error);
                throw error;
            }
        } else {
            console.log('\n🔍 DRY RUN - No changes made. Run without --dry-run to apply changes.');
        }

        // Summary
        console.log('\n=== SUMMARY ===\n');
        console.log(`Total Carrie Boyd received: ${vials.length} vials (${vials.length * 30}ml)`);
        console.log(`Total used: ${totalUsed.toFixed(1)}ml`);
        console.log(`Remaining: ${totalRemaining.toFixed(1)}ml (${(totalRemaining / 30).toFixed(2)} vials)`);

    } finally {
        client.release();
    }

    process.exit(0);
}

reconcileVials().catch(e => {
    console.error(e);
    process.exit(1);
});

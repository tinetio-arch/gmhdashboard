#!/usr/bin/env node
/**
 * Seed the supply_items and supply_counts tables from the Google Doc inventory.
 * Usage: cd gmhdashboard && source .env.local && timeout 60 npx tsx scripts/seed-supply-inventory.ts
 */
import { getPool } from '../lib/db';

interface SeedItem {
    name: string;
    category: string;
    unit: string;
    qty_main: number;
    qty_patient_room?: number;
    notes?: string;
}

const ITEMS: SeedItem[] = [
    // ── Syringes/Needles ──
    { name: '31 ga .5 cc insulin syringe', category: 'Syringes/Needles', unit: 'each', qty_main: 10 },
    { name: '30 ga .5 cc insulin syringe', category: 'Syringes/Needles', unit: 'each', qty_main: 0 },
    { name: '28 ga .5 cc insulin syringe', category: 'Syringes/Needles', unit: 'each', qty_main: 10 },
    { name: '29 ga 1cc insulin syringe', category: 'Syringes/Needles', unit: 'each', qty_main: 20 },
    { name: '31 ga .3 cc insulin syringe', category: 'Syringes/Needles', unit: 'each', qty_main: 508 },
    { name: '1 cc syringes', category: 'Syringes/Needles', unit: 'each', qty_main: 62 },
    { name: '3 cc syringes', category: 'Syringes/Needles', unit: 'each', qty_main: 634 },
    { name: '5 cc syringes', category: 'Syringes/Needles', unit: 'each', qty_main: 100 },
    { name: '10 cc syringes', category: 'Syringes/Needles', unit: 'each', qty_main: 264, qty_patient_room: 6 },
    { name: '30 cc syringes', category: 'Syringes/Needles', unit: 'each', qty_main: 0 },
    { name: '25 ga x 1.5 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 500 },
    { name: '22 ga x 1.5 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 425, qty_patient_room: 30 },
    { name: '23 ga x 1 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 100, qty_patient_room: 21 },
    { name: '18 ga x 1 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 461, qty_patient_room: 11 },
    { name: '25 ga x 1 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 100 },
    { name: '30 ga x .5 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 53 },
    { name: '27 ga x .5 in needles', category: 'Syringes/Needles', unit: 'each', qty_main: 56 },

    // ── Miscellaneous ──
    { name: 'Tongue depressors', category: 'Miscellaneous', unit: 'each', qty_main: 400, qty_patient_room: 110 },
    { name: 'Non woven 2x2 sponges', category: 'Miscellaneous', unit: 'each', qty_main: 150 },
    { name: 'Non woven 4x4 sponges', category: 'Miscellaneous', unit: 'each', qty_main: 100 },
    { name: 'Kleenex', category: 'Miscellaneous', unit: 'box', qty_main: 3 },
    { name: 'UA cups', category: 'Miscellaneous', unit: 'each', qty_main: 31 },
    { name: 'Purple top tubes', category: 'Miscellaneous', unit: 'each', qty_main: 25 },
    { name: 'Gold top tubes', category: 'Miscellaneous', unit: 'each', qty_main: 10 },
    { name: 'Tourniquets', category: 'Miscellaneous', unit: 'each', qty_main: 114 },
    { name: 'Butterfly needles (kits)', category: 'Miscellaneous', unit: 'each', qty_main: 10 },
    { name: 'Alcohol prep pads', category: 'Miscellaneous', unit: 'each', qty_main: 3400 },
    { name: 'Face masks', category: 'Miscellaneous', unit: 'each', qty_main: 70 },
    { name: 'Coban', category: 'Miscellaneous', unit: 'roll', qty_main: 5 },
    { name: 'Sharps containers', category: 'Miscellaneous', unit: 'each', qty_main: 9, notes: '+1 in each patient room' },
    { name: 'Sharps lids', category: 'Miscellaneous', unit: 'each', qty_main: 5, notes: '+1 in each patient room' },
    { name: 'Biohazard bags', category: 'Miscellaneous', unit: 'each', qty_main: 200 },
    { name: 'SteriStrips', category: 'Miscellaneous', unit: 'pack', qty_main: 6, qty_patient_room: 21 },
    { name: 'Dental bibs', category: 'Miscellaneous', unit: 'pack', qty_main: 2 },
    { name: 'Exam sheets', category: 'Miscellaneous', unit: 'each', qty_main: 60 },
    { name: 'Cotton tipped applicators', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Drape/towel non fenestrated', category: 'Miscellaneous', unit: 'each', qty_main: 26 },
    { name: 'Chux', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Sterile gauze', category: 'Miscellaneous', unit: 'each', qty_main: 28 },
    { name: 'Non stick gauze', category: 'Miscellaneous', unit: 'each', qty_main: 12 },
    { name: 'Bandaids', category: 'Miscellaneous', unit: 'each', qty_main: 100 },
    { name: 'Iodoform packing strips', category: 'Miscellaneous', unit: 'bottle', qty_main: 2 },
    { name: 'Hydrogen peroxide (16 oz)', category: 'Miscellaneous', unit: 'bottle', qty_main: 8, qty_patient_room: 3 },
    { name: 'Antibiotic ointment (1 oz)', category: 'Miscellaneous', unit: 'tube', qty_main: 1 },
    { name: 'Hydrocortisone cream (1 oz)', category: 'Miscellaneous', unit: 'tube', qty_main: 4 },
    { name: 'Wound irrigation solution', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'CHG 4% wash (16 oz)', category: 'Miscellaneous', unit: 'bottle', qty_main: 4 },
    { name: 'Brown gift bags', category: 'Miscellaneous', unit: 'each', qty_main: 37 },
    { name: 'Otoscope tips', category: 'Miscellaneous', unit: 'box', qty_main: 2 },
    { name: 'Multi dose vial adapter', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Irrigation splash guard', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Albuterol sulfate 2.5mg/3mL', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Non-rebreather masks', category: 'Miscellaneous', unit: 'each', qty_main: 8 },
    { name: 'Nasal cannula', category: 'Miscellaneous', unit: 'each', qty_main: 5 },
    { name: 'Nebulizer', category: 'Miscellaneous', unit: 'each', qty_main: 5 },
    { name: 'Nebulizer mask (adult)', category: 'Miscellaneous', unit: 'each', qty_main: 10 },
    { name: 'Autoclave pouch L', category: 'Miscellaneous', unit: 'each', qty_main: 100 },
    { name: 'Autoclave pouch S', category: 'Miscellaneous', unit: 'each', qty_main: 13 },
    { name: 'Manual blood pressure cuff', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Manual blood pressure cuff M', category: 'Miscellaneous', unit: 'each', qty_main: 0 },
    { name: 'Acupuncture needles', category: 'Miscellaneous', unit: 'each', qty_main: 69 },
    { name: 'Povidone iodine swab sticks', category: 'Miscellaneous', unit: 'each', qty_main: 50 },

    // ── Monofilament ──
    { name: '3-0 nylon suture', category: 'Monofilament', unit: 'box', qty_main: 1 },
    { name: '4-0 nylon suture', category: 'Monofilament', unit: 'box', qty_main: 1 },
    { name: '5-0 nylon suture', category: 'Monofilament', unit: 'box', qty_main: 1 },
    { name: '3-0 polypropylene suture', category: 'Monofilament', unit: 'box', qty_main: 1 },
    { name: '4-0 polypropylene suture', category: 'Monofilament', unit: 'box', qty_main: 1 },

    // ── Tests ──
    { name: 'Strep test', category: 'Tests', unit: 'test', qty_main: 26 },
    { name: 'Covid/Flu A&B test', category: 'Tests', unit: 'test', qty_main: 30 },
    { name: 'UA cups', category: 'Tests', unit: 'each', qty_main: 32 },
    { name: 'UA test strips', category: 'Tests', unit: 'each', qty_main: 12 },

    // ── IV Stuff ──
    { name: 'IV start kit', category: 'IV Supplies', unit: 'each', qty_main: 50 },
    { name: 'Saline 1L bags', category: 'IV Supplies', unit: 'bag', qty_main: 8 },
    { name: 'Saline 250 mL bags', category: 'IV Supplies', unit: 'bag', qty_main: 1 },
    { name: 'IV extension sets', category: 'IV Supplies', unit: 'each', qty_main: 7 },
    { name: '10cc saline flush', category: 'IV Supplies', unit: 'each', qty_main: 50 },
    { name: 'IV tubing', category: 'IV Supplies', unit: 'each', qty_main: 0 },

    // ── Cleaning/Office Supplies ──
    { name: 'Trash bags', category: 'Cleaning/Office', unit: 'box', qty_main: 1 },
    { name: 'Cavi/clorox wipes', category: 'Cleaning/Office', unit: 'bottle', qty_main: 5 },
    { name: 'Lysol spray', category: 'Cleaning/Office', unit: 'can', qty_main: 0 },
    { name: 'Kleenex (office)', category: 'Cleaning/Office', unit: 'box', qty_main: 3 },
    { name: 'L Gloves', category: 'Cleaning/Office', unit: 'box', qty_main: 1 },
    { name: 'M Gloves', category: 'Cleaning/Office', unit: 'box', qty_main: 3 },

    // ── Kits ──
    { name: 'Female pelleting kit', category: 'Kits', unit: 'kit', qty_main: 10 },
    { name: 'Male pelleting kit', category: 'Kits', unit: 'kit', qty_main: 6 },
    { name: 'Suture removal kit', category: 'Kits', unit: 'kit', qty_main: 14 },
    { name: 'Suture kit', category: 'Kits', unit: 'kit', qty_main: 1 },
    { name: 'Lab draw kit', category: 'Kits', unit: 'kit', qty_main: 20 },
    { name: 'Access medical bags', category: 'Kits', unit: 'each', qty_main: 50 },
    { name: 'White shipping bags', category: 'Kits', unit: 'each', qty_main: 0 },
    { name: 'UPS specimen shipping bags', category: 'Kits', unit: 'each', qty_main: 25 },

    // ── Pelleting Supplies ──
    { name: 'BZK antiseptic wipes', category: 'Pelleting Supplies', unit: 'box', qty_main: 1 },
    { name: 'CHG wipes/swabs', category: 'Pelleting Supplies', unit: 'each', qty_main: 200 },
    { name: 'Tape', category: 'Pelleting Supplies', unit: 'roll', qty_main: 1 },
    { name: 'Benzoin tincture', category: 'Pelleting Supplies', unit: 'each', qty_main: 50 },
    { name: 'Scalpel', category: 'Pelleting Supplies', unit: 'each', qty_main: 100 },

    // ── Blood Glucose ──
    { name: 'Glucometer', category: 'Blood Glucose', unit: 'each', qty_main: 2 },
    { name: 'Lancets', category: 'Blood Glucose', unit: 'each', qty_main: 100 },
    { name: 'Glucose test strips', category: 'Blood Glucose', unit: 'set', qty_main: 2 },

    // ── Meds/Supplements ──
    { name: 'Sterile water 50mL', category: 'Meds/Supplements', unit: 'bottle', qty_main: 3 },
    { name: 'Bacteriostatic water', category: 'Meds/Supplements', unit: 'vial', qty_main: 5 },
    { name: 'Sodium bicarbonate (NaHCO3)', category: 'Meds/Supplements', unit: 'each', qty_main: 25 },
    { name: 'Lidocaine 50mL', category: 'Meds/Supplements', unit: 'bottle', qty_main: 1 },
    { name: 'Lidocaine vials', category: 'Meds/Supplements', unit: 'vial', qty_main: 24 },
    { name: 'IM/IV Zofran', category: 'Meds/Supplements', unit: 'each', qty_main: 125 },
    { name: 'ODT Zofran', category: 'Meds/Supplements', unit: 'box', qty_main: 5 },
    { name: 'Cyanocobalamin (B12)', category: 'Meds/Supplements', unit: 'vial', qty_main: 1, notes: '1/2 vial remaining' },
    { name: 'Kenalog', category: 'Meds/Supplements', unit: 'vial', qty_main: 2, notes: '1.5 vials remaining' },
    { name: 'Adrenalin (epinephrine)', category: 'Meds/Supplements', unit: 'dose', qty_main: 1 },
    { name: 'Dexamethasone 10mg/1mL', category: 'Meds/Supplements', unit: 'each', qty_main: 7 },
    { name: 'Dexamethasone 4mg/mL', category: 'Meds/Supplements', unit: 'each', qty_main: 14 },
    { name: 'Diphenhydramine 50mg/mL', category: 'Meds/Supplements', unit: 'each', qty_main: 10 },
    { name: 'Ketorolac 30mg/mL', category: 'Meds/Supplements', unit: 'each', qty_main: 7 },
    { name: 'Ceftriaxone 1g', category: 'Meds/Supplements', unit: 'each', qty_main: 4 },
    { name: 'Ibuprofen 200mg tablets', category: 'Meds/Supplements', unit: 'tablet', qty_main: 1000 },
    { name: "Children's ibuprofen", category: 'Meds/Supplements', unit: 'bottle', qty_main: 2 },
    { name: "Children's acetaminophen", category: 'Meds/Supplements', unit: 'bottle', qty_main: 1 },
    { name: 'Acetaminophen 325mg packs', category: 'Meds/Supplements', unit: 'pack', qty_main: 175 },
    { name: 'Aspirin', category: 'Meds/Supplements', unit: 'bottle', qty_main: 1 },
    { name: 'Ipratropium/albuterol bullets', category: 'Meds/Supplements', unit: 'each', qty_main: 50 },
    { name: 'Albuterol sulfate packs', category: 'Meds/Supplements', unit: 'pack', qty_main: 17 },
    { name: 'Budesonide ampules', category: 'Meds/Supplements', unit: 'ampule', qty_main: 20 },
    { name: 'HRT Complete', category: 'Meds/Supplements', unit: 'each', qty_main: 7 },
    { name: 'ADK', category: 'Meds/Supplements', unit: 'each', qty_main: 10 },
    { name: 'ADK10', category: 'Meds/Supplements', unit: 'each', qty_main: 8 },
    { name: 'GI Guard', category: 'Meds/Supplements', unit: 'each', qty_main: 8 },
    { name: 'Omega Plus', category: 'Meds/Supplements', unit: 'each', qty_main: 3 },
    { name: 'Tadalafil 5mg', category: 'Meds/Supplements', unit: 'each', qty_main: 8 },
    { name: 'Tadalafil 10mg', category: 'Meds/Supplements', unit: 'each', qty_main: 10 },
    { name: 'Tadalafil 20mg', category: 'Meds/Supplements', unit: 'each', qty_main: 3 },
    { name: 'Sildenafil 50mg', category: 'Meds/Supplements', unit: 'each', qty_main: 2 },
    { name: 'Sildenafil 100mg', category: 'Meds/Supplements', unit: 'each', qty_main: 1 },
];

async function main() {
    const pool = getPool();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let inserted = 0;
        for (const item of ITEMS) {
            // Insert item
            const res = await client.query(
                `INSERT INTO supply_items (name, category, unit, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
                [item.name, item.category, item.unit, item.notes ?? null]
            );

            if (res.rows.length > 0) {
                const id = res.rows[0].id;

                // Main stock count
                await client.query(
                    `INSERT INTO supply_counts (item_id, qty_on_hand, location, counted_at, counted_by)
           VALUES ($1, $2, 'main', '2026-01-16T00:00:00Z', 'seed-script')
           ON CONFLICT (item_id, location) DO UPDATE SET qty_on_hand = $2, counted_at = '2026-01-16T00:00:00Z'`,
                    [id, item.qty_main]
                );

                // Patient room stock (if any)
                if (item.qty_patient_room && item.qty_patient_room > 0) {
                    await client.query(
                        `INSERT INTO supply_counts (item_id, qty_on_hand, location, counted_at, counted_by)
             VALUES ($1, $2, 'patient_room', '2026-01-16T00:00:00Z', 'seed-script')
             ON CONFLICT (item_id, location) DO UPDATE SET qty_on_hand = $2, counted_at = '2026-01-16T00:00:00Z'`,
                        [id, item.qty_patient_room]
                    );
                }

                // Initial history entry
                await client.query(
                    `INSERT INTO supply_count_history (item_id, location, qty_before, qty_after, change_type, notes, recorded_by, recorded_at)
           VALUES ($1, 'main', 0, $2, 'count', 'Initial inventory from Jan 16 2026 count', 'seed-script', '2026-01-16T00:00:00Z')`,
                    [id, item.qty_main]
                );

                inserted++;
            }
        }

        await client.query('COMMIT');
        console.log(`✅ Seeded ${inserted} supply items with counts`);

        // Quick verify
        const count = await client.query('SELECT COUNT(*) AS c FROM supply_items');
        const cats = await client.query('SELECT category, COUNT(*) AS c FROM supply_items GROUP BY category ORDER BY category');
        console.log(`Total items: ${count.rows[0].c}`);
        console.log('By category:');
        for (const row of cats.rows) {
            console.log(`  ${row.category}: ${row.c}`);
        }
    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();

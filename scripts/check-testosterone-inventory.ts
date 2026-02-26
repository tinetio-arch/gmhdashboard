import { query } from '../lib/db';

async function checkInventory() {
    console.log('\n=== ACTIVE CONTROLLED SUBSTANCE VIALS ===\n');

    const vials = await query<{
        vial_id: string;
        external_id: string | null;
        size_ml: string | null;
        remaining_volume_ml: string | null;
        status: string | null;
        dea_drug_name: string | null;
        notes: string | null;
        date_received: string | null;
    }>(`
    SELECT vial_id, external_id, size_ml, remaining_volume_ml, status, dea_drug_name, notes, date_received
    FROM vials 
    WHERE status = 'Active' 
      AND controlled_substance = true 
    ORDER BY dea_drug_name, remaining_volume_ml DESC
  `);

    console.log(`Total active controlled vials: ${vials.length}\n`);

    // Group by vendor - only count vials with remaining volume > 0
    const carrieBoyVials = vials.filter(v => {
        const ml = parseFloat(v.remaining_volume_ml || '0');
        if (ml <= 0) return false;
        return (
            v.dea_drug_name?.toLowerCase().includes('carrie') ||
            v.notes?.toLowerCase().includes('carrie') ||
            parseFloat(v.size_ml || '0') >= 20
        );
    });

    const toprxVials = vials.filter(v => {
        const ml = parseFloat(v.remaining_volume_ml || '0');
        if (ml <= 0) return false;
        return (
            v.dea_drug_name?.toLowerCase().includes('toprx') ||
            v.notes?.toLowerCase().includes('toprx') ||
            (parseFloat(v.size_ml || '0') > 0 && parseFloat(v.size_ml || '0') < 20)
        );
    });

    console.log('=== CARRIE BOYD VIALS (with remaining volume > 0) ===');
    console.log(`Count: ${carrieBoyVials.length}`);
    let totalCarrieBoydMl = 0;
    for (const vial of carrieBoyVials) {
        const remaining = parseFloat(vial.remaining_volume_ml || '0');
        totalCarrieBoydMl += remaining;
        console.log(`  ${vial.external_id}: ${remaining} ml remaining (size: ${vial.size_ml} ml) | DEA Name: ${vial.dea_drug_name}`);
    }
    console.log(`\nTotal Carrie Boyd remaining: ${totalCarrieBoydMl.toFixed(1)} ml`);
    console.log(`Equivalent vials (30ml each): ${(totalCarrieBoydMl / 30).toFixed(2)}`);

    console.log('\n=== TOPRX VIALS (with remaining volume > 0) ===');
    console.log(`Count: ${toprxVials.length}`);
    let totalToprxMl = 0;
    for (const vial of toprxVials) {
        const remaining = parseFloat(vial.remaining_volume_ml || '0');
        totalToprxMl += remaining;
        console.log(`  ${vial.external_id}: ${remaining} ml remaining (size: ${vial.size_ml} ml) | DEA Name: ${vial.dea_drug_name}`);
    }
    console.log(`Total TopRX remaining: ${totalToprxMl.toFixed(1)} ml`);
    console.log(`Equivalent vials (10ml each): ${(totalToprxMl / 10).toFixed(2)}`);

    // Check recent dispenses - use vials table to get dea_drug_name
    console.log('\n\n=== RECENT CARRIE BOYD DISPENSES (Last 30 days) ===\n');

    const dispenses = await query<{
        dispense_id: string;
        dispense_date: string | null;
        patient_name: string | null;
        vial_external_id: string | null;
        total_dispensed_ml: string | null;
        waste_ml: string | null;
        dea_drug_name: string | null;
    }>(`
    SELECT 
      d.dispense_id,
      d.dispense_date,
      COALESCE(p.full_name, d.patient_name) as patient_name,
      d.vial_external_id,
      d.total_dispensed_ml,
      d.waste_ml,
      COALESCE(dt.dea_drug_name, v.dea_drug_name) as dea_drug_name
    FROM dispenses d
    LEFT JOIN patients p ON d.patient_id = p.patient_id
    LEFT JOIN vials v ON d.vial_id = v.vial_id
    LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
    WHERE d.dispense_date >= CURRENT_DATE - INTERVAL '30 days'
      AND (
        COALESCE(dt.dea_drug_name, v.dea_drug_name) ILIKE '%carrie%' 
        OR COALESCE(dt.dea_drug_name, v.dea_drug_name) ILIKE '%miglyol%'
        OR v.size_ml::numeric >= 20
      )
    ORDER BY d.dispense_date DESC
  `);

    console.log(`Total Carrie Boyd dispenses (30d): ${dispenses.length}`);
    let totalDispensedMl = 0;
    let totalWasteMl = 0;
    for (const d of dispenses) {
        const dispensed = parseFloat(d.total_dispensed_ml || '0');
        const waste = parseFloat(d.waste_ml || '0');
        totalDispensedMl += dispensed;
        totalWasteMl += waste;
        console.log(`  ${d.dispense_date}: ${d.patient_name} - ${dispensed}ml dispensed, ${waste}ml waste (vial: ${d.vial_external_id})`);
    }
    console.log(`\nTotal dispensed (30d): ${totalDispensedMl.toFixed(1)} ml`);
    console.log(`Total waste (30d): ${totalWasteMl.toFixed(1)} ml`);

    // Check vial remaining vs dispenses match for Carrie Boyd vials with volume
    console.log('\n\n=== VIAL ACCOUNTING CHECK (Carrie Boyd with remaining volume) ===\n');

    for (const vial of carrieBoyVials) {
        const vialDispenses = await query<{
            total_dispensed: string | null;
            total_waste: string | null;
            dispense_count: string | null;
        }>(`
      SELECT 
        COALESCE(SUM(total_dispensed_ml::numeric), 0) as total_dispensed,
        COALESCE(SUM(COALESCE(waste_ml::numeric, 0)), 0) as total_waste,
        COUNT(*) as dispense_count
      FROM dispenses
      WHERE vial_external_id = $1
    `, [vial.external_id]);

        const sizeMl = parseFloat(vial.size_ml || '30');
        const remaining = parseFloat(vial.remaining_volume_ml || '0');
        const totalDispensed = parseFloat(vialDispenses[0]?.total_dispensed || '0');
        const totalWaste = parseFloat(vialDispenses[0]?.total_waste || '0');
        const dispenseCount = parseInt(vialDispenses[0]?.dispense_count || '0');
        const expected = sizeMl - totalDispensed - totalWaste;
        const discrepancy = remaining - expected;

        console.log(`Vial ${vial.external_id}:`);
        console.log(`  Size: ${sizeMl} ml`);
        console.log(`  Recorded Remaining: ${remaining} ml`);
        console.log(`  Dispense Count: ${dispenseCount}`);
        console.log(`  Total Dispensed (from dispenses): ${totalDispensed.toFixed(2)} ml`);
        console.log(`  Total Waste (from dispenses): ${totalWaste.toFixed(2)} ml`);
        console.log(`  Expected Remaining (size - dispensed - waste): ${expected.toFixed(2)} ml`);
        console.log(`  DISCREPANCY: ${discrepancy.toFixed(2)} ml`);
        if (Math.abs(discrepancy) > 0.1) {
            console.log(`  ⚠️ WARNING: Discrepancy detected! Remaining doesn't match expected.`);
        } else {
            console.log(`  ✅ Accounting matches`);
        }
        console.log('');
    }

    // Compare with what staff says (1.75 vials = 52.5 ml)
    console.log('\n=== STAFF REPORTED vs SYSTEM ===');
    console.log(`Staff says: 1.75 vials = ${(1.75 * 30).toFixed(1)} ml`);
    console.log(`System shows: ${carrieBoyVials.length} vials with ${totalCarrieBoydMl.toFixed(1)} ml remaining`);
    console.log(`System equivalent vials: ${(totalCarrieBoydMl / 30).toFixed(2)}`);

    const difference = totalCarrieBoydMl - 52.5;
    if (Math.abs(difference) > 5) {
        console.log(`\n⚠️ SIGNIFICANT DISCREPANCY: System shows ${difference > 0 ? 'MORE' : 'LESS'} inventory`);
        console.log(`   Difference: ${Math.abs(difference).toFixed(1)} ml (${Math.abs(difference / 30).toFixed(2)} vials)`);
    }

    process.exit(0);
}

checkInventory().catch(e => {
    console.error(e);
    process.exit(1);
});

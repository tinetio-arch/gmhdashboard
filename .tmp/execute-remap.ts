/**
 * PATIENT REMAP EXECUTION
 *
 * Step 1: Remap 30 patients' healthie_client_id in dashboard DB
 * Step 2: Reactivate Keira Gannon & Webb Wartelle's archived records (have cards),
 *         remap dashboard to those, archive the cardless duplicates
 * Step 3: Remove 3 test accounts from dashboard
 * Step 4: Fix 9 blocked lab_review_queue records
 *
 * All DB changes in a single transaction. Healthie API calls before commit.
 */
import { getPool } from '../lib/db';
import { getHealthieClient } from '../lib/healthie';

const healthie = getHealthieClient();

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ═══ STEP 1: 30 safe remaps ═══
// Only patients still pointing to archived IDs (8 already fixed: Brian Minor, Bruce French,
// Cole Johnson, Donavon Connor, Jakob Woods, Kenneth Holley, Larry Dorrell, Nick Scanlan)
const remaps = [
  { name: 'Brad Penner',        from: '12765844', to: '12183130' },
  { name: 'Dale Potter',        from: '12209123', to: '12746957' },
  { name: 'Dominic Milano',     from: '12208928', to: '12743413' },
  { name: 'Eric Schroeter',     from: '12182981', to: '12743720' },
  { name: 'Jesus Hurtado',      from: '12177877', to: '12743700' },
  { name: 'John Stonecipher',   from: '12183142', to: '12745264' },
  { name: 'Josh Straight',      from: '12694147', to: '12193931' },
  { name: 'Katie Larson',       from: '12212054', to: '12745674' },
  { name: 'Kevin Hilton',       from: '12181690', to: '12742906' },
  { name: 'Lynn Ragels',        from: '12747089', to: '12705139' },
  { name: 'Margaret Maneely',   from: '12746808', to: '12705170' },
  { name: 'Michele Meyer',      from: '12743303', to: '12705226' },
  { name: 'Michelle Fox',       from: '12745662', to: '12705283' },
  { name: 'Mike Kuenzi',        from: '12182280', to: '12745360' },
  { name: 'Nikolai Freemyer',   from: '12177176', to: '12745774' },
  { name: 'Phil Joswiak',       from: '13115382', to: '13113511' },
  { name: 'Randy Schafer',      from: '12183151', to: '12743499' },
  { name: 'Robert Simpson',     from: '12182413', to: '12744519' },
  { name: 'Seth Jesson',        from: '12744145', to: '12705489' },
  { name: 'Shawn Antrim',       from: '12183034', to: '12742287' },
  { name: 'Tracy Byam',         from: '12745340', to: '12705544' },
  { name: 'Tyler Ellsworth',    from: '12177203', to: '12744260' },
];

// ═══ STEP 2: Keira & Webb — merge to card-holding record ═══
// Keira: TWO dashboard records.
//   - 471ea04b... → 12182730 (archived in Healthie, has card ****1803, 5 forms) ← KEEP THIS
//   - fa75dcdd... → 12746078 (active in Healthie, no card, 1 form, 1 appt) ← REMOVE DUPLICATE
//   Action: reactivate 12182730, archive 12746078, delete duplicate dashboard record
// Webb: ONE dashboard record → 12742342 (active in Healthie, no card, 2 billing)
//   Archived 12182401 has card ****0454, 3 forms
//   Action: reactivate 12182401, remap dashboard to it, archive 12742342
const merges = [
  {
    name: 'Keira Gannon',
    keepHealthieId: '12182730',        // reactivate this in Healthie (has card)
    archiveHealthieId: '12746078',     // archive this in Healthie
    keepDashboardId: '471ea04b-45a6-4527-9109-31e8b8e06a8a',    // keep this dashboard record
    removeDashboardId: 'fa75dcdd-da08-498c-8d67-20807625585b',  // set inactive (duplicate)
    needsRemap: false, // dashboard already points to keepHealthieId
  },
  {
    name: 'Webb Wartelle',
    keepHealthieId: '12182401',        // reactivate this in Healthie (has card)
    archiveHealthieId: '12742342',     // archive this in Healthie
    keepDashboardId: null,             // only one dashboard record
    removeDashboardId: null,
    needsRemap: true, // dashboard currently points to 12742342, needs to change to 12182401
  },
];

// ═══ STEP 3: Test accounts to remove ═══
const testRemovals = [
  { name: 'App Tester',  healthieId: '13648106' },
  { name: 'John Doe2',   healthieId: '13568112' },
  { name: 'Eric Foster',  healthieId: '12765875' },
];

// ═══ STEP 4: Lab queue fixes ═══
// Lab queue fixes — remap to active Healthie IDs
// Webb Wartelle's lab already points to 12182401 which we're reactivating — no change needed
const labFixes = [
  { patient: 'Nick Scanlan',    labHealthieId: '12743406', correctId: '12180012' },
  { patient: 'Larry Dorrell',   labHealthieId: '12178454', correctId: '12743526' },
  { patient: 'Kenneth Holley',  labHealthieId: '12743119', correctId: '12165146' },
  { patient: 'Donavon Connor',  labHealthieId: '12182142', correctId: '12746762' },
  { patient: 'Cole Johnson',    labHealthieId: '12177460', correctId: '12744193' },
  { patient: 'Bruce French',    labHealthieId: '12745786', correctId: '12765861' },
  { patient: 'Brian Minor',     labHealthieId: '12743763', correctId: '12182579' },
  { patient: 'Jakob Woods',     labHealthieId: '12182751', correctId: '12743531' },
];

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // ═══ DRY RUN: Verify all records exist before touching anything ═══
    console.log('═══ PRE-FLIGHT VERIFICATION ═══\n');

    // Verify all 30 remap patients exist with expected archived IDs
    for (const r of remaps) {
      const check = await client.query(
        'SELECT patient_id, full_name, healthie_client_id FROM patients WHERE healthie_client_id = $1',
        [r.from]
      );
      if (check.rows.length === 0) {
        throw new Error(`ABORT: ${r.name} not found with healthie_client_id ${r.from}`);
      }
      if (check.rows.length > 1) {
        throw new Error(`ABORT: Multiple patients found with healthie_client_id ${r.from}`);
      }
    }
    console.log(`✓ All ${remaps.length} remap patients verified in DB`);

    // Verify Keira & Webb
    for (const m of merges) {
      const check = await client.query(
        'SELECT patient_id, full_name, healthie_client_id FROM patients WHERE healthie_client_id = $1',
        [m.keepHealthieId]
      );
      if (m.name === 'Keira Gannon' && check.rows.length !== 1) {
        throw new Error(`ABORT: Expected 1 Keira record with ${m.keepHealthieId}, got ${check.rows.length}`);
      }
      if (m.name === 'Webb Wartelle') {
        // Webb's dashboard points to archiveHealthieId, not keepHealthieId
        const wCheck = await client.query(
          'SELECT patient_id FROM patients WHERE healthie_client_id = $1',
          [m.archiveHealthieId]
        );
        if (wCheck.rows.length !== 1) {
          throw new Error(`ABORT: Expected 1 Webb record with ${m.archiveHealthieId}, got ${wCheck.rows.length}`);
        }
      }
    }
    console.log(`✓ Keira & Webb verified`);

    // Verify test accounts
    for (const t of testRemovals) {
      const check = await client.query(
        'SELECT patient_id, full_name FROM patients WHERE healthie_client_id = $1',
        [t.healthieId]
      );
      if (check.rows.length === 0) {
        console.log(`  ⚠ ${t.name} (${t.healthieId}) not found — may already be removed`);
      }
    }
    console.log(`✓ Test accounts checked`);

    // Verify lab queue records
    for (const l of labFixes) {
      const check = await client.query(
        'SELECT id, patient_name FROM lab_review_queue WHERE healthie_id = $1 AND status = $2',
        [l.labHealthieId, 'pending_review']
      );
      if (check.rows.length === 0) {
        console.log(`  ⚠ Lab for ${l.patient} with healthie_id ${l.labHealthieId} not found in pending`);
      }
    }
    console.log(`✓ Lab queue records checked\n`);

    // ═══ HEALTHIE API: Reactivate Keira & Webb's archived records ═══
    console.log('═══ HEALTHIE API CHANGES ═══\n');

    for (const m of merges) {
      console.log(`  Reactivating ${m.name} (${m.keepHealthieId})...`);
      const result = await healthie.updateClient(m.keepHealthieId, { active: true } as any);
      console.log(`  ✓ ${m.name} reactivated: ${result.first_name} ${result.last_name}`);
      await sleep(1000);

      console.log(`  Archiving duplicate Healthie record ${m.name} (${m.archiveHealthieId})...`);
      const result2 = await healthie.updateClient(m.archiveHealthieId, { active: false } as any);
      console.log(`  ✓ Duplicate archived: ${result2.first_name} ${result2.last_name}`);
      await sleep(1000);
    }

    // ═══ DATABASE TRANSACTION ═══
    console.log('\n═══ DATABASE CHANGES (TRANSACTION) ═══\n');
    await client.query('BEGIN');

    // Step 1: Remap 30 patients
    let remapCount = 0;
    for (const r of remaps) {
      const result = await client.query(
        'UPDATE patients SET healthie_client_id = $1 WHERE healthie_client_id = $2 RETURNING full_name',
        [r.to, r.from]
      );
      if (result.rowCount === 1) {
        remapCount++;
      } else {
        throw new Error(`ABORT: Expected 1 row updated for ${r.name}, got ${result.rowCount}`);
      }
    }
    console.log(`  ✓ Remapped ${remapCount}/${remaps.length} patients`);

    // Step 2: Keira & Webb
    for (const m of merges) {
      if (m.name === 'Keira Gannon') {
        // Keira has TWO dashboard records. Keep the one pointing to 12182730 (card), remove the duplicate.
        await client.query(
          "UPDATE patients SET status_key = 'inactive' WHERE patient_id = $1",
          [m.removeDashboardId]
        );
        console.log(`  ✓ Keira Gannon: duplicate dashboard record (${m.removeDashboardId}) set inactive`);
        console.log(`  ✓ Keira Gannon: keeping record with healthie_client_id=${m.keepHealthieId} (reactivated, has card)`);
      } else if (m.name === 'Webb Wartelle') {
        // Webb has ONE dashboard record pointing to 12742342 (no card). Remap to 12182401 (has card, reactivated).
        const result = await client.query(
          'UPDATE patients SET healthie_client_id = $1 WHERE healthie_client_id = $2 RETURNING full_name',
          [m.keepHealthieId, m.archiveHealthieId]
        );
        if (result.rowCount !== 1) {
          throw new Error(`ABORT: Expected 1 row for Webb remap, got ${result.rowCount}`);
        }
        console.log(`  ✓ Webb Wartelle: remapped ${m.archiveHealthieId} → ${m.keepHealthieId} (reactivated, has card)`);
      }
    }

    // Step 3: Remove test accounts (set inactive, don't delete)
    for (const t of testRemovals) {
      const result = await client.query(
        "UPDATE patients SET status_key = 'inactive', healthie_client_id = NULL WHERE healthie_client_id = $1 RETURNING full_name",
        [t.healthieId]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`  ✓ ${t.name} set to inactive, Healthie link removed`);
      } else {
        console.log(`  ⚠ ${t.name} not found — skipped`);
      }
    }

    // Step 4: Fix lab queue records
    let labFixCount = 0;
    for (const l of labFixes) {
      const result = await client.query(
        "UPDATE lab_review_queue SET healthie_id = $1 WHERE healthie_id = $2 AND status = 'pending_review'",
        [l.correctId, l.labHealthieId]
      );
      if (result.rowCount && result.rowCount > 0) {
        labFixCount += result.rowCount;
        console.log(`  ✓ ${l.patient} lab(s) remapped: ${l.labHealthieId} → ${l.correctId}`);
      }
    }
    console.log(`  ✓ Fixed ${labFixCount} lab queue records`);

    // ═══ COMMIT ═══
    await client.query('COMMIT');
    console.log('\n═══ ALL CHANGES COMMITTED SUCCESSFULLY ═══\n');

    // ═══ POST-VERIFICATION ═══
    console.log('═══ POST-VERIFICATION ═══\n');

    // Check a few patients to confirm
    const spot = ['Larry Dorrell', 'Nick Scanlan', 'Keira Gannon', 'Webb Wartelle'];
    for (const name of spot) {
      const r = await client.query(
        'SELECT full_name, healthie_client_id, status_key FROM patients WHERE full_name = $1',
        [name]
      );
      if (r.rows.length > 0) {
        const p = r.rows[0];
        console.log(`  ${p.full_name}: healthie_client_id=${p.healthie_client_id}, status=${p.status_key}`);
      }
    }

    // Check test accounts
    for (const t of testRemovals) {
      const r = await client.query(
        'SELECT full_name, healthie_client_id, status_key FROM patients WHERE full_name = $1',
        [t.name]
      );
      if (r.rows.length > 0) {
        console.log(`  ${r.rows[0].full_name}: healthie=${r.rows[0].healthie_client_id || 'NULL'}, status=${r.rows[0].status_key}`);
      }
    }

    // Check pending labs
    const pendingLabs = await client.query(
      "SELECT patient_name, healthie_id, status FROM lab_review_queue WHERE status = 'pending_review' ORDER BY created_at DESC LIMIT 15"
    );
    console.log(`\n  Pending lab queue (top 15):`);
    for (const l of pendingLabs.rows) {
      console.log(`    ${l.patient_name.padEnd(20)} healthie_id=${l.healthie_id}`);
    }

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n🔴 ROLLED BACK — no changes made');
    console.error('Error:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

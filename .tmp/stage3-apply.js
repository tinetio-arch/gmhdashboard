/* eslint-disable */
/**
 * STAGE 3 APPLY — legacy QBO/Jane key cleanup + clinic↔key contradiction fixes.
 * Single transaction. Audit row per change. Aborts if any pid8 has drifted.
 *
 * Scope (24 applies, 9 holds):
 *   Stage 3a (14): jane_X / qbo_X on MH clinic → nowmenshealth
 *   Stage 3b (7):  ins_supp_60_month on MH     → nowmenshealth
 *   Stage 3b (3):  Brandon Boggs               → nowprimarycare (Healthie weight-loss appts)
 *                  Jacob Vinton                → sick_visit (allergy only — no discount per Phil)
 *                  "Taylor" (no Healthie id)   → other (orphan record)
 *
 * HOLD for Phil (surfaced separately, NOT modified here):
 *   Bob Walker, Greg Eastom, Linda Hargrave, Keira Gannon, Jackie Miller,
 *   Raul Martinez, Taylor Murphy, Heather Snyder, Jodi Ellsworth
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// pid8 → { name, expected_from_key, to_key, conf, evidence }
// expected_from_key is checked before update — abort if it has drifted.
const PLAN = [
  // ═══ Stage 3a: legacy QBO/Jane keys on MH clinic → nowmenshealth ═══
  { pid8: 'e080f97d', name: 'Jeff Hall',         from: 'jane_f_f_fr_veteran_140_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },
  { pid8: 'cd03d8ae', name: 'Joe Ramos',         from: 'jane_f_f_fr_veteran_140_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 4 } },
  { pid8: 'f7f7e584', name: 'Mark Palm',         from: 'jane_f_f_fr_veteran_140_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 1 } },
  { pid8: 'b3e0b1bd', name: 'Andy Austin',       from: 'jane_tcmh_180_month',           to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 1 } },
  { pid8: '44928eb1', name: 'David Edwards',     from: 'jane_tcmh_180_month',           to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 1 } },
  { pid8: '57a4b2b5', name: 'Mike Kuenzi',       from: 'jane_tcmh_180_month',           to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 3 } },
  { pid8: '8ef2a69a', name: 'Andrew Strople',    from: 'qbo_f_f_fr_veteran_140_month',  to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 0 } },
  { pid8: 'b6f5f98a', name: 'Andrew Taylor',     from: 'qbo_f_f_fr_veteran_140_month',  to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 6 } },
  { pid8: 'd9ece7b4', name: 'Bryan Campbell',    from: 'qbo_f_f_fr_veteran_140_month',  to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 1 } },
  { pid8: '48399208', name: 'Tyler Ellsworth',   from: 'qbo_f_f_fr_veteran_140_month',  to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },
  { pid8: '56321080', name: 'Jesus Hurtado',     from: 'qbo_tcmh_180_month',            to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },
  { pid8: '9e33f65d', name: 'Joseph Sirochman',  from: 'qbo_tcmh_180_month',            to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 1 } },
  { pid8: 'ca3234f8', name: 'Kevin Hilton',      from: 'qbo_tcmh_180_month',            to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 3 } },
  { pid8: 'b6178768', name: 'Nate Hallowell',    from: 'qbo_tcmh_180_month',            to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_legacy_key_cleanup', clinic: 'nowmenshealth.care', dispenses: 4 } },

  // ═══ Stage 3b: ins_supp_60_month on MH clinic → nowmenshealth ═══
  { pid8: '532f49c2', name: 'Blake Edwards',     from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 3 } },
  { pid8: '0f6d5d77', name: 'Chris fenner',      from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 3 } },
  { pid8: '3317f322', name: 'Eric Schroeter',    from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },
  { pid8: '609a0989', name: 'Erik Meinhardt',    from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 4 } },
  { pid8: '45c0f984', name: 'Nate Wools',        from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },
  { pid8: 'c0fa2ddc', name: 'Ron Muenks',        from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'medium', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 0, note: 'no_dispenses_but_moves_with_ins_supp_cohort' } },
  { pid8: '99815be5', name: 'Shawn Antrim',      from: 'ins_supp_60_month', to: 'nowmenshealth', conf: 'high', ev: { signal: 'clinic_match_ins_supp_cleanup', clinic: 'nowmenshealth.care', dispenses: 2 } },

  // ═══ Stage 3b: PC-clinic patients with wrong nowlongevity key — disambiguated via Healthie appts ═══
  { pid8: '7e12babc', name: 'Brandon Boggs',     from: 'nowlongevity', to: 'nowprimarycare', conf: 'high', ev: { signal: 'healthie_appointment_type', matched: ['Weight Loss Consult'], note: 'pc_clinic_weight_loss_only' } },
  { pid8: '7bc817fb', name: 'Jacob Vinton',      from: 'nowlongevity', to: 'sick_visit',     conf: 'medium', ev: { signal: 'healthie_appointment_type', matched: ['Allergy Injection Consult'], rule: 'allergy_no_discount_per_phil_2026_04_28' } },

  // ═══ Stage 3b: orphan record without Healthie ID ═══
  { pid8: 'ee4a67f7', name: 'Taylor',            from: 'nowlongevity', to: 'other',          conf: 'low', ev: { signal: 'fallback', note: 'no_healthie_id_no_last_name_orphan_record' } },
];

// Patients we are deliberately NOT touching — surfaced for Phil's decision.
const HOLDS = [
  { pid8: '6b4bef47', name: 'Bob Walker',       reason: 'PC clinic + jane_veteran key + 2 dispenses — clinic conflicts with TRT pattern' },
  { pid8: '15fc3f63', name: 'Greg Eastom',      reason: 'MH clinic + nowprimarycare key + 0 dispenses — no signal to disambiguate' },
  { pid8: 'f96f95b2', name: 'Linda Hargrave',   reason: 'MH clinic + primecare_elite_100_month + 0 dispenses — no signal' },
  { pid8: '471ea04b', name: 'Keira Gannon',     reason: 'MH clinic + nowlongevity key + 2 dispenses — TRT pattern but key says longevity' },
  { pid8: '84746d01', name: 'Jackie Miller',    reason: 'PC clinic + nowmenshealth key + 3 dispenses — TRT confirms MH, but clinic field says PC' },
  { pid8: '233c5eb5', name: 'Raul Martinez',    reason: 'PC clinic + nowmenshealth key + 1 dispense — same shape as Jackie Miller' },
  { pid8: 'e52059f2', name: 'Taylor Murphy',    reason: 'PC clinic + nowlongevity key + 0 dispenses — no Healthie appt signal' },
  { pid8: '535c1d4e', name: 'Heather Snyder',   reason: 'Healthie confirms longevity (Female Hormone + Pelleting). KEY is right; CLINIC field is wrong — separate fix' },
  { pid8: 'ed8b69fb', name: 'Jodi Ellsworth',   reason: 'Healthie confirms longevity (Pelleting + Lab Draw). KEY is right; CLINIC field is wrong — separate fix' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve each pid8 and verify from_key matches what we expect (drift detection)
    const resolved = [];
    for (const p of PLAN) {
      const r = await client.query(
        `SELECT patient_id, full_name, client_type_key, healthie_client_id, status_key
         FROM patients
         WHERE patient_id::text LIKE $1
           AND LOWER(status_key) IN ('active','active_pending')`,
        [p.pid8 + '%']
      );
      if (r.rows.length !== 1) {
        throw new Error(`Expected 1 active patient for ${p.pid8} (${p.name}), got ${r.rows.length}`);
      }
      const row = r.rows[0];
      if (row.client_type_key !== p.from) {
        throw new Error(`${p.name} (${p.pid8}) drift: expected from="${p.from}", current="${row.client_type_key}". Aborting.`);
      }
      if (row.client_type_key === p.to) {
        throw new Error(`${p.name} (${p.pid8}) is already at target "${p.to}" — should not be in plan.`);
      }
      resolved.push({ ...p, patient_id: row.patient_id, full_name: row.full_name, healthie_id: row.healthie_client_id });
    }

    console.log(`═══ Resolved ${resolved.length} patients for Stage 3 apply ═══`);
    resolved.forEach(p => console.log(`  ${p.pid8} ${(p.full_name || '').padEnd(22)} ${p.from.padEnd(35)} → ${p.to} (${p.conf})`));
    console.log('');

    let updated = 0;
    for (const p of resolved) {
      const evidenceWithMeta = {
        ...p.ev,
        from_key: p.from,
        healthie_client_id: p.healthie_id,
        applied_at: new Date().toISOString(),
        approved_by: 'phil',
        approval_context: 'stage3_cleanup_2026_04_28',
      };

      await client.query(
        `INSERT INTO client_type_audit
           (patient_id, from_value, to_value, source, reason, evidence, confidence, was_skipped)
         VALUES ($1, $2, $3, 'reconciler', $4, $5::jsonb, $6, false)`,
        [p.patient_id, p.from, p.to, `Phase 3 Stage 3 cleanup — ${p.conf} confidence`, JSON.stringify(evidenceWithMeta), p.conf]
      );

      const u = await client.query(
        `UPDATE patients
            SET client_type_key = $1,
                client_type_key_updated_at = NOW()
          WHERE patient_id = $2
            AND client_type_key = $3
          RETURNING patient_id`,
        [p.to, p.patient_id, p.from]
      );
      if (u.rowCount !== 1) {
        throw new Error(`UPDATE for ${p.full_name} affected ${u.rowCount} rows (expected 1) — race condition?`);
      }
      updated++;
    }

    console.log(`✓ Wrote ${updated} audit rows + ${updated} UPDATEs (staged).`);

    await client.query('COMMIT');
    console.log('✓ COMMITTED.\n');

    // Post-apply verification
    const verify = await pool.query(`
      SELECT p.full_name, p.client_type_key, p.client_type_key_updated_at,
             a.audit_id, a.from_value, a.to_value, a.confidence
      FROM patients p
      JOIN client_type_audit a ON a.patient_id = p.patient_id
      WHERE p.patient_id::text IN ('${resolved.map(r => r.patient_id).join("','")}')
        AND a.created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY a.audit_id`);
    console.log('═══ Post-apply verification ═══');
    console.table(verify.rows.map(r => ({
      name: r.full_name,
      key: r.client_type_key,
      from: r.from_value,
      to: r.to_value,
      conf: r.confidence
    })));

    // Post-apply CEO snapshot
    const snap = await pool.query(`
      SELECT COALESCE(client_type_key, '(NULL)') AS client_type_key, COUNT(*) AS active_patients
      FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
      GROUP BY 1 ORDER BY 2 DESC`);
    console.log('\n═══ Post-apply CEO snapshot — patient counts by client_type_key ═══');
    console.table(snap.rows);

    // Holds report
    console.log(`\n═══ HOLDS — ${HOLDS.length} patients require Phil's decision ═══`);
    for (const h of HOLDS) {
      const r = await pool.query(
        `SELECT full_name, clinic, client_type_key, healthie_client_id,
                (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispenses
         FROM patients p WHERE patient_id::text LIKE $1`, [h.pid8 + '%']);
      const row = r.rows[0] || {};
      console.log(`  ${h.pid8} ${(row.full_name || h.name).padEnd(22)} clinic=${row.clinic || '?'} key=${row.client_type_key || '?'} dispenses=${row.dispenses || 0}`);
      console.log(`    → ${h.reason}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n✗ ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

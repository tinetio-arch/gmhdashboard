/* eslint-disable */
/**
 * STAGE 2 FINAL APPLY — 7 classifications + James Womble merge cleanup.
 * Single transaction. Rolls back on any error.
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CLASSIFY = [
  { pid8: '098a7ff0', name: 'Dave Brown',     key: 'nowmenshealth',  conf: 'high',   ev: { matched: ['Initial Male Hormone Replacement Consult'], note: 'gender_unset_in_db_but_no_contradiction' } },
  { pid8: '5cb5ede6', name: 'Faith Dekens',   key: 'nowlongevity',   conf: 'high',   ev: { matched: ['EvexiPel Repeat Pelleting Procedure Female'] } },
  { pid8: '6d2f8f64', name: 'George Navarre', key: 'nowmenshealth',  conf: 'high',   ev: { matched: ['NMH TRT Supply Refill'] } },
  { pid8: 'd838c789', name: 'Jackson Woods',  key: 'nowmenshealth',  conf: 'high',   ev: { matched: ['Initial Male Hormone Replacement Consult'] } },
  { pid8: '6306449e', name: 'John Lucas',     key: 'nowmenshealth',  conf: 'high',   ev: { matched: ['Initial Male Hormone Replacement Consult'], note: 'gender_unset_in_db_but_no_contradiction' } },
  { pid8: 'c0fa08c4', name: 'John McKee',     key: 'sick_visit',     conf: 'medium', ev: { matched: ['Telemedicine Sick Consult'] } },
  { pid8: '8e04d4b3', name: 'Bradley Odom',   key: 'other',          conf: 'low',    ev: { matched: ['90 Day Lab Draw'], note: 'no_rule_match_default_other; v3_audit_2026_04_16: not_dup_of_milfred_tewawina_split_ghl' } },
];

const JAMES_PID8 = '02d24f1d';
const EVAN_PID = 'b4d0ef73-'; // prefix for Evan Womble (resolved in TX)

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── Resolve UUIDs for the 7 ───
    const resolved = [];
    for (const p of CLASSIFY) {
      const r = await client.query(
        `SELECT patient_id, full_name, client_type_key, healthie_client_id
         FROM patients
         WHERE patient_id::text LIKE $1 AND LOWER(status_key) IN ('active','active_pending')`,
        [p.pid8 + '%']
      );
      if (r.rows.length !== 1) throw new Error(`Expected 1 for ${p.pid8} (${p.name}), got ${r.rows.length}`);
      if (r.rows[0].client_type_key && r.rows[0].client_type_key !== '') {
        throw new Error(`${p.name} no longer NULL — current="${r.rows[0].client_type_key}". Aborting.`);
      }
      resolved.push({ ...p, patient_id: r.rows[0].patient_id, healthie_id: r.rows[0].healthie_client_id });
    }

    // ─── Resolve James + Evan UUIDs ───
    const evanRow = await client.query(
      `SELECT patient_id FROM patients WHERE patient_id::text LIKE $1`,
      [EVAN_PID + '%']
    );
    if (evanRow.rows.length !== 1) throw new Error(`Couldn't resolve Evan Womble (${EVAN_PID})`);
    const evanId = evanRow.rows[0].patient_id;

    const jamesRow = await client.query(
      `SELECT patient_id, status_key, healthie_client_id, notes
       FROM patients WHERE patient_id::text LIKE $1`,
      [JAMES_PID8 + '%']
    );
    if (jamesRow.rows.length !== 1) throw new Error(`Couldn't resolve James Womble (${JAMES_PID8})`);
    const james = jamesRow.rows[0];
    if (james.healthie_client_id !== '12743400') {
      throw new Error(`James healthie_id changed since dry-run: expected 12743400 got ${james.healthie_client_id}. Aborting.`);
    }

    console.log('═══ Plan ═══');
    resolved.forEach(p => console.log(`  CLASSIFY  ${p.pid8} ${p.name.padEnd(20)} → ${p.key} (${p.conf})`));
    console.log(`  MERGE     ${JAMES_PID8} James Womble        → inactive (duplicate of Evan ${evanId.slice(0,8)})`);
    console.log('');

    // ─── Apply classifications (audit + UPDATE) ───
    for (const p of resolved) {
      const evidence = {
        ...p.ev,
        signal: 'healthie_appointment_type',
        healthie_client_id: p.healthie_id,
        applied_at: new Date().toISOString(),
        approved_by: 'phil',
        approval_context: 'stage2_dryrun_2026_05_05_batch2',
      };
      await client.query(
        `INSERT INTO client_type_audit (patient_id, from_value, to_value, source, reason, evidence, confidence, was_skipped)
         VALUES ($1, NULL, $2, 'reconciler', $3, $4::jsonb, $5, false)`,
        [p.patient_id, p.key, `Phase 3 Stage 2 batch 2 — ${p.conf} confidence`, JSON.stringify(evidence), p.conf]
      );
      const u = await client.query(
        `UPDATE patients SET client_type_key=$1, client_type_key_updated_at=NOW()
         WHERE patient_id=$2 AND (client_type_key IS NULL OR client_type_key='')
         RETURNING patient_id`,
        [p.key, p.patient_id]
      );
      if (u.rowCount !== 1) throw new Error(`UPDATE for ${p.name} affected ${u.rowCount} rows`);
    }
    console.log(`✓ ${resolved.length} classifications staged.`);

    // ─── James merge cleanup ───
    const mergeNote = `[MERGED 2026-05-05] Duplicate of Evan Womble (${evanId}). Healthie patient 12743400 was merged into Evan's 12179578 in Healthie by Phil. James row deactivated; original healthie_id preserved in this note.`;
    const newNotes = (james.notes ? james.notes.trim() + '\n\n' : '') + mergeNote;
    const ju = await client.query(
      `UPDATE patients
          SET status_key = 'inactive',
              healthie_client_id = NULL,
              notes = $1,
              updated_at = NOW()
        WHERE patient_id::text LIKE $2
          AND status_key = 'active'
        RETURNING patient_id, status_key, healthie_client_id`,
      [newNotes, JAMES_PID8 + '%']
    );
    if (ju.rowCount !== 1) throw new Error(`James merge UPDATE affected ${ju.rowCount} rows`);
    console.log(`✓ James Womble merged: status=inactive, healthie_client_id cleared.`);

    await client.query('COMMIT');
    console.log('✓ COMMITTED.\n');

    // ─── Verification ───
    const v1 = await pool.query(`
      SELECT p.full_name, p.client_type_key, p.client_type_key_updated_at,
             a.confidence, a.evidence->>'note' AS note
      FROM patients p
      JOIN client_type_audit a ON a.patient_id = p.patient_id
      WHERE p.patient_id IN ('${resolved.map(r => r.patient_id).join("','")}')
        AND a.created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY p.full_name
    `);
    console.log('═══ Classified ═══');
    console.table(v1.rows);

    const v2 = await pool.query(`
      SELECT full_name, status_key, healthie_client_id,
             SUBSTRING(notes FROM '\\[MERGED.*$') AS merge_note
      FROM patients WHERE patient_id::text LIKE $1
    `, [JAMES_PID8 + '%']);
    console.log('═══ James Womble after merge ═══');
    console.table(v2.rows);

    const v3 = await pool.query(`
      SELECT COUNT(*) AS still_null FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND (client_type_key IS NULL OR client_type_key = '')
    `);
    console.log(`\nActive patients still NULL: ${v3.rows[0].still_null}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n✗ ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

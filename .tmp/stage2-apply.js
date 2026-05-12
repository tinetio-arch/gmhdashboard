/* eslint-disable */
/**
 * STAGE 2 APPLY — only the 8 still-NULL patients Phil already approved.
 * Single transaction. Writes audit rows. Rolls back on any error.
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// patient_id 8-char prefix → { key, confidence, evidence }
// Confidence levels match the audit table check constraint: high|medium|low
const PLAN = [
  { pid8: 'a08df1c1', name: 'Elias Estrada',      key: 'nowmenshealth',  conf: 'high',   ev: { signal: 'healthie_appointment_type', matched: ['Initial Male Hormone Replacement Consult'] } },
  { pid8: '95a3602d', name: 'Julie Jongsma',      key: 'sick_visit',     conf: 'medium', ev: { signal: 'healthie_appointment_type', matched: ['In-Person Sick Visit'] } },
  { pid8: 'ffc63a2b', name: 'Mary (Tisa) Milano', key: 'nowprimarycare', conf: 'high',   ev: { signal: 'healthie_appointment_type', matched: ['PC Follow-Up'] } },
  { pid8: '3e5ec1cc', name: 'William Sheetz',     key: 'sick_visit',     conf: 'medium', ev: { signal: 'healthie_appointment_type', matched: ['In-Person Sick Visit'] } },
  { pid8: 'e3f6a4b9', name: 'Jessica Leick',      key: 'sick_visit',     conf: 'medium', ev: { signal: 'healthie_appointment_type', matched: ['Allergy Injection Consult'], rule: 'allergy_no_discount_per_phil_2026_04_28' } },
  { pid8: 'e60a6f01', name: 'Paul Peterson',      key: 'sick_visit',     conf: 'medium', ev: { signal: 'healthie_appointment_type', matched: ['Allergy Injection Consult'], rule: 'allergy_no_discount_per_phil_2026_04_28' } },
  { pid8: 'de501dd0', name: 'Shannon Schrader',   key: 'other',          conf: 'low',    ev: { signal: 'fallback', matched: ['Initial Male Hormone Replacement Consult'], note: 'staff_booking_error_per_phil_2026_04_28; gender=F so MH appt was incorrect; defaulted to other for manual review' } },
  { pid8: '83ac5570', name: 'Tamara Yount',       key: 'other',          conf: 'low',    ev: { signal: 'fallback', matched: ['Migrated Appointment'], note: 'no_signal_default_other' } },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve full UUIDs by prefix and confirm still-NULL
    const resolved = [];
    for (const p of PLAN) {
      const r = await client.query(
        `SELECT patient_id, full_name, client_type_key, healthie_client_id
         FROM patients
         WHERE patient_id::text LIKE $1
           AND LOWER(status_key) IN ('active','active_pending')`,
        [p.pid8 + '%']
      );
      if (r.rows.length !== 1) {
        throw new Error(`Expected 1 patient for prefix ${p.pid8} (${p.name}), got ${r.rows.length}`);
      }
      const row = r.rows[0];
      if (row.client_type_key && row.client_type_key !== '') {
        throw new Error(`${p.name} (${p.pid8}) is no longer NULL — current key="${row.client_type_key}". Aborting to avoid overwriting.`);
      }
      resolved.push({ ...p, patient_id: row.patient_id, full_name: row.full_name, healthie_id: row.healthie_client_id });
    }

    console.log('═══ Resolved 8 patients ═══');
    resolved.forEach(p => console.log(`  ${p.pid8} ${p.full_name.padEnd(24)} → ${p.key.padEnd(15)} (${p.conf})`));
    console.log('');

    // Apply each: audit row first, then UPDATE
    let updated = 0;
    for (const p of resolved) {
      const evidenceWithMeta = {
        ...p.ev,
        healthie_client_id: p.healthie_id,
        applied_at: new Date().toISOString(),
        approved_by: 'phil',
        approval_context: 'stage2_dry_run_2026_04_28',
      };

      await client.query(
        `INSERT INTO client_type_audit
           (patient_id, from_value, to_value, source, reason, evidence, confidence, was_skipped)
         VALUES ($1, NULL, $2, 'reconciler', $3, $4::jsonb, $5, false)`,
        [p.patient_id, p.key, `Phase 3 Stage 2 reconciler — ${p.conf} confidence`, JSON.stringify(evidenceWithMeta), p.conf]
      );

      const u = await client.query(
        `UPDATE patients
            SET client_type_key = $1,
                client_type_key_updated_at = NOW()
          WHERE patient_id = $2
            AND (client_type_key IS NULL OR client_type_key = '')
          RETURNING patient_id`,
        [p.key, p.patient_id]
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
             a.audit_id, a.confidence, a.evidence->>'rule' AS rule_note
      FROM patients p
      JOIN client_type_audit a ON a.patient_id = p.patient_id
      WHERE p.patient_id::text IN ('${resolved.map(r => r.patient_id).join("','")}')
        AND a.created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY p.full_name
    `);
    console.log('═══ Post-apply verification ═══');
    console.table(verify.rows);

    const remaining = await pool.query(`
      SELECT COUNT(*) AS still_null FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND (client_type_key IS NULL OR client_type_key = '')
    `);
    console.log(`\nActive patients still NULL: ${remaining.rows[0].still_null}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n✗ ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

/* eslint-disable */
require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, p) { return (await pool.query(sql, p || [])).rows; }
function s(t) { console.log('\n' + '═'.repeat(70) + '\n' + t + '\n' + '═'.repeat(70)); }

(async () => {
  try {
    s('A. Legacy QBO/Jane keys on active patients (Stage 3a scope)');
    const r3a = await q(`
      SELECT
        SUBSTRING(p.patient_id::text, 1, 8) AS pid8,
        p.full_name,
        p.clinic,
        p.client_type_key,
        p.healthie_client_id,
        (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispenses,
        (SELECT MAX(dispense_date) FROM dispenses d WHERE d.patient_id = p.patient_id) AS last_dispense,
        (SELECT COUNT(*) FROM payment_transactions pt WHERE pt.patient_id = p.patient_id AND pt.created_at > NOW() - INTERVAL '90 days') AS recent_charges
      FROM patients p
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND client_type_key ~* '^(qbo_|jane_|mens_health_qbo|mixed_)'
      ORDER BY client_type_key, full_name`);
    console.table(r3a);

    s('B. Clinic↔key contradictions (Stage 3b scope)');
    const r3b = await q(`
      SELECT
        SUBSTRING(p.patient_id::text, 1, 8) AS pid8,
        p.full_name,
        p.clinic,
        p.client_type_key,
        p.healthie_client_id,
        (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispenses,
        (SELECT MAX(dispense_date) FROM dispenses d WHERE d.patient_id = p.patient_id) AS last_dispense,
        (SELECT COUNT(*) FROM payment_transactions pt WHERE pt.patient_id = p.patient_id AND pt.created_at > NOW() - INTERVAL '90 days') AS recent_charges
      FROM patients p
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND clinic IS NOT NULL
        AND client_type_key IS NOT NULL
        AND client_type_key !~ '^(qbo_|jane_|mens_health_qbo|mixed_)'
        AND (
          (LOWER(clinic) LIKE '%menshealth%' AND client_type_key NOT IN ('nowmenshealth','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%primary%' AND client_type_key NOT IN ('nowprimarycare','primecare_premier_50_month','primecare_elite_100_month','ins_supp_60_month','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%longevity%' AND client_type_key NOT IN ('nowlongevity','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%mental%' AND client_type_key NOT IN ('nowmentalhealth','approved_disc_pro_bono_pt','sick_visit'))
        )
      ORDER BY clinic, client_type_key, full_name`);
    console.table(r3b);

    s('C. Pre-cutover CEO snapshot — patient counts by client_type_key (active)');
    const snap = await q(`
      SELECT COALESCE(client_type_key, '(NULL)') AS client_type_key, COUNT(*) AS active_patients
      FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
      GROUP BY 1 ORDER BY 2 DESC`);
    console.table(snap);

    s('D. Pre-cutover CEO snapshot — last 30d revenue by current key bucket');
    const rev = await q(`
      SELECT COALESCE(p.client_type_key, '(NULL)') AS bucket,
             COUNT(*) AS charges,
             ROUND(SUM(pt.amount)/100.0, 0) AS dollars
      FROM payment_transactions pt
      JOIN patients p ON p.patient_id = pt.patient_id
      WHERE pt.created_at >= NOW() - INTERVAL '30 days'
        AND pt.amount > 0
      GROUP BY 1 ORDER BY dollars DESC NULLS LAST`);
    console.table(rev);

    console.log(`\nStage 3a (legacy): ${r3a.length} patients`);
    console.log(`Stage 3b (contradictions): ${r3b.length} patients`);
  } catch (e) { console.error(e.message); }
  finally { await pool.end(); }
})();

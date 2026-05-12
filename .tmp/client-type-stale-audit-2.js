/* eslint-disable */
require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, p) { return (await pool.query(sql, p || [])).rows; }
function s(t) { console.log('\n' + '═'.repeat(70) + '\n' + t + '\n' + '═'.repeat(70)); }

(async () => {
  try {
    s('5. Active+nowmenshealth WITHOUT any active membership row (memberships OR clinicsync)');
    const r5 = await q(`
      SELECT COUNT(*) AS cnt
      FROM patients p
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND p.client_type_key = 'nowmenshealth'
        AND NOT EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.patient_id = p.patient_id AND LOWER(m.status) = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM clinicsync_memberships c
          WHERE c.patient_id = p.patient_id AND LOWER(c.membership_status) = 'active'
        )
    `);
    console.table(r5);

    s('6. Active+ NULL key but HAS an active membership row');
    const r6 = await q(`
      SELECT COUNT(*) AS cnt
      FROM patients p
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND (p.client_type_key IS NULL OR p.client_type_key = '')
        AND (
          EXISTS (SELECT 1 FROM memberships m WHERE m.patient_id = p.patient_id AND LOWER(m.status)='active')
          OR EXISTS (SELECT 1 FROM clinicsync_memberships c WHERE c.patient_id = p.patient_id AND LOWER(c.membership_status)='active')
        )
    `);
    console.table(r6);

    s('6b. Sample of those (top 20)');
    const r6b = await q(`
      SELECT p.patient_id, p.full_name, p.clinic, p.client_type_key,
             m.program_name, m.fee_amount, m.status,
             c.membership_plan, c.membership_status
      FROM patients p
      LEFT JOIN memberships m ON m.patient_id = p.patient_id
      LEFT JOIN clinicsync_memberships c ON c.patient_id = p.patient_id
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND (p.client_type_key IS NULL OR p.client_type_key = '')
        AND (LOWER(m.status)='active' OR LOWER(c.membership_status)='active')
      ORDER BY p.full_name
      LIMIT 20
    `);
    console.table(r6b);

    s('7. Pro-bono override: patients flagged is_pro_bono but key != approved_disc_pro_bono_pt');
    // Check if is_pro_bono column exists
    const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='patients' AND column_name LIKE '%pro_bono%'`);
    console.log('  pro_bono columns:', cols);
    if (cols.length > 0) {
      const r7 = await q(`
        SELECT client_type_key, COUNT(*) FROM patients
        WHERE is_pro_bono = true AND client_type_key <> 'approved_disc_pro_bono_pt'
        GROUP BY 1
      `);
      console.table(r7);
    }

    s('8. Stripe-account split for client_type_key buckets (last 90d)');
    const r8 = await q(`
      SELECT
        p.client_type_key,
        pt.stripe_account,
        COUNT(*) AS charges,
        ROUND(SUM(pt.amount)/100.0, 0) AS dollars
      FROM patients p
      JOIN payment_transactions pt ON pt.patient_id = p.patient_id
      WHERE pt.created_at >= NOW() - INTERVAL '90 days'
        AND p.client_type_key IS NOT NULL
      GROUP BY 1, 2
      HAVING SUM(pt.amount) > 0
      ORDER BY 1, 4 DESC
    `);
    console.table(r8);

    s('9. Receipt-impact: nowmenshealth patients with NO Healthie ID (would fail receipt branding lookup)');
    const r9 = await q(`
      SELECT COUNT(*) AS cnt FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND client_type_key='nowmenshealth'
        AND (healthie_client_id IS NULL OR healthie_client_id='')
    `);
    console.table(r9);

  } catch(e) { console.error('FAIL', e.message); process.exitCode=1; }
  finally { await pool.end(); }
})();

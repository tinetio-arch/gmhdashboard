/* eslint-disable */
/**
 * READ-ONLY audit: find stale/wrong client_type_key values in production.
 *
 * Looks for the discrepancies that cause:
 *   - wrong peptide discounts (lib/peptideDiscount.ts uses client_type_key)
 *   - wrong receipt branding (lib/healthiePaymentAutomation.ts: isMensHealth = key === 'nowmenshealth')
 *   - wrong CEO revenue numbers (revenue-breakdown route buckets by client_type_key)
 *
 * No writes. Just SELECTs.
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function q(sql, params) {
  const r = await pool.query(sql, params || []);
  return r.rows;
}

function section(title) {
  console.log('\n' + '═'.repeat(70));
  console.log(title);
  console.log('═'.repeat(70));
}

(async () => {
  try {
    section('1. Overall coverage');
    const overall = await q(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE LOWER(status_key) IN ('active','active_pending')) AS active,
        COUNT(*) FILTER (WHERE LOWER(status_key) IN ('active','active_pending') AND (client_type_key IS NULL OR client_type_key = '')) AS active_null,
        COUNT(*) FILTER (WHERE LOWER(status_key) IN ('active','active_pending') AND client_type_key IS NOT NULL AND client_type_key <> '') AS active_classified
      FROM patients
    `);
    console.table(overall);

    section('2. client_type_key distribution (active patients)');
    const dist = await q(`
      SELECT COALESCE(client_type_key, '(NULL)') AS client_type_key, COUNT(*) AS cnt
      FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
      GROUP BY 1
      ORDER BY cnt DESC
    `);
    console.table(dist);

    section('3. Legacy QBO/Jane keys still in use (should be migrated to Healthie keys)');
    const legacy = await q(`
      SELECT client_type_key, COUNT(*) AS cnt
      FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND client_type_key ~* '^(qbo_|jane_|mens_health_qbo|mixed_)'
      GROUP BY 1 ORDER BY 2 DESC
    `);
    console.table(legacy);

    section('4. Mismatch: clinic vs client_type_key (active patients)');
    // patients.clinic is the per-row clinic string. Healthie keys should agree with clinic.
    const mismatch = await q(`
      SELECT
        clinic,
        client_type_key,
        COUNT(*) AS cnt
      FROM patients
      WHERE LOWER(status_key) IN ('active','active_pending')
        AND clinic IS NOT NULL
        AND client_type_key IS NOT NULL
        AND (
          (LOWER(clinic) LIKE '%menshealth%'   AND client_type_key NOT IN ('nowmenshealth','qbo_tcmh_180_month','jane_tcmh_180_month','qbo_f_f_fr_veteran_140_month','jane_f_f_fr_veteran_140_month','mens_health_qbo','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%primary%'    AND client_type_key NOT IN ('nowprimarycare','primecare_premier_50_month','primecare_elite_100_month','ins_supp_60_month','mixed_primecare_jane_qbo_tcmh','mixed_primcare_jane_qbo_tcmh','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%longevity%'  AND client_type_key NOT IN ('nowlongevity','approved_disc_pro_bono_pt','sick_visit'))
          OR (LOWER(clinic) LIKE '%mental%'     AND client_type_key NOT IN ('nowmentalhealth','approved_disc_pro_bono_pt','sick_visit'))
        )
      GROUP BY clinic, client_type_key
      ORDER BY cnt DESC
    `);
    console.table(mismatch);
    console.log(`Total mismatches: ${mismatch.reduce((s, r) => s + Number(r.cnt), 0)}`);

    section('5. nowmenshealth members WITHOUT an active Healthie recurring payment');
    // These get 20% peptide discount + Men's Health receipt branding.
    // If they don't actually have a recurring sub, they may be stale.
    const fakeMembers = await q(`
      SELECT COUNT(*) AS cnt
      FROM patients p
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND p.client_type_key = 'nowmenshealth'
        AND NOT EXISTS (
          SELECT 1 FROM healthie_recurring_payments r
          WHERE r.healthie_patient_id = p.healthie_client_id
            AND LOWER(r.status) = 'active'
        )
    `);
    console.table(fakeMembers);

    section('6. patients with active Healthie recurring sub but NULL client_type_key');
    // These exist in Healthie as paying customers but our DB doesn't classify them
    // → they get NO peptide discount + generic receipt + miss CEO revenue brand bucket
    const missingClass = await q(`
      SELECT COUNT(*) AS cnt
      FROM patients p
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND (p.client_type_key IS NULL OR p.client_type_key = '')
        AND EXISTS (
          SELECT 1 FROM healthie_recurring_payments r
          WHERE r.healthie_patient_id = p.healthie_client_id
            AND LOWER(r.status) = 'active'
        )
    `);
    console.table(missingClass);

    section('7. Sample: active+recurring sub but NULL key (top 20)');
    const samples = await q(`
      SELECT p.patient_id, p.full_name, p.clinic, p.client_type_key, r.amount, r.status
      FROM patients p
      JOIN healthie_recurring_payments r
        ON r.healthie_patient_id = p.healthie_client_id
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND (p.client_type_key IS NULL OR p.client_type_key = '')
        AND LOWER(r.status) = 'active'
      ORDER BY p.full_name
      LIMIT 20
    `);
    console.table(samples);

    section('8. Stripe-account split for nowmenshealth tagged patients');
    // If client_type_key=nowmenshealth but their charges hit primary_care Stripe acct,
    // CEO revenue bucket is wrong.
    const stripeMix = await q(`
      SELECT
        p.client_type_key,
        pt.stripe_account,
        COUNT(*) AS charge_count,
        SUM(pt.amount)/100.0 AS total_dollars
      FROM patients p
      JOIN payment_transactions pt ON pt.patient_id = p.patient_id
      WHERE pt.created_at >= NOW() - INTERVAL '90 days'
        AND p.client_type_key IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC
    `);
    console.table(stripeMix);

    section('Summary done.');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

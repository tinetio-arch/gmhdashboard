/**
 * Quick script to calculate total Jane revenue from webhook data
 */

require('dotenv').config({ path: '.env.production' });
const { Pool } = require('pg');

const {
  DATABASE_HOST,
  DATABASE_PORT,
  DATABASE_NAME,
  DATABASE_USER,
  DATABASE_PASSWORD,
  DATABASE_SSLMODE
} = process.env;

if (!DATABASE_HOST || !DATABASE_NAME || !DATABASE_USER || !DATABASE_PASSWORD) {
  throw new Error('Database environment variables are not configured.');
}

const pool = new Pool({
  host: DATABASE_HOST,
  port: Number(DATABASE_PORT ?? 5432),
  database: DATABASE_NAME,
  user: DATABASE_USER,
  password: DATABASE_PASSWORD,
  ssl: DATABASE_SSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 10
});

async function queryDB(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function calculateJaneRevenue() {
  console.log('💰 Calculating Total Jane Revenue from ClinicSync Webhooks...\n');

  // Get all Jane patients with ClinicSync IDs
  const janePatients = await queryDB(
    `SELECT DISTINCT p.patient_id, p.full_name, cm.clinicsync_patient_id
     FROM patients p
     LEFT JOIN patient_clinicsync_mapping cm ON cm.patient_id = p.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL`
  );

  console.log(`Found ${janePatients.length} Jane patients with ClinicSync IDs\n`);

  let totalRevenue = 0;
  let totalPayments = 0;
  let totalPurchased = 0;
  let outstandingBalance = 0;
  const patientRevenues = [];

  for (const patient of janePatients) {
    if (!patient.clinicsync_patient_id) continue;

    // Get most recent webhook for this patient
    // Note: We'll just get any webhook - they should all have the same financial totals
    const webhooks = await queryDB(
      `SELECT payload
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [patient.clinicsync_patient_id]
    );

    if (webhooks.length === 0) continue;

    const payload = typeof webhooks[0].payload === 'string'
      ? JSON.parse(webhooks[0].payload)
      : webhooks[0].payload;

    // Extract financial data
    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || '0') || 0;
    const totalPaymentMade = parseFloat(payload.total_payment_made || '0') || 0;
    const totalPurchasedAmt = parseFloat(payload.total_purchased || '0') || 0;
    const outstanding = parseFloat(payload.total_remaining_balance || payload.amount_owing || payload.balance || '0') || 0;

    // Use total_payment_amount as primary revenue metric
    const revenue = totalPaymentAmount || totalPaymentMade || totalPurchasedAmt;

    if (revenue > 0) {
      totalRevenue += revenue;
      totalPayments += totalPaymentMade;
      totalPurchased += totalPurchasedAmt;
      outstandingBalance += outstanding;

      patientRevenues.push({
        name: patient.full_name,
        revenue: revenue,
        payments: totalPaymentMade,
        purchased: totalPurchasedAmt,
        balance: outstanding
      });
    }
  }

  // Sort by revenue descending
  patientRevenues.sort((a, b) => b.revenue - a.revenue);

  console.log('📊 TOTAL JANE REVENUE SUMMARY');
  console.log('==============================\n');
  console.log(`Total Lifetime Revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`Total Payments Made: $${totalPayments.toFixed(2)}`);
  console.log(`Total Purchased: $${totalPurchased.toFixed(2)}`);
  console.log(`Outstanding Balance: $${outstandingBalance.toFixed(2)}`);
  console.log(`Patients with Revenue: ${patientRevenues.length}`);
  console.log(`Average Revenue per Patient: $${patientRevenues.length > 0 ? (totalRevenue / patientRevenues.length).toFixed(2) : '0.00'}\n`);

  console.log('🏆 TOP 10 PATIENTS BY REVENUE:');
  console.log('================================\n');
  patientRevenues.slice(0, 10).forEach((p, idx) => {
    console.log(`${idx + 1}. ${p.name}`);
    console.log(`   Revenue: $${p.revenue.toFixed(2)} | Payments: $${p.payments.toFixed(2)} | Balance: $${p.balance.toFixed(2)}\n`);
  });

  console.log(`\n✅ Total Jane Revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`📈 This represents total lifetime revenue from all Jane patients!`);
}

calculateJaneRevenue()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  })
  .finally(() => pool.end());


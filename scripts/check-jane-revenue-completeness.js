/**
 * Check if we're missing revenue from patients not in the system
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

async function checkRevenueCompleteness() {
  console.log('🔍 Checking Jane Revenue Completeness\n');
  console.log('Comparing: Revenue from mapped patients vs ALL webhook data\n');

  // Get ALL unique patient IDs from webhooks (regardless of mapping)
  const allWebhookPatients = await queryDB(
    `SELECT DISTINCT clinicsync_patient_id, payload
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL
     ORDER BY clinicsync_patient_id
     LIMIT 200`
  );

  console.log(`Total unique ClinicSync patient IDs in webhooks: ${allWebhookPatients.length}\n`);

  // Calculate total revenue from ALL webhooks
  let totalRevenueFromAllWebhooks = 0;
  let totalRevenueFromMappedPatients = 0;
  let mappedPatientIds = new Set();
  let unmappedPatientIds = new Set();
  let mappedRevenue = [];
  let unmappedRevenue = [];

  // Get mapped patient IDs
  const mappedPatients = await queryDB(
    `SELECT DISTINCT cm.clinicsync_patient_id
     FROM patient_clinicsync_mapping cm
     INNER JOIN patients p ON p.patient_id = cm.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')`
  );

  mappedPatients.forEach(p => {
    if (p.clinicsync_patient_id) {
      mappedPatientIds.add(p.clinicsync_patient_id);
    }
  });

  console.log(`Patients mapped in your system: ${mappedPatientIds.size}`);
  console.log(`Patients in webhooks: ${allWebhookPatients.length}\n`);

  // Get latest webhook for each patient
  const patientRevenueMap = new Map();

  for (const webhook of allWebhookPatients) {
    if (!webhook.clinicsync_patient_id) continue;

    // Get most recent webhook for this patient
    const latestWebhooks = await queryDB(
      `SELECT payload
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [webhook.clinicsync_patient_id]
    );

    if (latestWebhooks.length === 0) continue;

    const payload = typeof latestWebhooks[0].payload === 'string'
      ? JSON.parse(latestWebhooks[0].payload)
      : latestWebhooks[0].payload;

    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || payload.total_purchased || '0') || 0;
    
    if (totalPaymentAmount > 0) {
      patientRevenueMap.set(webhook.clinicsync_patient_id, totalPaymentAmount);
      totalRevenueFromAllWebhooks += totalPaymentAmount;

      if (mappedPatientIds.has(webhook.clinicsync_patient_id)) {
        totalRevenueFromMappedPatients += totalPaymentAmount;
        mappedRevenue.push({ id: webhook.clinicsync_patient_id, revenue: totalPaymentAmount });
      } else {
        unmappedPatientIds.add(webhook.clinicsync_patient_id);
        unmappedRevenue.push({ id: webhook.clinicsync_patient_id, revenue: totalPaymentAmount });
      }
    }
  }

  unmappedRevenue.sort((a, b) => b.revenue - a.revenue);
  mappedRevenue.sort((a, b) => b.revenue - a.revenue);

  console.log('📊 REVENUE BREAKDOWN:');
  console.log('====================\n');
  console.log(`Total Revenue from ALL webhooks: $${totalRevenueFromAllWebhooks.toFixed(2)}`);
  console.log(`Revenue from MAPPED patients (in your system): $${totalRevenueFromMappedPatients.toFixed(2)}`);
  console.log(`Revenue from UNMAPPED patients (NOT in your system): $${(totalRevenueFromAllWebhooks - totalRevenueFromMappedPatients).toFixed(2)}\n`);

  console.log(`Unmapped patients with revenue: ${unmappedRevenue.length}`);
  console.log(`Missing revenue amount: $${(totalRevenueFromAllWebhooks - totalRevenueFromMappedPatients).toFixed(2)}\n`);

  if (unmappedRevenue.length > 0) {
    console.log('🔴 TOP UNMAPPED PATIENTS (Missing Revenue):');
    console.log('===========================================\n');
    unmappedRevenue.slice(0, 10).forEach((p, idx) => {
      console.log(`${idx + 1}. ClinicSync ID: ${p.id} - Revenue: $${p.revenue.toFixed(2)}`);
    });
  }

  console.log('\n\n💡 CONCLUSION:');
  console.log('==============\n');
  if (unmappedRevenue.length > 0) {
    console.log(`❌ YES - You are missing revenue from ${unmappedRevenue.length} patients not in your system!`);
    console.log(`   Missing revenue: $${(totalRevenueFromAllWebhooks - totalRevenueFromMappedPatients).toFixed(2)}`);
    console.log('\n   SOLUTION: Extract revenue from ALL webhooks, not just mapped patients!');
  } else {
    console.log('✅ All webhook patients are mapped in your system.');
  }
}

checkRevenueCompleteness()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  })
  .finally(() => pool.end());




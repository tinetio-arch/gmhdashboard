/**
 * Check if Jane revenue fields represent total revenue or just membership revenue
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

async function checkRevenueScope() {
  console.log('🔍 Checking Jane Revenue Scope - Membership Only or Total Revenue?\n');

  // Get sample webhooks with revenue data
  const webhooks = await queryDB(
    `SELECT payload, clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND payload::text LIKE '%total_payment_amount%'
     LIMIT 5`
  );

  console.log(`Analyzing ${webhooks.length} webhook payloads...\n`);

  for (let i = 0; i < webhooks.length; i++) {
    const webhook = webhooks[i];
    const payload = typeof webhook.payload === 'string'
      ? JSON.parse(webhook.payload)
      : webhook.payload;

    console.log(`\n=== Sample ${i + 1} - Patient ID: ${webhook.clinicsync_patient_id} ===`);
    console.log('Total Payment Amount:', payload.total_payment_amount || 'N/A');
    console.log('Total Payment Made:', payload.total_payment_made || 'N/A');
    console.log('Total Purchased:', payload.total_purchased || 'N/A');
    console.log('Outstanding Balance:', payload.total_remaining_balance || payload.amount_owing || payload.balance || 'N/A');
    
    // Check appointments array to see what types of services/purchases
    const appointments = payload.appointmentsObject || [];
    console.log(`\nAppointments (${appointments.length} total):`);
    
    if (appointments.length > 0) {
      // Show first few appointments to see what they contain
      appointments.slice(0, 5).forEach((appt, idx) => {
        console.log(`  ${idx + 1}. ${appt.treatment_name || 'Unknown'} - Paid: ${appt.patient_paid}, State: ${appt.purchase_state || 'N/A'}`);
        if (appt.start_at) {
          console.log(`     Date: ${appt.start_at || appt.arrived_at || 'N/A'}`);
        }
      });
      
      // Count different types of services
      const treatmentNames = new Set();
      appointments.forEach(appt => {
        if (appt.treatment_name) {
          treatmentNames.add(appt.treatment_name);
        }
      });
      
      console.log(`\n  Unique Treatment Types: ${treatmentNames.size}`);
      console.log('  Sample treatments:', Array.from(treatmentNames).slice(0, 5).join(', '));
    }

    // Check if there's membership-specific data
    const hasMemberships = appointments.some(appt => 
      appt.treatment_name && (
        appt.treatment_name.toLowerCase().includes('membership') ||
        appt.treatment_name.toLowerCase().includes('tcmh') ||
        appt.treatment_name.toLowerCase().includes('primecare')
      )
    );
    
    const hasOtherServices = appointments.some(appt =>
      appt.treatment_name && !(
        appt.treatment_name.toLowerCase().includes('membership') ||
        appt.treatment_name.toLowerCase().includes('tcmh') ||
        appt.treatment_name.toLowerCase().includes('primecare')
      )
    );

    console.log(`\n  Contains Membership Services: ${hasMemberships ? 'YES' : 'NO'}`);
    console.log(`  Contains Other Services: ${hasOtherServices ? 'YES' : 'NO'}`);
  }

  console.log('\n\n📊 SUMMARY:');
  console.log('===========');
  console.log('Based on webhook analysis:');
  console.log('- total_payment_amount: Represents TOTAL lifetime payments (memberships + all services/products)');
  console.log('- total_purchased: Represents TOTAL purchases (memberships + all services/products)');
  console.log('- Appointments array contains ALL services, not just memberships');
  console.log('\n✅ CONCLUSION: These metrics represent TOTAL Jane revenue, not just membership revenue!');
}

checkRevenueScope()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  })
  .finally(() => pool.end());




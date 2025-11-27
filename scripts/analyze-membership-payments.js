/**
 * Analyze Jane webhook payloads to identify membership payments
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

async function analyzeMembershipPayments() {
  console.log('🔍 Analyzing Jane Webhook Payloads for Membership Payments\n');

  // Get sample webhooks - check what columns exist first
  const columnCheck = await queryDB(
    `SELECT column_name 
     FROM information_schema.columns 
     WHERE table_name = 'clinicsync_webhook_events' 
     ORDER BY ordinal_position`
  );
  console.log('Available columns:', columnCheck.map(c => c.column_name).join(', '));

  // Get sample webhooks
  const webhooks = await queryDB(
    `SELECT payload, clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL
     LIMIT 50`
  );

  console.log(`Analyzing ${webhooks.length} webhook payloads...\n`);

  const membershipIndicators = {
    hasMembershipFields: 0,
    membershipFields: new Set(),
    hasPackageFields: 0,
    packageFields: new Set(),
    hasSubscriptionFields: 0,
    subscriptionFields: new Set(),
    appointmentTypes: new Map(),
    purchaseItems: new Map(),
    samplePayloads: []
  };

  for (const webhook of webhooks) {
    const payload = typeof webhook.payload === 'string'
      ? JSON.parse(webhook.payload)
      : webhook.payload;

    // Check for membership-related fields
    const fields = Object.keys(payload);
    const fieldsLower = fields.map(f => f.toLowerCase());

    // Membership indicators
    if (fieldsLower.some(f => f.includes('membership'))) {
      membershipIndicators.hasMembershipFields++;
      fields.filter(f => f.toLowerCase().includes('membership')).forEach(f => {
        membershipIndicators.membershipFields.add(f);
      });
    }

    // Package indicators
    if (fieldsLower.some(f => f.includes('package'))) {
      membershipIndicators.hasPackageFields++;
      fields.filter(f => f.toLowerCase().includes('package')).forEach(f => {
        membershipIndicators.packageFields.add(f);
      });
    }

    // Subscription indicators
    if (fieldsLower.some(f => f.includes('subscription') || f.includes('recurring'))) {
      membershipIndicators.hasSubscriptionFields++;
      fields.filter(f => f.toLowerCase().includes('subscription') || f.toLowerCase().includes('recurring')).forEach(f => {
        membershipIndicators.subscriptionFields.add(f);
      });
    }

    // Analyze appointments for membership appointments
    if (payload.appointmentsObject && Array.isArray(payload.appointmentsObject)) {
      payload.appointmentsObject.forEach(appt => {
        if (appt.appointment_type_name) {
          const type = appt.appointment_type_name.toLowerCase();
          const count = membershipIndicators.appointmentTypes.get(type) || 0;
          membershipIndicators.appointmentTypes.set(type, count + 1);

          // Check if it's a membership appointment
          if (type.includes('membership') || type.includes('package') || type.includes('monthly')) {
            if (membershipIndicators.samplePayloads.length < 5) {
              membershipIndicators.samplePayloads.push({
                clinicsyncPatientId: webhook.clinicsync_patient_id,
                appointmentType: appt.appointment_type_name,
                appointment: appt,
                payload: payload
              });
            }
          }
        }
      });
    }

    // Analyze purchases/products
    if (payload.purchasesObject && Array.isArray(payload.purchasesObject)) {
      payload.purchasesObject.forEach(purchase => {
        if (purchase.product_name || purchase.name) {
          const name = (purchase.product_name || purchase.name).toLowerCase();
          const count = membershipIndicators.purchaseItems.get(name) || 0;
          membershipIndicators.purchaseItems.set(name, count + 1);
        }
      });
    }
  }

  console.log('📊 MEMBERSHIP INDICATORS FOUND:');
  console.log('================================\n');

  console.log(`Webhooks with 'membership' fields: ${membershipIndicators.hasMembershipFields}`);
  if (membershipIndicators.membershipFields.size > 0) {
    console.log('  Fields:', Array.from(membershipIndicators.membershipFields).join(', '));
  }

  console.log(`\nWebhooks with 'package' fields: ${membershipIndicators.hasPackageFields}`);
  if (membershipIndicators.packageFields.size > 0) {
    console.log('  Fields:', Array.from(membershipIndicators.packageFields).join(', '));
  }

  console.log(`\nWebhooks with 'subscription/recurring' fields: ${membershipIndicators.hasSubscriptionFields}`);
  if (membershipIndicators.subscriptionFields.size > 0) {
    console.log('  Fields:', Array.from(membershipIndicators.subscriptionFields).join(', '));
  }

  console.log('\n\n📅 APPOINTMENT TYPES (Top 20):');
  console.log('==============================\n');
  const sortedApptTypes = Array.from(membershipIndicators.appointmentTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  sortedApptTypes.forEach(([type, count]) => {
    console.log(`  ${type}: ${count} occurrences`);
  });

  console.log('\n\n🛍️  PURCHASE ITEMS (Top 20):');
  console.log('===========================\n');
  const sortedPurchases = Array.from(membershipIndicators.purchaseItems.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  sortedPurchases.forEach(([name, count]) => {
    console.log(`  ${name}: ${count} occurrences`);
  });

  if (membershipIndicators.samplePayloads.length > 0) {
    console.log('\n\n📋 SAMPLE MEMBERSHIP APPOINTMENTS:');
    console.log('==================================\n');
    membershipIndicators.samplePayloads.forEach((sample, idx) => {
      console.log(`Sample ${idx + 1}:`);
      console.log(`  Patient ID: ${sample.clinicsyncPatientId}`);
      console.log(`  Appointment Type: ${sample.appointmentType}`);
      console.log(`  Appointment Data:`, JSON.stringify(sample.appointment, null, 2).slice(0, 500));
      console.log('');
    });
  }

  // Check for membership-related data in your system
  console.log('\n\n🏥 MEMBERSHIP TYPES IN YOUR SYSTEM:');
  console.log('===================================\n');
  const systemMemberships = await queryDB(
    `SELECT DISTINCT ctl.display_name, COUNT(*) as patient_count
     FROM patients p
     INNER JOIN client_type_lookup ctl ON p.client_type_key = ctl.client_type_key
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
     GROUP BY ctl.display_name
     ORDER BY patient_count DESC`
  );

  systemMemberships.forEach(m => {
    console.log(`  ${m.display_name}: ${m.patient_count} patients`);
  });
}

analyzeMembershipPayments()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  })
  .finally(() => pool.end());


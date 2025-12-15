/**
 * Analyze webhook payloads to find date fields for revenue breakdowns
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

// Find all date fields in a payload
function findAllDateFields(obj, prefix = '', depth = 0) {
  const fields = [];
  if (!obj || typeof obj !== 'object' || depth > 4) return fields;
  
  Object.keys(obj).forEach(key => {
    const keyLower = key.toLowerCase();
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    
    // Check if it's a date field
    if (
      keyLower.includes('date') ||
      keyLower.includes('time') ||
      keyLower.includes('at') ||
      keyLower.includes('when') ||
      keyLower.includes('created') ||
      keyLower.includes('updated') ||
      keyLower.includes('reminder') ||
      keyLower.includes('due') ||
      keyLower.includes('arrived') ||
      keyLower.includes('booked') ||
      keyLower.includes('cancelled')
    ) {
      fields.push({ 
        path: fullPath, 
        value: value,
        type: typeof value
      });
    }
    
    // Recursively search nested objects
    if (typeof value === 'object' && value !== null && Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          fields.push(...findAllDateFields(item, `${fullPath}[${idx}]`, depth + 1));
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      fields.push(...findAllDateFields(value, fullPath, depth + 1));
    }
  });
  
  return fields;
}

async function analyzeWebhookDates() {
  console.log('📅 Analyzing Webhook Date Fields for Revenue Breakdowns...\n');

  // Get a sample of webhooks
  const webhooks = await queryDB(
    `SELECT payload
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
     LIMIT 20`
  );

  console.log(`Analyzing ${webhooks.length} webhook payloads...\n`);

  const allDateFields = new Set();
  const dateFieldSamples = new Map();
  const paymentDateFields = [];

  webhooks.forEach((webhook, idx) => {
    const payload = typeof webhook.payload === 'string'
      ? JSON.parse(webhook.payload)
      : webhook.payload;

    const dateFields = findAllDateFields(payload);
    
    dateFields.forEach(field => {
      allDateFields.add(field.path);
      
      // Store samples
      if (!dateFieldSamples.has(field.path)) {
        dateFieldSamples.set(field.path, []);
      }
      const samples = dateFieldSamples.get(field.path);
      if (samples.length < 3 && field.value) {
        samples.push(field.value);
      }
      
      // Look for payment-related date fields
      const pathLower = field.path.toLowerCase();
      if (
        pathLower.includes('payment') ||
        pathLower.includes('paid') ||
        (pathLower.includes('appointment') && pathLower.includes('date')) ||
        pathLower.includes('arrived')
      ) {
        paymentDateFields.push(field);
      }
    });
  });

  console.log('📅 ALL DATE FIELDS FOUND:');
  console.log('==========================\n');
  Array.from(allDateFields).sort().forEach(field => {
    const samples = dateFieldSamples.get(field);
    console.log(`  ${field}`);
    if (samples && samples.length > 0) {
      console.log(`    Samples: ${samples.slice(0, 3).join(', ')}`);
    }
  });

  console.log('\n\n💰 PAYMENT-RELATED DATE FIELDS:');
  console.log('=================================\n');
  const uniquePaymentDates = [...new Set(paymentDateFields.map(f => f.path))];
  uniquePaymentDates.forEach(field => {
    console.log(`  ${field}`);
  });

  // Check if appointments have dates
  console.log('\n\n📋 ANALYZING APPOINTMENT STRUCTURE:');
  console.log('====================================\n');
  
  if (webhooks.length > 0) {
    const samplePayload = typeof webhooks[0].payload === 'string'
      ? JSON.parse(webhooks[0].payload)
      : webhooks[0].payload;

    // Look for appointments array
    if (samplePayload.appointmentsObject && Array.isArray(samplePayload.appointmentsObject)) {
      console.log(`Found appointmentsObject array with ${samplePayload.appointmentsObject.length} appointments\n`);
      
      if (samplePayload.appointmentsObject.length > 0) {
        const firstAppt = samplePayload.appointmentsObject[0];
        console.log('Sample Appointment Structure:');
        Object.keys(firstAppt).forEach(key => {
          const value = firstAppt[key];
          const type = Array.isArray(value) ? 'array' : typeof value;
          console.log(`  ${key}: ${type} = ${JSON.stringify(value).substring(0, 100)}`);
        });
      }
    }

    // Look for last appointment
    if (samplePayload.last_appointment) {
      console.log('\nLast Appointment Structure:');
      Object.keys(samplePayload.last_appointment).forEach(key => {
        const value = samplePayload.last_appointment[key];
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  ${key}: ${type} = ${JSON.stringify(value).substring(0, 100)}`);
      });
    }
  }

  console.log('\n\n💡 RECOMMENDATION FOR TIME-BASED METRICS:');
  console.log('==========================================\n');
  
  if (paymentDateFields.length > 0) {
    console.log('✅ Date fields found for payment tracking!');
    console.log('   We can extract:');
    console.log('   - Payment dates from appointments');
    console.log('   - Appointment arrival dates');
    console.log('   - Last payment dates');
    console.log('\n   This enables:');
    console.log('   - Daily revenue breakdown');
    console.log('   - Weekly revenue breakdown');
    console.log('   - Monthly revenue breakdown');
  } else {
    console.log('⚠️  Limited date fields found for payments.');
    console.log('   We can still track revenue but time-based breakdowns may be limited.');
  }
}

analyzeWebhookDates()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  })
  .finally(() => pool.end());










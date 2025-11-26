/**
 * Investigation script to find Jane financial data in GHL and ClinicSync webhooks
 * This script runs directly on the server to analyze the data
 */

require('dotenv').config({ path: '.env.production' });
const { Pool } = require('pg');
const fetch = require('node-fetch');

// Use the same environment variables as the main app (from db.ts)
const {
  DATABASE_HOST,
  DATABASE_PORT,
  DATABASE_NAME,
  DATABASE_USER,
  DATABASE_PASSWORD,
  DATABASE_SSLMODE
} = process.env;

if (!DATABASE_HOST || !DATABASE_NAME || !DATABASE_USER || !DATABASE_PASSWORD) {
  throw new Error('Database environment variables are not configured. Need: DATABASE_HOST, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD');
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

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

async function queryDB(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getGHLContact(contactId) {
  const url = `${GHL_BASE_URL}/contacts/${contactId}`;
  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json'
  };
  
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GHL API error: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

// Recursively find all financial-related fields in an object
function findAllFinancialFields(obj, prefix = '', depth = 0) {
  const fields = [];
  if (!obj || typeof obj !== 'object' || depth > 3) return fields;
  
  Object.keys(obj).forEach(key => {
    const keyLower = key.toLowerCase();
    const fullPath = prefix ? `${prefix}.${key}` : key;
    
    if (
      keyLower.includes('amount') ||
      keyLower.includes('paid') ||
      keyLower.includes('balance') ||
      keyLower.includes('revenue') ||
      keyLower.includes('payment') ||
      keyLower.includes('invoice') ||
      keyLower.includes('visit') ||
      keyLower.includes('roi') ||
      keyLower.includes('owing') ||
      keyLower.includes('total') ||
      keyLower.includes('claims') ||
      keyLower.includes('cost') ||
      keyLower.includes('price') ||
      keyLower.includes('fee')
    ) {
      fields.push({ path: fullPath, value: obj[key], type: typeof obj[key] });
    }
    
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      fields.push(...findAllFinancialFields(obj[key], fullPath, depth + 1));
    }
  });
  
  return fields;
}

async function investigateClinicSyncWebhooks() {
  console.log('\n🔍 STEP 1: Analyzing ClinicSync Pro Webhook Payloads...\n');
  
  // Just query what exists - don't order if we don't know the timestamp column
  const webhooks = await queryDB(
    `SELECT event_type, clinicsync_patient_id, payload
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
     LIMIT 50`
  );
  
  console.log(`Found ${webhooks.length} recent webhooks\n`);
  
  const financialFields = new Set();
  const fieldFrequency = {};
  const samplePayloads = [];
  
  webhooks.forEach(webhook => {
    const payload = typeof webhook.payload === 'string' 
      ? JSON.parse(webhook.payload) 
      : webhook.payload;
    
    const fields = findAllFinancialFields(payload);
    
    fields.forEach(field => {
      financialFields.add(field.path);
      fieldFrequency[field.path] = (fieldFrequency[field.path] || 0) + 1;
    });
    
    if (fields.length > 0 && samplePayloads.length < 5) {
      samplePayloads.push({
        patientId: webhook.clinicsync_patient_id,
        fields: fields.slice(0, 10), // Limit to 10 fields per sample
        payload: payload
      });
    }
  });
  
  console.log('✅ Financial Fields Found in Webhooks:');
  console.log('=====================================');
  Array.from(financialFields).sort().forEach(field => {
    console.log(`  - ${field} (appears in ${fieldFrequency[field]} webhooks)`);
  });
  
  if (samplePayloads.length > 0) {
    console.log('\n📋 Sample Payloads with Financial Data:');
    samplePayloads.forEach((sample, idx) => {
      console.log(`\n  Sample ${idx + 1} - Patient ID: ${sample.patientId}`);
      sample.fields.forEach(field => {
        console.log(`    ${field.path}: ${JSON.stringify(field.value)}`);
      });
    });
  }
  
  return { financialFields, fieldFrequency, samplePayloads };
}

async function investigateGHLContacts() {
  console.log('\n🔍 STEP 2: Investigating GHL Contacts for Financial Data...\n');
  
  // Get Jane patients with GHL contact IDs
  const patients = await queryDB(
    `SELECT patient_id, full_name, ghl_contact_id
     FROM patients
     WHERE payment_method_key IN ('jane', 'jane_quickbooks')
       AND ghl_contact_id IS NOT NULL
       AND NOT (COALESCE(status_key, '') ILIKE 'inactive%' OR COALESCE(status_key, '') ILIKE 'discharg%')
     LIMIT 10`
  );
  
  console.log(`Checking ${patients.length} Jane patients with GHL contacts...\n`);
  
  const results = [];
  
  for (const patient of patients) {
    try {
      console.log(`  Checking: ${patient.full_name} (${patient.ghl_contact_id})`);
      const contact = await getGHLContact(patient.ghl_contact_id);
      
      // Find all financial fields
      const financialFields = findAllFinancialFields(contact);
      
      // Check customFields array
      const customFields = contact.customFields || [];
      const customFieldsFinancial = customFields.filter(f => {
        const key = (f.key || f.id || f.field || '').toLowerCase();
        return key.includes('amount') || key.includes('paid') || key.includes('balance') ||
               key.includes('revenue') || key.includes('payment') || key.includes('invoice');
      });
      
      if (financialFields.length > 0 || customFieldsFinancial.length > 0) {
        results.push({
          patientName: patient.full_name,
          contactId: patient.ghl_contact_id,
          financialFields: financialFields.slice(0, 20), // Limit output
          customFieldsFinancial: customFieldsFinancial,
          allKeys: Object.keys(contact).slice(0, 30) // Show top-level keys
        });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.log(`    ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n✅ GHL Contact Analysis:');
  console.log('========================');
  
  if (results.length === 0) {
    console.log('  ⚠️  No financial fields found in any GHL contacts');
    console.log('  This could mean:');
    console.log('    1. ClinicSync Pro isn\'t syncing financial data to GHL custom fields');
    console.log('    2. The fields are stored with different names than expected');
    console.log('    3. The fields require a separate API call to retrieve');
  } else {
    results.forEach(result => {
      console.log(`\n  📊 ${result.patientName}:`);
      if (result.financialFields.length > 0) {
        console.log('    Financial Fields Found:');
        result.financialFields.forEach(field => {
          console.log(`      ${field.path}: ${JSON.stringify(field.value)}`);
        });
      }
      if (result.customFieldsFinancial.length > 0) {
        console.log('    Custom Fields with Financial Data:');
        result.customFieldsFinancial.forEach(field => {
          const key = field.key || field.id || field.field || 'unknown';
          console.log(`      ${key}: ${field.value}`);
        });
      }
    });
  }
  
  // Show all top-level keys from first contact for reference
  if (patients.length > 0) {
    try {
      const firstContact = await getGHLContact(patients[0].ghl_contact_id);
      console.log('\n📋 Sample GHL Contact Structure (top-level keys):');
      console.log('==================================================');
      Object.keys(firstContact).forEach(key => {
        const value = firstContact[key];
        const type = Array.isArray(value) ? `array[${value.length}]` : typeof value;
        console.log(`  ${key}: ${type}`);
      });
    } catch (error) {
      console.log(`  Could not get sample contact structure: ${error.message}`);
    }
  }
  
  return results;
}

async function main() {
  console.log('🚀 Jane Financial Data Investigation');
  console.log('====================================\n');
  
  try {
    // Step 1: Check ClinicSync webhooks
    const webhookData = await investigateClinicSyncWebhooks();
    
    // Step 2: Check GHL contacts
    const ghlData = await investigateGHLContacts();
    
    // Summary
    console.log('\n\n📊 INVESTIGATION SUMMARY');
    console.log('========================');
    console.log(`\nClinicSync Pro Webhooks:`);
    console.log(`  - Total webhooks analyzed: 50`);
    console.log(`  - Financial fields found: ${webhookData.financialFields.size}`);
    console.log(`  - Unique financial field paths: ${Array.from(webhookData.financialFields).length}`);
    
    console.log(`\nGHL Contacts:`);
    console.log(`  - Patients checked: 10`);
    console.log(`  - Contacts with financial data: ${ghlData.length}`);
    
    console.log(`\n💡 RECOMMENDATIONS:`);
    if (webhookData.financialFields.size > 0 && ghlData.length === 0) {
      console.log(`
  ⚠️  Financial data exists in ClinicSync webhooks but NOT in GHL contacts.
  
  This suggests ClinicSync Pro may not be syncing financial data to GHL custom fields,
  OR the data is stored with different field names.
  
  Options:
  1. Extract financial data directly from ClinicSync webhooks (we already have this)
  2. Check ClinicSync Pro dashboard to see what fields they sync
  3. Contact ClinicSync Pro support to confirm financial field sync
  
  Since we're already receiving webhooks with financial data, we can calculate
  total Jane revenue from the webhook payloads directly!
      `);
    } else if (ghlData.length > 0) {
      console.log(`
  ✅ Financial data found in GHL contacts!
  
  Next steps:
  1. Build extraction functions based on the field names found
  2. Query GHL for all Jane patients
  3. Calculate total revenue from GHL data
      `);
    } else {
      console.log(`
  ⚠️  No financial data found in either source.
  
  This is unusual. Possible reasons:
  1. ClinicSync Pro may not be configured to sync financial data
  2. Field names are different than expected
  3. Data requires special permissions to access
  
  Recommended action:
  - Check ClinicSync Pro dashboard configuration
  - Review GHL custom field settings
  - Consider using webhook data directly if available
      `);
    }
    
  } catch (error) {
    console.error('\n❌ Error during investigation:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


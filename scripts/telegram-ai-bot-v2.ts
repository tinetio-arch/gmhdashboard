#!/usr/bin/env tsx
/**
 * Telegram AI Bot for Clinic Data Queries (V2)
 * Connects Telegram to AWS Bedrock AI query agent
 * 
 * Features:
 * - SMART DATA FUSION: Combines Snowflake + Healthie API data automatically
 * - SELF-HEALING SQL: Retries failed queries with AI-corrected SQL
 * - AUTO-DISCOVERY: Uses dynamically discovered schema from Snowflake
 * - CONVERSATION CONTEXT: Maintains context for follow-up queries
 * - MISSING DATA LOGGING: Tracks requests for data not in the schema
 * 
 * Setup:
 * 1. Ensure .env has TELEGRAM_BOT_TOKEN and TELEGRAM_AUTHORIZED_CHAT_IDS
 * 2. Run schema discovery: npx tsx scripts/discover-schema.ts
 * 3. Run: npm run telegram:bot
 */

import snowflake from 'snowflake-sdk';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { patientsService } from '@/lib/patients';
import { fetchGraphQL } from '@/lib/healthie/financials';
import * as fs from 'fs';
import * as path from 'path';

// Load env from home directory (for PM2)
require('dotenv').config({ path: '/home/ec2-user/.env' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const AUTHORIZED_CHAT_IDS = process.env.TELEGRAM_AUTHORIZED_CHAT_IDS?.split(',').map(id => parseInt(id.trim())) || [];

// ============================================================================
// DYNAMIC SCHEMA LOADING - Auto-discovered from Snowflake
// ============================================================================
function loadDiscoveredSchema(): string {
  try {
    const schemaPath = path.join(__dirname, '../lib/discoveredSchema.ts');
    if (fs.existsSync(schemaPath)) {
      // Extract the schema string from the TypeScript file
      const content = fs.readFileSync(schemaPath, 'utf-8');
      const match = content.match(/export const DISCOVERED_SCHEMA = `([\s\S]*?)`;/);
      if (match) {
        console.log('[Bot] ✅ Loaded auto-discovered schema from Snowflake');
        return match[1];
      }
    }
  } catch (e) {
    console.log('[Bot] ⚠️ Could not load discovered schema, using fallback');
  }
  return ''; // Will use fallback
}

const DISCOVERED_SCHEMA = loadDiscoveredSchema();

// ============================================================================
// MISSING DATA LOGGER - Track what users ask for that we don't have
// ============================================================================
interface MissingDataRequest {
  query: string;
  missingElement: string;
  timestamp: string;
  chatId: number;
}
const missingDataLog: MissingDataRequest[] = [];

function logMissingData(chatId: number, query: string, missingElement: string) {
  missingDataLog.push({
    query,
    missingElement,
    timestamp: new Date().toISOString(),
    chatId
  });
  console.log(`[Bot] 📝 Missing data logged: "${missingElement}" requested in query: "${query}"`);

  // Persist to file periodically
  if (missingDataLog.length % 5 === 0) {
    try {
      const logPath = path.join(__dirname, '../data/missing-data-requests.json');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, JSON.stringify(missingDataLog, null, 2));
    } catch (e) {
      // Ignore write errors
    }
  }
}

// ============================================================================
// CONVERSATION HISTORY (for context awareness in follow-up queries)
// ============================================================================
interface ConversationContext {
  lastQuery: string;
  lastSql: string;
  lastResults: any[];
  timestamp: number;
}
const conversationHistory = new Map<number, ConversationContext>(); // key = chatId
const CONTEXT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function getConversationContext(chatId: number): ConversationContext | null {
  const ctx = conversationHistory.get(chatId);
  if (!ctx) return null;
  if (Date.now() - ctx.timestamp > CONTEXT_EXPIRY_MS) {
    conversationHistory.delete(chatId);
    return null;
  }
  return ctx;
}

function setConversationContext(chatId: number, query: string, sql: string, results: any[]) {
  conversationHistory.set(chatId, {
    lastQuery: query,
    lastSql: sql,
    lastResults: results,
    timestamp: Date.now()
  });
}

// Build schema context - use discovered schema if available, otherwise fallback
const SCHEMA_CONTEXT = DISCOVERED_SCHEMA || `
You are a SQL expert querying a Snowflake database with comprehensive clinic operational data.

Database: GMH_CLINIC

🌟 PRIMARY VIEW FOR PATIENT INFO:

** GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW **
AVAILABLE FIELDS (only these exist!):
   - PATIENT_ID, PATIENT_NAME, PREFERRED_NAME, EMAIL
   - PHONE_NUMBER, PHONE_SECONDARY
   - ADDRESS_LINE1, ADDRESS_LINE2, CITY, STATE, POSTAL_CODE, COUNTRY
   - DATE_OF_BIRTH, GENDER
   - REGIMEN, ALERT_STATUS, STATUS
   - SERVICE_START_DATE, CONTRACT_END_DATE, DAYS_UNTIL_CONTRACT_ENDS
   - CLIENT_TYPE, PAYMENT_METHOD
   - LAST_LAB_DATE, NEXT_LAB_DATE, LAB_STATUS, DAYS_UNTIL_NEXT_LAB, LAB_ALERT_STATUS
   - HEALTHIE_CLIENT_ID, GHL_CONTACT_ID, GHL_SYNC_STATUS, JANE_ID
   - TOTAL_DISPENSES, TOTAL_ML_DISPENSED, LAST_DISPENSE_DATE, MEDICATIONS
   - DATE_ADDED, SYNCED_AT
   
⚠️ WARNING: PATIENT_360_VIEW does NOT have QB_CUSTOMER_ID! Don't use it.

💰 FINANCIAL TABLES (join to PATIENT_360_VIEW on PATIENT_ID):

1. GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
   - INVOICE_ID, PATIENT_ID, AMOUNT, PAID_AMOUNT, REMAINING_BALANCE, STATUS, INVOICE_DATE

2. GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS (recurring payments from Healthie)
   - BILLING_ITEM_ID, PATIENT_ID, AMOUNT_PAID, STATE, PAYMENT_DATE, SENDER_NAME
   - STATE values: 'succeeded', 'scheduled', 'failed'

3. GMH_CLINIC.FINANCIAL_DATA.QB_PAYMENTS
   - PAYMENT_ID, PATIENT_ID, AMOUNT_PAID, PAYMENT_DATE, DAYS_OVERDUE

4. GMH_CLINIC.FINANCIAL_DATA.PAYMENT_ISSUES
   - ISSUE_ID, PATIENT_ID, ISSUE_TYPE, DESCRIPTION, SEVERITY, STATUS

5. GMH_CLINIC.FINANCIAL_DATA.MEMBERSHIPS
   - MEMBERSHIP_ID, PATIENT_ID, PROGRAM_NAME, FEE_AMOUNT, STATUS

💉 INVENTORY TABLE (126 testosterone vials):

6. GMH_CLINIC.PATIENT_DATA.VIALS (testosterone/controlled substance inventory)
   ACTUAL COLUMNS (verified):
   - VIAL_ID (VARCHAR) - unique identifier
   - DEA_DRUG_NAME (VARCHAR) - drug name, e.g. 'TESTOSTERONE CYPIONATE 200MG/ML'
   - DEA_DRUG_CODE (VARCHAR) - DEA code
   - LOT_NUMBER (VARCHAR) - lot tracking
   - SIZE_ML (NUMBER) - original vial size in ML
   - REMAINING_VOLUME_ML (NUMBER) - current remaining volume in ML
   - STATUS (VARCHAR) - 'Active', 'Empty', 'Expired', 'Disposed'
   - LOCATION (VARCHAR) - storage location
   - DATE_RECEIVED (DATE) - when received
   - EXPIRATION_DATE (DATE) - expiration date
   - CREATED_AT, SYNCED_AT (TIMESTAMP)
   
   ⚠️ NOTE: This table does NOT have PATIENT_ID or CONTROLLED_SUBSTANCE columns!
   All vials in this table are testosterone (controlled substances).
   For testosterone inventory: filter by STATUS = 'Active' and REMAINING_VOLUME_ML > 0

📦 INVENTORY QUERY EXAMPLES:

-- How much testosterone do we have left (total remaining volume)?
SELECT
    SUM(REMAINING_VOLUME_ML) AS TOTAL_REMAINING_ML,
    COUNT(*) AS ACTIVE_VIALS,
    SUM(SIZE_ML) AS TOTAL_CAPACITY_ML,
    ROUND(SUM(REMAINING_VOLUME_ML) / NULLIF(SUM(SIZE_ML), 0) * 100, 1) AS PERCENT_REMAINING
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active'
  AND REMAINING_VOLUME_ML > 0;

-- List all active testosterone vials with remaining volume:
SELECT VIAL_ID, DEA_DRUG_NAME, SIZE_ML, REMAINING_VOLUME_ML, LOT_NUMBER, EXPIRATION_DATE, LOCATION
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active' AND REMAINING_VOLUME_ML > 0
ORDER BY REMAINING_VOLUME_ML DESC;

-- Vials expiring within 30 days:
SELECT VIAL_ID, DEA_DRUG_NAME, REMAINING_VOLUME_ML, EXPIRATION_DATE, LOT_NUMBER
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active' AND REMAINING_VOLUME_ML > 0
  AND EXPIRATION_DATE <= DATEADD(DAY, 30, CURRENT_DATE())
ORDER BY EXPIRATION_DATE ASC;

📊 PATIENT FINANCIAL QUERY EXAMPLES:
-- Get all financial data for a specific patient (Andrew Lang):
SELECT
    p.PATIENT_NAME,
    p.PATIENT_ID,
    p.HEALTHIE_CLIENT_ID,
    i.INVOICE_ID, i.AMOUNT AS INVOICE_AMOUNT, i.PAID_AMOUNT, i.REMAINING_BALANCE, i.STATUS AS INVOICE_STATUS, i.INVOICE_DATE,
    b.BILLING_ITEM_ID, b.AMOUNT_PAID AS BILLING_AMOUNT_PAID, b.STATE AS BILLING_STATE, b.PAYMENT_DATE AS BILLING_PAYMENT_DATE,
    m.PROGRAM_NAME, m.FEE_AMOUNT, m.STATUS AS MEMBERSHIP_STATUS,
    pi.ISSUE_TYPE, pi.DESCRIPTION AS ISSUE_DESCRIPTION, pi.STATUS AS ISSUE_STATUS
FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW p
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES i ON p.PATIENT_ID = i.PATIENT_ID
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS b ON p.PATIENT_ID = b.PATIENT_ID
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.MEMBERSHIPS m ON p.PATIENT_ID = m.PATIENT_ID
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.PAYMENT_ISSUES pi ON p.PATIENT_ID = pi.PATIENT_ID
WHERE p.PATIENT_NAME ILIKE '%Andrew Lang%';

-- Total paid by a patient (sum all payment sources):
SELECT
    p.PATIENT_NAME,
    COALESCE(SUM(b.AMOUNT_PAID), 0) AS TOTAL_HEALTHIE_BILLING_PAID,
    COALESCE(SUM(i.PAID_AMOUNT), 0) AS TOTAL_INVOICE_PAID,
    COALESCE(SUM(qb.AMOUNT_PAID), 0) AS TOTAL_QB_PAID,
    COALESCE(SUM(b.AMOUNT_PAID), 0) + COALESCE(SUM(i.PAID_AMOUNT), 0) + COALESCE(SUM(qb.AMOUNT_PAID), 0) AS GRAND_TOTAL_PAID
FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW p
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS b ON p.PATIENT_ID = b.PATIENT_ID AND b.STATE = 'succeeded'
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES i ON p.PATIENT_ID = i.PATIENT_ID
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.QB_PAYMENTS qb ON p.PATIENT_ID = qb.PATIENT_ID
WHERE p.PATIENT_NAME ILIKE '%Andrew Lang%'
GROUP BY p.PATIENT_NAME;

-- Revenue from Healthie last 7 days:
SELECT SUM(AMOUNT_PAID) AS TOTAL_REVENUE
FROM GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
WHERE STATE = 'succeeded' AND PAYMENT_DATE >= DATEADD(DAY, -7, CURRENT_DATE());

-- Patients with open/unpaid invoices:
SELECT p.PATIENT_ID, p.PATIENT_NAME, p.EMAIL, SUM(i.REMAINING_BALANCE) AS TOTAL_OWED
FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW p
JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES i ON p.PATIENT_ID = i.PATIENT_ID
WHERE i.REMAINING_BALANCE > 0
GROUP BY p.PATIENT_ID, p.PATIENT_NAME, p.EMAIL
ORDER BY TOTAL_OWED DESC;

⚠️ CRITICAL RULES:
1. ALWAYS filter by patient name when asked about a specific patient!
2. Use ILIKE '%Name%' for name matching (case-insensitive).
3. Use full table names: GMH_CLINIC.SCHEMA.TABLE
4. NEVER reference QB_CUSTOMER_ID in PATIENT_360_VIEW - it doesn't exist there.
5. Use DATEADD(DAY, -7, CURRENT_DATE()) for date arithmetic.
6. When asked "how much has X paid", sum from HEALTHIE_BILLING_ITEMS, HEALTHIE_INVOICES.PAID_AMOUNT, and QB_PAYMENTS.
7. For testosterone/inventory: Use VIALS table with CONTROLLED_SUBSTANCE = true, STATUS = 'Active'.
8. For dispense history: Join DISPENSES to VIALS on VIAL_ID and to PATIENT_360_VIEW on PATIENT_ID.
`;

// Bedrock client
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2' });

// ============================================================================
// HEALTHIE API DIRECT QUERIES (for real-time billing data)
// ============================================================================

async function fetchHealthieGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!HEALTHIE_API_KEY) {
    console.log('[Healthie] No API key configured');
    return null;
  }

  try {
    const res = await fetch(HEALTHIE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Basic ${HEALTHIE_API_KEY}`,
        authorizationsource: 'API',
      },
      body: JSON.stringify({ query, variables }),
    });

    const json: any = await res.json();
    if (!res.ok || json.errors) {
      console.error('[Healthie] API Error:', JSON.stringify(json.errors || json));
      return null;
    }
    return json.data;
  } catch (e: any) {
    console.error('[Healthie] Fetch error:', e.message);
    return null;
  }
}

async function findHealthieUser(patientName: string): Promise<any | null> {
  const query = `
    query FindUser($keywords: String!) {
      users(keywords: $keywords, page_size: 5) {
        id
        email
        first_name
        last_name
        phone_number
        gender
        dob
        active_tags { id name }
        locations {
          id
          name
          line1
          line2
          city
          state
          zip
          country
        }
      }
    }
  `;
  const data = await fetchHealthieGraphQL<any>(query, { keywords: patientName });
  return data?.users?.[0] || null;
}

async function fetchHealthieBillingItems(clientId: string): Promise<any[]> {
  const query = `
    query BillingItemsForClient($client_id: ID!) {
      billingItems(client_id: $client_id, page_size: 50) {
        id
        amount_paid
        state
        created_at
        sender { full_name }
        recipient { full_name }
        offering { name }
      }
    }
  `;
  const data = await fetchHealthieGraphQL<any>(query, { client_id: clientId });
  return data?.billingItems || [];
}

async function fetchHealthieRequestedPayments(patientName: string, clientId: string): Promise<any[]> {
  const query = `
    query RequestedPayments($keywords: String!) {
      requestedPayments(keywords: $keywords, page_size: 50) {
        id
        price
        status
        created_at
        paid_at
        sender { id full_name }
        recipient { id full_name }
        offering { name }
      }
    }
  `;
  const data = await fetchHealthieGraphQL<any>(query, { keywords: patientName });
  // Filter to only payments where recipient matches our patient
  return (data?.requestedPayments || []).filter((rp: any) => rp.recipient?.id === clientId);
}

// ============================================================================
// HEALTHIE WRITE MUTATIONS - Update patient data in Healthie
// ============================================================================

interface HealthieUpdateResult {
  success: boolean;
  user?: any;
  errors?: Array<{ field: string; message: string }>;
}

interface PatientUpdateFields {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  dob?: string;
  gender?: string;
  // Address fields (nested in location)
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  // Other
  dietitian_id?: string;
  timezone?: string;
  quick_notes?: string;
}

async function updateHealthiePatient(healthieClientId: string, fields: PatientUpdateFields): Promise<HealthieUpdateResult> {
  // Build the location object if any address fields are provided
  let location: any = null;
  if (fields.line1 || fields.line2 || fields.city || fields.state || fields.zip || fields.country) {
    location = {
      line1: fields.line1,
      line2: fields.line2,
      city: fields.city,
      state: fields.state,
      zip: fields.zip,
      country: fields.country || 'US'
    };
  }

  const mutation = `
    mutation UpdateClient($id: ID!, $first_name: String, $last_name: String, $email: String, 
                          $phone_number: String, $dob: String, $gender: String, 
                          $location: ClientLocationInput, $dietitian_id: String, 
                          $timezone: String, $quick_notes: String) {
      updateClient(input: {
        id: $id
        first_name: $first_name
        last_name: $last_name
        email: $email
        phone_number: $phone_number
        dob: $dob
        gender: $gender
        location: $location
        dietitian_id: $dietitian_id
        timezone: $timezone
        quick_notes: $quick_notes
      }) {
        user {
          id
          first_name
          last_name
          email
          phone_number
          dob
          gender
          location {
            line1
            line2
            city
            state
            zip
            country
          }
        }
        messages {
          field
          message
        }
      }
    }
  `;

  const variables: any = {
    id: healthieClientId,
    first_name: fields.first_name,
    last_name: fields.last_name,
    email: fields.email,
    phone_number: fields.phone_number,
    dob: fields.dob,
    gender: fields.gender,
    location: location,
    dietitian_id: fields.dietitian_id,
    timezone: fields.timezone,
    quick_notes: fields.quick_notes
  };

  // Remove undefined values
  Object.keys(variables).forEach(key => {
    if (variables[key] === undefined) delete variables[key];
  });

  console.log(`[Bot] 🔧 Updating Healthie patient ${healthieClientId}:`, JSON.stringify(variables, null, 2));

  try {
    const data = await fetchHealthieGraphQL<any>(mutation, variables);

    if (data?.updateClient?.messages?.length > 0) {
      return {
        success: false,
        errors: data.updateClient.messages
      };
    }

    return {
      success: true,
      user: data?.updateClient?.user
    };
  } catch (error: any) {
    console.error('[Bot] Healthie update error:', error);
    return {
      success: false,
      errors: [{ field: 'general', message: error.message }]
    };
  }
}

// Parse natural language update commands
interface ParsedUpdateCommand {
  patientName: string;
  updateType: 'address' | 'phone' | 'email' | 'name' | 'dob' | 'gender' | 'other';
  fields: PatientUpdateFields;
  rawText: string;
}

function parseUpdateCommand(text: string): ParsedUpdateCommand | null {
  const textLower = text.toLowerCase();

  // Must contain update/change/set/modify (can be preceded by "please", "can you", etc.)
  if (!textLower.match(/(update|change|set|modify|edit)\s/)) {
    return null;
  }

  // Remove common prefixes for pattern matching
  // "Please update..." -> "update..."
  // "Can you update..." -> "update..."
  let cleanedText = text.replace(/^(please\s+)?(can\s+you\s+)?/i, '');

  // Normalize smart quotes to straight quotes for pattern matching
  cleanedText = cleanedText.replace(/['']/g, "'");

  // Extract patient name - multiple patterns supported:
  // 1. "update ... for John Smith" or "update ... for patient John Smith"
  // 2. "update John Smith's ..." (possessive)
  // 3. "update John Smith gender ..." (name before field)
  let patientName: string | null = null;

  // Pattern 1: "for [Name]" or "of [Name]"
  const forPattern = /(?:for|of)\s+(?:patient\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i;
  const forMatch = cleanedText.match(forPattern);
  if (forMatch) {
    patientName = forMatch[1].trim();
  }

  // Pattern 2: "[Name]'s [field]" - possessive form (straight quote after normalization)
  if (!patientName) {
    const possessivePattern = /^(?:update|change|set|modify|edit)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'s\s/i;
    const possessiveMatch = cleanedText.match(possessivePattern);
    if (possessiveMatch) {
      patientName = possessiveMatch[1].trim();
    }
  }

  // Pattern 3: "[Name] [field] to [value]" - name first, then field
  if (!patientName) {
    const nameFirstPattern = /^(?:update|change|set|modify|edit)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:gender|email|phone|address|dob)/i;
    const nameFirstMatch = cleanedText.match(nameFirstPattern);
    if (nameFirstMatch) {
      patientName = nameFirstMatch[1].trim();
    }
  }

  if (!patientName) {
    console.log(`[Bot] parseUpdateCommand: Could not extract patient name from: "${text}" (cleaned: "${cleanedText}")`);
    return null;
  }

  const fields: PatientUpdateFields = {};
  let updateType: 'address' | 'phone' | 'email' | 'name' | 'dob' | 'gender' | 'other' = 'other';

  // GENDER PATTERNS
  // "update gender for John Smith to male"
  // "update John Smith's gender to male"
  // "change gender to female for Jane Doe"
  // "set John Smith gender to male"
  const genderPattern = /gender\s+(?:to\s+)?(male|female|m|f|man|woman|non-binary|nonbinary|other)\b/i;
  const genderMatch = textLower.match(genderPattern);
  if (genderMatch || textLower.includes('gender')) {
    updateType = 'gender';
    // Find the value after "to" if present
    const genderValueMatch = textLower.match(/gender\s+(?:.*?\s+)?to\s+(male|female|m|f|man|woman|non-binary|nonbinary|other)/i)
      || textLower.match(/to\s+(male|female|m|f|man|woman|non-binary|nonbinary|other)\s*$/i)
      || genderMatch;
    if (genderValueMatch) {
      let gender = genderValueMatch[1].toLowerCase();
      // Normalize gender values
      if (gender === 'm' || gender === 'man') gender = 'male';
      if (gender === 'f' || gender === 'woman') gender = 'female';
      if (gender === 'nonbinary') gender = 'non-binary';
      fields.gender = gender.charAt(0).toUpperCase() + gender.slice(1); // Capitalize
    }
  }

  // ADDRESS PATTERNS
  // "update address for John Smith to 123 Main St, City, ST 12345"
  if (textLower.includes('address')) {
    updateType = 'address';

    // Try to parse address parts from "to [address]"
    const afterTo = text.match(/to\s+(.+)$/i);
    if (afterTo) {
      const addressText = afterTo[1];

      // Parse "123 Main St, City, ST 12345" format
      const fullAddressMatch = addressText.match(/^(.+?),\s*([^,]+),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/i);
      if (fullAddressMatch) {
        fields.line1 = fullAddressMatch[1].trim();
        fields.city = fullAddressMatch[2].trim();
        fields.state = fullAddressMatch[3].toUpperCase();
        fields.zip = fullAddressMatch[4];
      } else {
        // Try simpler pattern: "123 Main St, City ST 12345"
        const simpleMatch = addressText.match(/^(.+?),?\s*([A-Za-z\s]+)\s+([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/i);
        if (simpleMatch) {
          fields.line1 = simpleMatch[1].trim();
          fields.city = simpleMatch[2].trim();
          fields.state = simpleMatch[3].toUpperCase();
          fields.zip = simpleMatch[4];
        } else {
          // Just use the whole thing as line1
          fields.line1 = addressText.trim();
        }
      }
    }
  }

  // PHONE PATTERNS
  // "change phone number for John Smith to 555-123-4567"
  const phonePattern = /phone\s*(?:number)?\s+(?:.*?\s+)?to\s+([0-9\-\(\)\s\+\.]+)/i;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    updateType = 'phone';
    // Normalize phone number
    fields.phone_number = phoneMatch[1].replace(/[\s\-\(\)\.]/g, '').replace(/^1/, '');
  }

  // EMAIL PATTERNS
  // "set email for John Smith to john@example.com"
  const emailPattern = /email\s+(?:.*?\s+)?to\s+([\w\.\-\+]+@[\w\.\-]+\.\w+)/i;
  const emailMatch = text.match(emailPattern);
  if (emailMatch) {
    updateType = 'email';
    fields.email = emailMatch[1].toLowerCase();
  }

  // NAME PATTERNS (first/last)
  const firstNameMatch = text.match(/first\s*name\s+(?:.*?\s+)?to\s+([A-Za-z]+)/i);
  const lastNameMatch = text.match(/last\s*name\s+(?:.*?\s+)?to\s+([A-Za-z]+)/i);
  if (firstNameMatch || lastNameMatch) {
    updateType = 'name';
    if (firstNameMatch) fields.first_name = firstNameMatch[1];
    if (lastNameMatch) fields.last_name = lastNameMatch[1];
  }

  // DOB PATTERNS
  // "update date of birth for John Smith to 1985-03-15"
  const dobPattern = /(?:date\s*of\s*birth|dob|birthday)\s+(?:.*?\s+)?to\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
  const dobMatch = text.match(dobPattern);
  if (dobMatch) {
    updateType = 'dob';
    // Normalize to YYYY-MM-DD format
    let dob = dobMatch[1];
    if (dob.includes('/')) {
      const [month, day, year] = dob.split('/');
      dob = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    fields.dob = dob;
  }

  // Check if we actually extracted any fields
  if (Object.keys(fields).length === 0) {
    console.log(`[Bot] parseUpdateCommand: No fields extracted from: "${text}"`);
    return null;
  }

  console.log(`[Bot] parseUpdateCommand: Parsed successfully - patient="${patientName}", type=${updateType}, fields=`, fields);

  return {
    patientName,
    updateType,
    fields,
    rawText: text
  };
}

// Find patient's Healthie client ID from Snowflake
async function findHealthieClientId(patientName: string): Promise<{ healthieClientId: string | null; patientId: string | null; fullName: string | null }> {
  try {
    const conn = await connectSnowflake();
    const sql = `
      SELECT PATIENT_ID, PATIENT_NAME, HEALTHIE_CLIENT_ID
      FROM GMH_CLINIC.PATIENT_DATA.PATIENTS
      WHERE PATIENT_NAME ILIKE ?
      LIMIT 1
    `;

    const rows: any[] = await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        binds: [`%${patientName}%`],
        complete: (err: any, stmt: any, rows: any) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      });
    });

    conn.destroy((err: any) => {
      if (err) console.error('Error destroying connection:', err);
    });

    if (rows.length > 0) {
      return {
        healthieClientId: rows[0].HEALTHIE_CLIENT_ID,
        patientId: rows[0].PATIENT_ID,
        fullName: rows[0].PATIENT_NAME
      };
    }

    return { healthieClientId: null, patientId: null, fullName: null };
  } catch (error) {
    console.error('[Bot] Error finding Healthie client ID:', error);
    return { healthieClientId: null, patientId: null, fullName: null };
  }
}

// Handle update command from Telegram
async function handleHealthieUpdate(chatId: number, text: string): Promise<boolean> {
  const parsed = parseUpdateCommand(text);
  if (!parsed) {
    return false; // Not an update command
  }

  console.log(`[Bot] 📝 Parsed update command:`, parsed);

  await sendTyping(chatId);

  // Find the patient's Healthie client ID
  const { healthieClientId, fullName } = await findHealthieClientId(parsed.patientName);

  if (!healthieClientId) {
    await sendMessage(chatId,
      `❌ Could not find patient "${parsed.patientName}" or they don't have a Healthie account linked.\n\n` +
      `Make sure the patient exists in the system and has a Healthie client ID.`
    );
    return true;
  }

  // Show confirmation message
  let confirmMsg = `📝 *Updating ${fullName} in Healthie*\n\n`;
  confirmMsg += `*Update type:* ${parsed.updateType}\n`;
  confirmMsg += `*Changes:*\n`;

  for (const [key, value] of Object.entries(parsed.fields)) {
    if (value !== undefined) {
      confirmMsg += `• ${key.replace('_', ' ')}: \`${value}\`\n`;
    }
  }

  confirmMsg += `\n⏳ _Processing update..._`;
  await sendMessage(chatId, confirmMsg, 'Markdown');

  // Execute the update
  const result = await updateHealthiePatient(healthieClientId, parsed.fields);

  if (result.success) {
    let successMsg = `✅ *Successfully updated ${fullName}!*\n\n`;
    if (result.user) {
      successMsg += `*Updated profile:*\n`;
      if (result.user.email) successMsg += `• Email: ${result.user.email}\n`;
      if (result.user.phone_number) successMsg += `• Phone: ${result.user.phone_number}\n`;
      if (result.user.location) {
        const loc = result.user.location;
        if (loc.line1) successMsg += `• Address: ${loc.line1}`;
        if (loc.line2) successMsg += `, ${loc.line2}`;
        if (loc.city) successMsg += `, ${loc.city}`;
        if (loc.state) successMsg += `, ${loc.state}`;
        if (loc.zip) successMsg += ` ${loc.zip}`;
        successMsg += `\n`;
      }
    }
    await sendMessage(chatId, successMsg, 'Markdown');
  } else {
    let errorMsg = `❌ *Failed to update ${fullName}*\n\n`;
    if (result.errors) {
      for (const err of result.errors) {
        errorMsg += `• ${err.field}: ${err.message}\n`;
      }
    }
    await sendMessage(chatId, errorMsg, 'Markdown');
  }

  return true;
}

// ============================================================================
// SMART PATIENT NAME DETECTION
// ============================================================================

function extractPatientName(text: string): string | null {
  // Common patterns for patient name queries
  const patterns = [
    /(?:data|info|information|details|financials?|payments?|billing)\s+(?:on|for|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:'s)?\s+(?:data|info|information|details|financials?|payments?|billing)/i,
    /(?:patient|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /(?:look up|lookup|find|get|show|give me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Exclude common words that aren't names
      const name = match[1].trim();
      const excludeWords = ['All', 'Complete', 'Full', 'Total', 'Patient', 'Client', 'Financial', 'Billing', 'Payment'];
      if (!excludeWords.some(w => name.toLowerCase() === w.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
}

function isFinancialQuery(text: string): boolean {
  const financialKeywords = [
    'financial', 'payment', 'billing', 'invoice', 'paid', 'owes', 'owe',
    'balance', 'revenue', 'charge', 'fee', 'cost', 'money', 'dollar', '$'
  ];
  const textLower = text.toLowerCase();
  return financialKeywords.some(kw => textLower.includes(kw)) ||
    textLower.includes('all data') ||
    textLower.includes('complete data') ||
    textLower.includes('everything');
}

async function connectSnowflake() {
  const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER || process.env.SNOWFLAKE_USERNAME!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    database: process.env.SNOWFLAKE_DATABASE!,
    schema: process.env.SNOWFLAKE_SCHEMA
  });

  await new Promise((resolve, reject) => {
    conn.connect((err: any) => {
      if (err) reject(err);
      else resolve(null);
    });
  });

  return conn;
}

// Detect if this is a follow-up question that needs previous context
function isFollowUpQuery(text: string): boolean {
  const followUpPatterns = [
    /\b(those|these|them|their|they)\b/i,          // "who are those patients"
    /\b(that|which)\s+(patient|result|data)/i,    // "which patients"
    /\b(who|what|where|when)\s+(are|is|were|was)\s+(they|those|these)/i,
    /\b(show|give|tell|list)\s+me\s+(more|details|info)/i,  // "show me more"
    /\b(and|also)\s+their\b/i,                     // "and their email"
    /^(who|what|which|where|when)\??$/i,           // single word follow-ups
  ];
  return followUpPatterns.some(p => p.test(text));
}

async function generateSQL(question: string, prevContext?: ConversationContext | null): Promise<string> {
  let contextHint = '';
  if (prevContext && isFollowUpQuery(question)) {
    contextHint = `

PREVIOUS QUERY CONTEXT (user is asking a follow-up question):
Previous question: "${prevContext.lastQuery}"
Previous SQL used:
${prevContext.lastSql}

Number of results from previous query: ${prevContext.lastResults.length}
${prevContext.lastResults.length > 0 && prevContext.lastResults.length <= 10
        ? `Previous results (for reference): ${JSON.stringify(prevContext.lastResults, null, 2)}`
        : prevContext.lastResults.length > 0
          ? `First 5 results: ${JSON.stringify(prevContext.lastResults.slice(0, 5), null, 2)}`
          : ''
      }

The user is likely asking about these same records. Modify your query to answer their follow-up while keeping the same filters/context.`;
  }

  // CRITICAL RULES placed at the START of prompt for highest visibility
  const questionLower = question.toLowerCase();
  let specializedHint = '';

  // Detect provider patient count questions
  if ((questionLower.includes('provider') || questionLower.includes('doctor') || questionLower.includes('dr.') ||
    questionLower.includes('whitten') || questionLower.includes('schafer')) &&
    (questionLower.includes('patient') || questionLower.includes('how many'))) {
    specializedHint = `
🚨 PROVIDER PATIENT COUNT DETECTED! USE THIS EXACT QUERY:
SELECT FULL_NAME as PROVIDER_NAME, PATIENT_COUNT, EMAIL, ACTIVE
FROM GMH_CLINIC.PATIENT_DATA.PROVIDERS
WHERE FULL_NAME ILIKE '%${questionLower.includes('whitten') ? 'whitten' : questionLower.includes('schafer') ? 'schafer' : '%'}%';

DO NOT use COUNT(*) from PATIENTS table! The PROVIDERS table has PATIENT_COUNT pre-calculated!
`;
  }

  // Detect Carrie Boyd testosterone questions
  if (questionLower.includes('carrie boyd') ||
    (questionLower.includes('carrie') && questionLower.includes('testosterone')) ||
    (questionLower.includes('run out') && questionLower.includes('carrie'))) {
    specializedHint = `
🚨 CARRIE BOYD TESTOSTERONE DETECTED! "Carrie Boyd" is a MEDICATION TYPE, not a patient name!
Full name: "Carrie Boyd - Testosterone Miglyol 812 Oil Injection 200mg/ml - 30 ML Vials"

For inventory: 
SELECT SUM(REMAINING_VOLUME_ML) as REMAINING_ML, COUNT(*) as VIALS
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active' AND DEA_DRUG_NAME ILIKE '%carrie boyd%';

For projection (when will we run out):
WITH dispense_stats AS (
  SELECT SUM(TOTAL_DISPENSED_ML) / NULLIF(DATEDIFF(day, MIN(DISPENSE_DATE), CURRENT_DATE()), 0) as ML_PER_DAY
  FROM GMH_CLINIC.PATIENT_DATA.DISPENSES WHERE MEDICATION_NAME ILIKE '%carrie boyd%'
),
inventory AS (
  SELECT SUM(REMAINING_VOLUME_ML) as REMAINING_ML
  FROM GMH_CLINIC.PATIENT_DATA.VIALS WHERE STATUS = 'Active' AND DEA_DRUG_NAME ILIKE '%carrie boyd%'
)
SELECT 'Carrie Boyd' as TYPE, ROUND(i.REMAINING_ML, 1) as REMAINING_ML, ROUND(d.ML_PER_DAY, 2) as DAILY_USAGE_ML,
  ROUND(i.REMAINING_ML / NULLIF(d.ML_PER_DAY, 0), 0) as DAYS_REMAINING,
  DATEADD(day, ROUND(i.REMAINING_ML / NULLIF(d.ML_PER_DAY, 0), 0)::INT, CURRENT_DATE()) as PROJECTED_RUNOUT
FROM inventory i, dispense_stats d;
`;
  }

  // Detect TopRX testosterone questions
  if (questionLower.includes('toprx') || questionLower.includes('top rx') ||
    (questionLower.includes('cottonseed') && questionLower.includes('testosterone'))) {
    specializedHint = `
🚨 TOPRX TESTOSTERONE DETECTED! "TopRX" is a MEDICATION TYPE, not a patient name!
Full name: "TopRX (Testosterone Cypionate Cottonseed Oil 200mg/ml) - 10 ML Vials"

For inventory: 
SELECT SUM(REMAINING_VOLUME_ML) as REMAINING_ML, COUNT(*) as VIALS
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active' AND DEA_DRUG_NAME ILIKE '%toprx%';
`;
  }

  const prompt = `${specializedHint}
${SCHEMA_CONTEXT}
${contextHint}
User Question: ${question}

CRITICAL INSTRUCTIONS:
1. Return ONLY the SQL query - no explanations, no "Here is the query" text
2. For provider patient counts: Query PROVIDERS.PATIENT_COUNT directly - NEVER count from PATIENTS table
3. For "Carrie Boyd" or "TopRX" testosterone: These are MEDICATION TYPES, not patient names - use VIALS.DEA_DRUG_NAME and DISPENSES.MEDICATION_NAME
4. Use the EXACT queries from the schema examples when they match the question

Generate a Snowflake SQL query to answer this question.
${contextHint ? 'IMPORTANT: This is a follow-up question - keep the same patient/filter context from the previous query!' : ''}`;

  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1000,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  let result = responseBody.content[0].text.trim();

  // Remove markdown code blocks
  result = result.replace(/```sql\n?|\n?```/g, '');

  // Extract just the SQL if AI added explanatory text before it
  // Look for SQL keywords at start of a line
  const sqlMatch = result.match(/^(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b[\s\S]*/im);
  if (sqlMatch) {
    result = sqlMatch[0].trim();
  }

  return result;
}

async function executeQuery(sql: string): Promise<any[]> {
  let conn: any;
  try {
    conn = await connectSnowflake();
    return await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        complete: (err: any, stmt: any, rows: any) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      });
    });
  } finally {
    if (conn) {
      conn.destroy((err: any) => {
        if (err) console.error('Error destroying connection:', err);
      });
    }
  }
}

// ============================================================================
// SELF-HEALING SQL: When a query fails, ask AI to fix it based on the error
// ============================================================================
async function generateFixedSQL(originalQuestion: string, failedSQL: string, errorMessage: string, prevContext?: ConversationContext | null): Promise<string> {
  console.log(`[Bot] 🔧 Self-healing: Attempting to fix SQL based on error...`);

  const prompt = `${SCHEMA_CONTEXT}

PREVIOUS SQL THAT FAILED:
${failedSQL}

ERROR MESSAGE FROM SNOWFLAKE:
${errorMessage}

ORIGINAL USER QUESTION: ${originalQuestion}

The SQL query above failed with the error shown. Analyze the error and generate a CORRECTED SQL query.

Common fixes needed:
- "invalid identifier" = column doesn't exist in that table. Check the schema above for correct column names.
- For VIALS table: use DEA_DRUG_NAME (not DRUG_NAME), no CONTROLLED_SUBSTANCE or PATIENT_ID columns
- For patient provider info: PATIENT_360_VIEW doesn't have PROVIDER column. Provider info may not be available.
- Always verify column names against the schema provided above.

Generate ONLY the corrected SQL query. No explanations.`;

  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1000,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  let result = responseBody.content[0].text.trim();

  // Remove markdown code blocks
  result = result.replace(/```sql\n?|\n?```/g, '');

  // Extract just the SQL if AI added explanatory text before it
  const sqlMatch = result.match(/^(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b[\s\S]*/im);
  if (sqlMatch) {
    result = sqlMatch[0].trim();
  }

  return result;
}

async function executeQueryWithRetry(
  sql: string,
  question: string,
  prevContext?: ConversationContext | null,
  maxRetries: number = 2
): Promise<{ results: any[]; finalSQL: string; retryCount: number }> {
  let currentSQL = sql;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const results = await executeQuery(currentSQL);
      return { results, finalSQL: currentSQL, retryCount: attempt };
    } catch (error: any) {
      lastError = error;
      console.log(`[Bot] ❌ SQL attempt ${attempt + 1} failed: ${error.message}`);

      if (attempt < maxRetries) {
        // Try to fix the SQL
        console.log(`[Bot] 🔧 Attempting self-heal (retry ${attempt + 1}/${maxRetries})...`);
        const fixedSQL = await generateFixedSQL(question, currentSQL, error.message, prevContext);

        // Check if AI generated a valid SQL
        const isSql = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i.test(fixedSQL);
        if (isSql && fixedSQL !== currentSQL) {
          console.log(`[Bot] 🔄 Retrying with fixed SQL:`, fixedSQL);
          currentSQL = fixedSQL;
        } else {
          console.log(`[Bot] ⚠️ AI could not generate a different SQL, giving up.`);
          break;
        }
      }
    }
  }

  // All retries failed
  throw lastError;
}

async function formatAnswer(question: string, sql: string, results: any[], additionalContext: string = ''): Promise<string> {
  const prompt = `You are a helpful medical assistant providing clinic data insights.

User Question: ${question}
${additionalContext}
SQL Query Used (Snowflake):
${sql}

Query Results:
${JSON.stringify(results, null, 2)}

Provide a clear, concise answer in natural language. Format numbers nicely. Keep it under 300 words.
If there are multiple results, summarize key findings. Use emojis sparingly for clarity.`;

  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 800,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text.trim();
}

async function sendMessage(chatId: number, text: string, parseMode?: 'Markdown' | 'HTML') {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Bot] No Telegram token configured');
    return;
  }

  const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode
      })
    });
  } catch (error) {
    console.error('[Bot] Send error:', error);
  }
}

async function sendTyping(chatId: number) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing'
      })
    });
  } catch (error) {
    console.error('[Bot] Typing error:', error);
  }
}

async function handlePatientLookup(chatId: number, query: string) {
  try {
    await sendTyping(chatId);
    const patients = await patientsService.findByQuery({ name: query });

    if (patients.length === 0) {
      await sendMessage(chatId, `No patients found matching "${query}" in the dashboard.`);
      return;
    }

    let response = `🔍 *Found ${patients.length} patient(s):*\n\n`;
    for (const p of patients.slice(0, 5)) {
      response += `👤 *${p.fullName}*\n`;
      response += `🆔 Patient ID: \`${p.patientId}\`\n`;
      if (p.healthieClientId) response += `🏥 Healthie ID: \`${p.healthieClientId}\`\n`;
      if (p.ghlContactId) response += `📱 GHL ID: \`${p.ghlContactId}\`\n`;
      if (p.email) response += `📧 ${p.email}\n`;
      if (p.phone) response += `📞 ${p.phone}\n`;
      response += '\n';
    }

    if (patients.length > 5) {
      response += `_...and ${patients.length - 5} more._`;
    }

    await sendMessage(chatId, response, 'Markdown');
  } catch (error: any) {
    console.error('Patient lookup error:', error);
    await sendMessage(chatId, `❌ Error looking up patient: ${error.message}`);
  }
}

async function handleHealthieFinance(chatId: number, patientName: string) {
  try {
    await sendTyping(chatId);

    // First search for the patient directly in Healthie by name
    const userSearchQuery = `
      query FindUser($keywords: String!) {
        users(keywords: $keywords, page_size: 5) {
          id
          email
          first_name
          last_name
          phone_number
          active_tags { id name }
        }
      }
    `;

    let healthieUser: any = null;
    try {
      const searchData = await fetchGraphQL<any>(userSearchQuery, { keywords: patientName });
      if (searchData.users && searchData.users.length > 0) {
        healthieUser = searchData.users[0];
      }
    } catch (e: any) {
      console.error('User search error:', e);
    }

    if (!healthieUser) {
      await sendMessage(chatId, `No patient found in Healthie matching "${patientName}".`);
      return;
    }

    const healthieClientId = healthieUser.id;
    const fullName = `${healthieUser.first_name} ${healthieUser.last_name}`;

    await sendTyping(chatId);

    // Query billing items filtered by client_id
    const billingQuery = `
      query BillingItemsForClient($client_id: ID!) {
        billingItems(client_id: $client_id, page_size: 50) {
          id
          amount_paid
          state
          created_at
          sender_id
          recipient_id
          sender { full_name }
          recipient { full_name }
          offering { name }
        }
      }
    `;

    // Query requested payments by keywords (patient name)
    const paymentsQuery = `
      query RequestedPayments($keywords: String!) {
        requestedPayments(keywords: $keywords, page_size: 50) {
          id
          price
          status
          created_at
          paid_at
          sender_id
          recipient_id
          offering { name }
          sender { id full_name }
          recipient { id full_name }
        }
      }
    `;

    let billingItems: any[] = [];
    let requestedPayments: any[] = [];

    try {
      const billingData = await fetchGraphQL<any>(billingQuery, { client_id: healthieClientId });
      billingItems = billingData.billingItems || [];
    } catch (e: any) {
      console.error('Billing items error:', e);
    }

    try {
      const paymentsData = await fetchGraphQL<any>(paymentsQuery, { keywords: patientName });
      // Filter to only payments where recipient matches our patient
      requestedPayments = (paymentsData.requestedPayments || []).filter((rp: any) =>
        rp.recipient_id === healthieClientId || rp.recipient?.id === healthieClientId
      );
    } catch (e: any) {
      console.error('Requested payments error:', e);
    }

    let totalPaid = 0;
    let response = `💰 *Healthie Financial Data for ${fullName}*\n`;
    response += `🆔 Healthie ID: \`${healthieClientId}\`\n`;
    response += `📧 ${healthieUser.email || 'N/A'} | 📞 ${healthieUser.phone_number || 'N/A'}\n`;
    if (healthieUser.active_tags?.length) {
      response += `🏷️ ${healthieUser.active_tags.map((t: any) => t.name).join(', ')}\n`;
    }
    response += '\n';

    // Billing Items (recurring charges)
    if (billingItems.length > 0) {
      response += `📋 *Billing Items (${billingItems.length}):*\n`;
      for (const item of billingItems.slice(0, 10)) {
        const amount = parseFloat(item.amount_paid || '0');
        if (item.state === 'succeeded') totalPaid += amount;
        const date = item.created_at?.split(' ')[0] || item.created_at?.split('T')[0] || 'N/A';
        response += `• ${item.offering?.name || 'Charge'}: *$${amount.toFixed(2)}* (${item.state}) - ${date}\n`;
      }
      if (billingItems.length > 10) response += `  _...and ${billingItems.length - 10} more_\n`;
      response += '\n';
    } else {
      response += `📋 *Billing Items:* None\n\n`;
    }

    // Requested Payments
    if (requestedPayments.length > 0) {
      response += `💳 *Requested Payments (${requestedPayments.length}):*\n`;
      for (const rp of requestedPayments.slice(0, 10)) {
        const amount = parseFloat(rp.price || '0');
        // Don't double count - billing items already captured the payment
        const date = rp.paid_at?.split(' ')[0] || rp.created_at?.split('T')[0] || 'N/A';
        response += `• ${rp.offering?.name || 'Payment'}: *$${amount.toFixed(2)}* (${rp.status}) - ${date}\n`;
      }
      if (requestedPayments.length > 10) response += `  _...and ${requestedPayments.length - 10} more_\n`;
      response += '\n';
    } else {
      response += `💳 *Requested Payments:* None\n\n`;
    }

    response += `💵 *Total Paid (from billing items):* $${totalPaid.toFixed(2)}`;

    await sendMessage(chatId, response, 'Markdown');
  } catch (error: any) {
    console.error('Healthie finance error:', error);
    await sendMessage(chatId, `❌ Error fetching Healthie data: ${error.message}`);
  }
}

async function handleMessage(chatId: number, text: string, username?: string) {
  console.log(`[Bot] Message from ${username} (${chatId}): ${text}`);

  if (AUTHORIZED_CHAT_IDS.length > 0 && !AUTHORIZED_CHAT_IDS.includes(chatId)) {
    await sendMessage(chatId, '⛔ You are not authorized to use this bot.');
    return;
  }

  // Normalize text for command matching (lowercase)
  const textLower = text.toLowerCase();

  if (textLower === '/start') {
    await sendMessage(chatId,
      `🤖 *GMH Clinic AI Assistant (V2) - Self-Learning System*

I can answer questions about your clinic data. I automatically:
• 📊 Query Snowflake (demographics, billing, inventory)
• 💳 Fetch Healthie API (real-time billing, payments)
• 🔧 Self-correct SQL errors automatically
• 📝 Learn what data is missing for future improvements
• ✏️ Update patient profiles in Healthie!

📊 *Query Commands:*
• /patient Andrew Lang - Basic patient info
• /healthie Andrew Lang - Healthie financial data only
• /schema-gaps - See what data is missing
• /refresh-schema - Re-discover database schema
• "Give me all data on Andrew Lang" - FULL data from ALL systems!

✏️ *Update Commands (natural language):*
• "Update address for John Smith to 123 Main St, City, ST 12345"
• "Change phone number for Jane Doe to 555-123-4567"
• "Set email for Bob Wilson to new@email.com"
• "Update DOB for James Lentz to 1985-03-15"

Just ask your question in plain English!`, 'Markdown');
    return;
  }

  // Handle /schema-gaps command - show missing data requests
  if (textLower === '/schema-gaps') {
    let response = '📝 *Schema Gaps & Missing Data Requests*\n\n';

    // Load from file
    try {
      const logPath = path.join(__dirname, '../data/missing-data-requests.json');
      if (fs.existsSync(logPath)) {
        const logged = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
        if (logged.length > 0) {
          const grouped = new Map<string, number>();
          for (const req of logged) {
            grouped.set(req.missingElement, (grouped.get(req.missingElement) || 0) + 1);
          }
          response += '*Columns requested but not found:*\n';
          for (const [col, count] of Array.from(grouped.entries()).sort((a, b) => b[1] - a[1])) {
            response += `• \`${col}\` - requested ${count} time(s)\n`;
          }
        } else {
          response += '_No missing data requests logged yet._';
        }
      } else {
        response += '_No missing data requests logged yet._';
      }
    } catch (e) {
      response += '_Error loading missing data log._';
    }

    // Also show known data gaps from schema discovery
    try {
      const schemaPath = path.join(__dirname, '../data/discovered-schema.json');
      if (fs.existsSync(schemaPath)) {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        if (schema.missingDataSuggestions?.length > 0) {
          response += '\n\n*Known Data Gaps (from schema discovery):*\n';
          for (const suggestion of schema.missingDataSuggestions) {
            response += `• ${suggestion}\n`;
          }
        }
      }
    } catch (e) {
      // Ignore
    }

    response += '\n\n_Run /refresh-schema to re-discover the database structure._';
    await sendMessage(chatId, response, 'Markdown');
    return;
  }

  // Handle /refresh-schema command - re-run schema discovery
  if (textLower === '/refresh-schema') {
    await sendMessage(chatId, '🔄 _Re-discovering database schema... This may take a moment._', 'Markdown');
    try {
      const { execSync } = require('child_process');
      execSync('npx tsx scripts/discover-schema.ts', {
        cwd: '/home/ec2-user/gmhdashboard',
        timeout: 60000
      });
      // Reload the schema
      const newSchema = loadDiscoveredSchema();
      if (newSchema) {
        await sendMessage(chatId, '✅ Schema refreshed! I now have the latest database structure.', 'Markdown');
      } else {
        await sendMessage(chatId, '⚠️ Schema discovery completed but could not reload. Try restarting the bot.', 'Markdown');
      }
    } catch (e: any) {
      await sendMessage(chatId, `❌ Schema refresh failed: ${e.message}`, 'Markdown');
    }
    return;
  }

  // Handle /patient command (case-insensitive)
  if (textLower.startsWith('/patient ')) {
    const query = text.substring('/patient '.length).trim();
    await handlePatientLookup(chatId, query);
    return;
  }

  // Handle /healthie command - fetch financial data directly from Healthie API (case-insensitive)
  if (textLower.startsWith('/healthie ')) {
    const query = text.substring('/healthie '.length).trim();
    console.log(`[Bot] Handling /healthie command for: ${query}`);
    await handleHealthieFinance(chatId, query);
    return;
  }

  // ============================================================================
  // HEALTHIE WRITE COMMANDS: Update patient data via natural language
  // ============================================================================
  // Check if this is an update command (can start with "please" or directly with update/change/set/modify)
  // Examples: "Update gender for John", "Please update John's email", "Can you change John's phone"
  if (textLower.match(/^(please\s+)?(can\s+you\s+)?(update|change|set|modify|edit)\s/)) {
    console.log(`[Bot] Detected potential update command: "${text}"`);
    const wasHandled = await handleHealthieUpdate(chatId, text);
    if (wasHandled) return;
    // If not handled (couldn't parse), fall through to regular query processing
    console.log(`[Bot] Update command not fully parsed, falling through to SQL generation`);
  }

  // ============================================================================
  // SMART DATA FUSION: Detect patient + financial queries and combine sources
  // ============================================================================
  const detectedPatientName = extractPatientName(text);
  const needsFinancialData = isFinancialQuery(text);
  const prevContext = getConversationContext(chatId);
  const isFollowUp = isFollowUpQuery(text);

  console.log(`[Bot] Smart detection: patient="${detectedPatientName}", financial=${needsFinancialData}, followUp=${isFollowUp}`);
  if (isFollowUp && prevContext) {
    console.log(`[Bot] 🔄 Using previous context: "${prevContext.lastQuery}" with ${prevContext.lastResults.length} results`);
  }

  try {
    await sendTyping(chatId);

    // Step 1: Always run Snowflake query for base data
    console.log('[Bot] Generating SQL...');
    const sql = await generateSQL(text, prevContext);
    console.log('[Bot] Generated SQL:', sql);

    const isSql = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i.test(sql);
    if (!isSql) {
      console.log('[Bot] Generated content is not SQL.');
      await sendMessage(chatId, `I generated a text response instead of SQL. I will not execute it as a query.\n\n${sql}`);
      return;
    }

    await sendTyping(chatId);
    console.log('[Bot] Executing Snowflake query (with self-healing)...');
    const { results: snowflakeResults, finalSQL, retryCount } = await executeQueryWithRetry(sql, text, prevContext);
    console.log('[Bot] Got', snowflakeResults.length, 'Snowflake results', retryCount > 0 ? `(after ${retryCount} retries)` : '');

    // Track if we had to fix the SQL
    const sqlWasFixed = retryCount > 0;
    const actualSQL = finalSQL;

    // Step 2: If asking about a specific patient, ALWAYS query Healthie API for complete data
    // This includes addresses, demographics, tags, and financial data not in Snowflake
    let healthieData: any = null;
    if (detectedPatientName) {
      console.log(`[Bot] 🔗 SMART FUSION: Fetching Healthie API data for "${detectedPatientName}" (addresses, demographics, billing)...`);
      await sendTyping(chatId);

      try {
        const healthieUser = await findHealthieUser(detectedPatientName);
        if (healthieUser) {
          const billingItems = await fetchHealthieBillingItems(healthieUser.id);
          const requestedPayments = await fetchHealthieRequestedPayments(detectedPatientName, healthieUser.id);

          // Calculate totals from Healthie
          let totalBillingPaid = 0;
          let totalRequestedPaid = 0;

          for (const item of billingItems) {
            if (item.state === 'succeeded') {
              totalBillingPaid += parseFloat(item.amount_paid || '0');
            }
          }

          for (const rp of requestedPayments) {
            if (rp.status === 'Paid') {
              totalRequestedPaid += parseFloat(rp.price || '0');
            }
          }

          healthieData = {
            user: healthieUser,
            billingItems,
            requestedPayments,
            totalBillingPaid,
            totalRequestedPaid,
            totalPaid: totalBillingPaid, // Don't double count - billing items represent the actual charges
          };

          const hasAddress = healthieUser.locations?.[0]?.line1;
          console.log(`[Bot] ✅ Healthie data: ${billingItems.length} billing items, ${requestedPayments.length} requested payments, $${healthieData.totalPaid.toFixed(2)} total paid, address: ${hasAddress ? 'yes' : 'no'}, gender: ${healthieUser.gender || 'N/A'}`);
        } else {
          console.log(`[Bot] ⚠️ Patient "${detectedPatientName}" not found in Healthie`);
        }
      } catch (e: any) {
        console.error('[Bot] Healthie API error:', e.message);
      }
    }

    // Step 3: Format combined answer
    await sendTyping(chatId);
    console.log('[Bot] Formatting combined answer...');

    let combinedContext = '';
    if (healthieData) {
      // Format address if available
      let addressStr = 'Not on file';
      const loc = healthieData.user.locations?.[0];
      if (loc) {
        const parts = [loc.line1, loc.line2, loc.city, loc.state, loc.zip, loc.country].filter(Boolean);
        addressStr = parts.join(', ') || 'Not on file';
      }

      combinedContext = `

IMPORTANT - LIVE HEALTHIE API DATA (Real-time, authoritative):
- Patient found in Healthie: ${healthieData.user.first_name} ${healthieData.user.last_name} (ID: ${healthieData.user.id})
- Email: ${healthieData.user.email || 'N/A'}
- Phone: ${healthieData.user.phone_number || 'N/A'}
- Gender: ${healthieData.user.gender || 'N/A'}
- DOB: ${healthieData.user.dob || 'N/A'}
- Address: ${addressStr}
- Tags: ${healthieData.user.active_tags?.map((t: any) => t.name).join(', ') || 'None'}

Healthie Billing Items (${healthieData.billingItems.length} total):
${healthieData.billingItems.map((b: any) => `  - ${b.offering?.name || 'Charge'}: $${parseFloat(b.amount_paid || '0').toFixed(2)} (${b.state}) on ${b.created_at?.split(' ')[0] || 'N/A'}`).join('\n') || '  None'}

Healthie Requested Payments (${healthieData.requestedPayments.length} total):
${healthieData.requestedPayments.map((rp: any) => `  - ${rp.offering?.name || 'Payment'}: $${parseFloat(rp.price || '0').toFixed(2)} (${rp.status}) on ${rp.paid_at?.split(' ')[0] || rp.created_at?.split('T')[0] || 'N/A'}`).join('\n') || '  None'}

💰 TOTAL PAID IN HEALTHIE: $${healthieData.totalPaid.toFixed(2)}

NOTE: The Healthie API data above is LIVE and authoritative for demographics/addresses/billing. The Snowflake data below may have additional historical/operational details.
`;
    }

    const answer = await formatAnswer(text, actualSQL, snowflakeResults, combinedContext);

    await sendMessage(chatId, answer);

    if (snowflakeResults.length > 0) {
      let sqlMessage = `\`\`\`sql\n${actualSQL}\n\`\`\``;
      if (sqlWasFixed) {
        sqlMessage = `🔧 _Query self-corrected after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}_\n` + sqlMessage;
      }
      await sendMessage(chatId, sqlMessage, 'Markdown');
    }

    // Save conversation context for follow-up queries
    setConversationContext(chatId, text, actualSQL, snowflakeResults);
    console.log(`[Bot] 💾 Saved context: ${snowflakeResults.length} results for follow-ups`);

    // If we had Healthie data, also mention the data fusion
    if (healthieData) {
      await sendMessage(chatId, `\n🔗 _Data combined from Snowflake + Healthie API for complete view_`, 'Markdown');
    }

  } catch (error: any) {
    console.error('[Bot] Error after all retries:', error);

    // Log missing data requests for future schema improvements
    if (error.message?.includes('invalid identifier')) {
      const match = error.message.match(/invalid identifier '(\w+)'/i);
      if (match) {
        logMissingData(chatId, text, match[1]);
      }
    }

    // Provide a more helpful error message
    let errorMsg = `❌ Error: ${error.message}`;
    if (error.message?.includes('invalid identifier')) {
      errorMsg += `\n\n💡 _The query referenced a column that doesn't exist. I tried to self-correct but couldn't find a working solution._\n\n📝 _This data gap has been logged. Run \`/schema-gaps\` to see what data is missing and how to add it._`;
    }
    await sendMessage(chatId, errorMsg, 'Markdown');
  }
}

async function getUpdates(offset?: number): Promise<any[]> {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
  const params: any = {
    timeout: 5,
    allowed_updates: ["message", "callback_query"]  // CRITICAL: Include callback_query!
  };
  if (offset) params.offset = offset;

  try {
    console.log('[Bot] 🔄 Polling for updates...');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('[Bot] ❌ getUpdates error:', data.description);
    }
    return data.result || [];
  } catch (err: any) {
    console.error('[Bot] ❌ Fetch error in getUpdates:', err.message);
    return [];
  }
}

async function main() {
  console.log('\n🤖 GMH Clinic AI Telegram Bot (V2)');
  console.log('='.repeat(50));

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not configured in .env');
    process.exit(1);
  }

  console.log('\n📡 Connecting to Snowflake (Test)...');
  try {
    const conn = await connectSnowflake();
    await new Promise(resolve => conn.destroy(resolve));
    console.log('✅ Snowflake connection test passed');
  } catch (error) {
    console.error('❌ Snowflake connection failed:', error);
    process.exit(1);
  }

  console.log('\n🟢 Bot is running! Send messages to your bot on Telegram.\n');

  let offset: number | undefined;

  while (true) {
    try {
      const updates = await getUpdates(offset);
      if (updates.length > 0) {
        console.log(`[Bot] 📥 Received ${updates.length} update(s)`);
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        console.log(`[Bot] Processing update ${update.update_id}: ${update.message ? 'message' : update.callback_query ? 'callback_query' : 'other'}`);
        // Handle Message
        if (update.message && update.message.text) {
          const { chat: { id: chatId }, text, from } = update.message;
          const username = from?.username || from?.first_name;

          // Also write text to IPC file for Python scribe (for "Edit with AI" feedback)
          try {
            const approvalDir = '/tmp/telegram_approvals';
            if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

            // Write text response for Python to pick up
            fs.writeFileSync(
              path.join(approvalDir, `text_response_${chatId}.json`),
              JSON.stringify({ text, timestamp: Date.now(), from: username })
            );
            console.log(`[Bot] 💬 Saved text response for IPC: "${text.substring(0, 50)}..."`);
          } catch (err) {
            console.error('[Bot] Failed to save text response IPC:', err);
          }

          handleMessage(chatId, text, username).catch(err => console.error('[Bot] Message handling error:', err));
        }

        // Handle Callback Query (Buttons)
        if (update.callback_query) {
          const cb = update.callback_query;
          const msgId = cb.message?.message_id;
          const action = cb.data;

          if (msgId && action) {
            console.log(`[Bot] 🖱️ Callback received: ${action} for msg ${msgId}`);

            // 1. Acknowledge Telegram
            try {
              await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: cb.id, text: `Processing ${action}...` })
              });
            } catch (err) {
              console.error('[Bot] Failed to answer callback:', err);
            }

            // 2. Write to IPC file for Python script
            try {
              const approvalDir = '/tmp/telegram_approvals';
              if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

              fs.writeFileSync(
                path.join(approvalDir, `${msgId}.json`),
                JSON.stringify({ action, timestamp: Date.now() })
              );
              console.log(`[Bot] 💾 Saved approval status to ${approvalDir}/${msgId}.json`);

              // Optional: Update message to show status
              if (cb.message?.chat?.id) {
                const statusEmoji = action === 'approve' ? '✅ APPROVED' : action === 'reject' ? '❌ REJECTED' : '📝 EDIT REQUESTED';
                await sendMessage(cb.message.chat.id, `Received: ${statusEmoji}`);
              }
            } catch (err) {
              console.error('[Bot] Failed to save approval IPC:', err);
            }
          }
        }
      }
    } catch (error: any) {
      // Intelligently handle polling errors
      const msg = error.message || '';
      if (msg.includes('fetch failed') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
        console.warn(`[Bot] ⚠️ Network error polling Telegram (retrying in 5s): ${msg}`);
      } else {
        console.error('[Bot] Polling error:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down bot...');
  process.exit(0);
});

main().catch(console.error);

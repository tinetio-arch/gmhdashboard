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

// Load environment variables from main .env file
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });

import snowflake from 'snowflake-sdk';
// import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'; // Replaced with Gemini
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
// GEMINI API CLIENT - Replaces AWS Bedrock Claude
// ============================================================================
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

async function callGemini(prompt: string, maxTokens: number = 1000, temperature: number = 0): Promise<string> {
  if (!GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid Gemini response format');
  }

  return data.candidates[0].content.parts[0].text.trim();
}

// ============================================================================
// FUZZY NAME MATCHING - For patient search with name variations
// ============================================================================

// Common name variations/nicknames
const NAME_VARIATIONS: { [key: string]: string[] } = {
  'jennifer': ['jen', 'jenny', 'jenn'],
  'robert': ['rob', 'bob', 'bobby', 'robbie'],
  'william': ['will', 'bill', 'billy', 'willy'],
  'richard': ['rick', 'rich', 'dick', 'ricky'],
  'michael': ['mike', 'mikey', 'mick'],
  'james': ['jim', 'jimmy', 'jamie'],
  'john': ['johnny', 'jon'],
  'joseph': ['joe', 'joey'],
  'thomas': ['tom', 'tommy'],
  'timothy': ['tim', 'timmy'],
  'christopher': ['chris', 'topher'],
  'anthony': ['tony', 'ant'],
  'daniel': ['dan', 'danny'],
  'matthew': ['matt', 'matty'],
  'andrew': ['andy', 'drew'],
  'david': ['dave', 'davey'],
  'steven': ['steve', 'stevie'],
  'stephen': ['steve', 'stevie'],
  'nicholas': ['nick', 'nicky'],
  'jonathan': ['jon', 'johnny'],
  'katherine': ['kate', 'kathy', 'katie', 'kat'],
  'catherine': ['cathy', 'kate', 'katie', 'cat'],
  'elizabeth': ['liz', 'lizzy', 'beth', 'betsy', 'eliza'],
  'margaret': ['maggie', 'meg', 'peggy', 'marge'],
  'patricia': ['pat', 'patty', 'trish'],
  'jessica': ['jess', 'jessie'],
  'stephanie': ['steph', 'stephie'],
  'christina': ['chris', 'christy', 'tina'],
  'rebecca': ['becky', 'becca'],
  'alexandra': ['alex', 'lexi', 'alexa'],
  'samantha': ['sam', 'sammy'],
  'victoria': ['vicky', 'vic', 'tori'],
  'heather': ['heath'],
  'benjamin': ['ben', 'benny'],
  'alexander': ['alex', 'xander'],
  'zachary': ['zach', 'zack'],
  'gregory': ['greg', 'gregg'],
  'edward': ['ed', 'eddie', 'ted', 'teddy'],
  'frederick': ['fred', 'freddy', 'rick'],
  'phillip': ['phil'],
  'patrick': ['pat', 'paddy'],
  'lawrence': ['larry', 'lars'],
  'raymond': ['ray'],
  'gerald': ['gerry', 'jerry'],
  'eugene': ['gene'],
  'theodore': ['ted', 'teddy', 'theo'],
  'ronald': ['ron', 'ronny'],
  'donald': ['don', 'donny'],
  'leonard': ['leo', 'lenny'],
  'harold': ['harry', 'hal'],
  'walter': ['walt', 'wally'],
  'arthur': ['art', 'artie'],
  'albert': ['al', 'bert', 'bertie'],
  'charles': ['charlie', 'chuck', 'chas'],
  'henry': ['hank', 'harry'],
  'francis': ['frank', 'fran'],
  'george': ['georgie'],
  'louis': ['lou', 'louie'],
  'peter': ['pete'],
  'vincent': ['vince', 'vinny'],
  'ann': ['annie', 'anna', 'anne'],
  'susan': ['sue', 'susie', 'suzy'],
  'barbara': ['barb', 'barbie'],
  'nancy': ['nan'],
  'deborah': ['deb', 'debbie'],
  'sharon': ['shari'],
  'donna': ['donnie'],
  'carol': ['carrie'],
  'diane': ['di'],
  'dorothy': ['dot', 'dottie', 'dory'],
  'helen': ['nell', 'nellie'],
  'virginia': ['ginny', 'ginger'],
  'mildred': ['millie', 'milly'],
  'evelyn': ['eve', 'evie'],
  'abigail': ['abby', 'gail'],
  'madeline': ['maddie', 'maddy'],
  'olivia': ['liv', 'livvy'],
  'natalie': ['nat', 'natty'],
  'caroline': ['carol', 'carrie'],
  'allison': ['ally', 'allie'],
  'brittany': ['britt'],
  'kimberly': ['kim', 'kimmie'],
  'melanie': ['mel', 'mellie'],
  'ashley': ['ash'],
  'andrea': ['andie', 'andy'],
  'michelle': ['shelly', 'micki'],
  'jacqueline': ['jackie', 'jacqui'],
  'brenda': ['bren'],
  'angela': ['angie', 'angel'],
  'pamela': ['pam', 'pammie'],
};

// Levenshtein distance for typo tolerance
function levenshtein(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + cost);
    }
  }
  return matrix[b.length][a.length];
}

// Check if two names match with fuzzy matching
function fuzzyNameMatch(searchName: string, patientName: string): boolean {
  const search = searchName.toLowerCase().trim();
  const patient = patientName.toLowerCase().trim();

  // Exact match
  if (patient.includes(search) || search.includes(patient)) return true;

  // Split into first/last name parts
  const searchParts = search.split(/\s+/);
  const patientParts = patient.split(/\s+/);

  // Check each search part against patient parts
  for (const searchPart of searchParts) {
    let matchFound = false;

    for (const patientPart of patientParts) {
      // Direct match
      if (patientPart.includes(searchPart) || searchPart.includes(patientPart)) {
        matchFound = true;
        break;
      }

      // Check name variations (Jennifer = Jen)
      const variations = NAME_VARIATIONS[searchPart] || [];
      const reverseVariations = Object.entries(NAME_VARIATIONS)
        .filter(([_, v]) => v.includes(searchPart))
        .map(([k, _]) => k);

      const allVariations = [...variations, ...reverseVariations];

      if (allVariations.some(v => patientPart.includes(v) || v.includes(patientPart))) {
        matchFound = true;
        break;
      }

      // Levenshtein distance for typos (allow 2 char difference for longer names)
      const maxDist = searchPart.length > 5 ? 2 : 1;
      if (levenshtein(searchPart, patientPart) <= maxDist) {
        matchFound = true;
        break;
      }
    }

    if (!matchFound) return false;
  }

  return true;
}

// ============================================================================
// GEMINI FUNCTION CALLING - For Agentic Tool Use
// ============================================================================

// Tool definitions for Gemini function calling
const AGENTIC_TOOLS = {
  function_declarations: [
    {
      name: "search_patients",
      description: "Search for patients by name, phone number, or email. Returns patient info including IDs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Patient name, phone, or email to search for" }
        },
        required: ["query"]
      }
    },
    {
      name: "get_patient_labs",
      description: "Get the most recent lab results for a patient from Healthie",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "Patient ID or Healthie client ID" }
        },
        required: ["patient_id"]
      }
    },
    {
      name: "send_email",
      description: "Send an email to a patient or staff member",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body content (plain text or HTML)" }
        },
        required: ["to", "subject", "body"]
      }
    },
    {
      name: "create_healthie_task",
      description: "Create a task in Healthie for follow-up actions",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "Healthie client ID" },
          content: { type: "string", description: "Task description" },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format (optional)" }
        },
        required: ["patient_id", "content"]
      }
    }
  ]
};

interface GeminiFunctionCall {
  name: string;
  args: Record<string, any>;
}

interface GeminiToolResponse {
  text?: string;
  functionCall?: GeminiFunctionCall;
}

async function callGeminiWithTools(prompt: string, systemPrompt?: string): Promise<GeminiToolResponse> {
  if (!GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

  const contents: any[] = [];

  // Add system instruction if provided
  if (systemPrompt) {
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "I understand. I will help with clinic operations using the available tools." }] });
  }

  contents.push({ role: "user", parts: [{ text: prompt }] });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      tools: [AGENTIC_TOOLS],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1000
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0]?.content?.parts?.[0];

  if (!candidate) {
    throw new Error('Invalid Gemini response format');
  }

  // Check if Gemini wants to call a function
  if (candidate.functionCall) {
    return {
      functionCall: {
        name: candidate.functionCall.name,
        args: candidate.functionCall.args || {}
      }
    };
  }

  // Otherwise return text response
  return { text: candidate.text?.trim() };
}

// Tool execution handlers
async function executeAgenticTool(toolName: string, args: Record<string, any>): Promise<string> {
  console.log(`[Agentic] Executing tool: ${toolName}`, args);

  switch (toolName) {
    case 'search_patients':
      return await toolSearchPatients(args.query);
    case 'get_patient_labs':
      return await toolGetPatientLabs(args.patient_id);
    case 'send_email':
      return await toolSendEmail(args.to, args.subject, args.body);
    case 'create_healthie_task':
      return await toolCreateHealthieTask(args.patient_id, args.content, args.due_date);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Tool: Search Patients
async function toolSearchPatients(query: string): Promise<string> {
  try {
    const conn = await connectSnowflake();
    const sql = `
      SELECT PATIENT_ID, PATIENT_NAME, EMAIL, PHONE_NUMBER, HEALTHIE_CLIENT_ID, STATUS
      FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW
      WHERE (PATIENT_NAME ILIKE ? OR EMAIL ILIKE ? OR PHONE_NUMBER ILIKE ?)
        AND STATUS = 'Active'
      LIMIT 5
    `;

    const rows: any[] = await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        binds: [`%${query}%`, `%${query}%`, `%${query}%`],
        complete: (err: any, stmt: any, rows: any) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      });
    });

    conn.destroy(() => { });

    if (rows.length === 0) {
      return JSON.stringify({ found: false, message: `No patients found matching "${query}"` });
    }

    return JSON.stringify({ found: true, patients: rows });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

// Tool: Get Patient Labs (from Healthie)
async function toolGetPatientLabs(patientId: string): Promise<string> {
  try {
    // First get the Healthie client ID from our database
    const conn = await connectSnowflake();
    const sql = `
      SELECT HEALTHIE_CLIENT_ID 
      FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW 
      WHERE PATIENT_ID = ? OR HEALTHIE_CLIENT_ID = ?
      LIMIT 1
    `;

    const rows: any[] = await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        binds: [patientId, patientId],
        complete: (err: any, stmt: any, rows: any) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      });
    });
    conn.destroy(() => { });

    const healthieId = rows[0]?.HEALTHIE_CLIENT_ID;
    if (!healthieId) {
      return JSON.stringify({ error: "Patient not found or no Healthie ID linked" });
    }

    // Query Healthie for lab orders
    const labQuery = `
      query GetLabOrders($user_id: ID!) {
        labOrders(user_id: $user_id, per_page: 5) {
          id
          created_at
          status
          lab { name }
          document { display_name }
        }
      }
    `;

    const labData = await fetchHealthieGraphQL<any>(labQuery, { user_id: healthieId });

    if (!labData?.labOrders?.length) {
      return JSON.stringify({ message: "No lab orders found for this patient" });
    }

    return JSON.stringify({ labs: labData.labOrders });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

// Tool: Send Email via AWS SES
async function toolSendEmail(to: string, subject: string, body: string): Promise<string> {
  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-2' });

    const command = new SendEmailCommand({
      Source: process.env.SES_FROM_EMAIL || 'noreply@nowoptimal.com',
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: body },
          Html: { Data: body.replace(/\n/g, '<br>') }
        }
      }
    });

    await ses.send(command);
    return JSON.stringify({ success: true, message: `Email sent to ${to}` });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

// Tool: Create Healthie Task
async function toolCreateHealthieTask(patientId: string, content: string, dueDate?: string): Promise<string> {
  try {
    const mutation = `
      mutation CreateTask($user_id: ID!, $content: String!, $due_date: String) {
        createTask(input: {
          user_id: $user_id
          content: $content
          due_date: $due_date
        }) {
          task {
            id
            content
            due_date
          }
          messages { field message }
        }
      }
    `;

    const result = await fetchHealthieGraphQL<any>(mutation, {
      user_id: patientId,
      content,
      due_date: dueDate
    });

    if (result?.createTask?.messages?.length) {
      return JSON.stringify({ error: result.createTask.messages });
    }

    return JSON.stringify({ success: true, task: result?.createTask?.task });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

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

// Bedrock client - now using Gemini instead
// const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2' });

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
      users(keywords: $keywords, active_status: "Active", page_size: 10) {
        id
        email
        first_name
        last_name
        phone_number
        gender
        dob
        active
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
  // CRITICAL: Filter to only EXPLICITLY active users - Healthie API bug ignores active_status with keywords
  // Must check active === true (not just !== false) because archived users may have active: null/undefined
  const activeUsers = (data?.users || []).filter((u: any) => u.active === true);
  return activeUsers[0] || null;
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
  // Base configuration
  const connectionConfig: any = {
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER || process.env.SNOWFLAKE_USERNAME!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    database: process.env.SNOWFLAKE_DATABASE!,
    schema: process.env.SNOWFLAKE_SCHEMA
  };

  const privateKeyPath = '/home/ec2-user/.snowflake/rsa_key_new.p8';
  // No passphrase for unencrypted key

  // Check if private key exists for key-pair auth
  if (fs.existsSync(privateKeyPath)) {
    try {
      console.log('[Snowflake] Found private key file at:', privateKeyPath);
      const privateKeyVal = fs.readFileSync(privateKeyPath, 'utf8');

      // Use key-pair authentication
      connectionConfig.authenticator = 'SNOWFLAKE_JWT';
      connectionConfig.privateKey = privateKeyVal;
      // No passphrase needed for unencrypted key

      // EXPLICITLY ensure no password is set
      delete connectionConfig.password;

      console.log('[Snowflake] configured for Key-Pair Authentication');
    } catch (e) {
      console.error('[Snowflake] Error reading private key:', e);
      // Fallback
      connectionConfig.password = process.env.SNOWFLAKE_PASSWORD!;
    }
  } else {
    // Fall back to password auth
    connectionConfig.password = process.env.SNOWFLAKE_PASSWORD!;
    console.log('[Snowflake] Using Password Authentication');
  }

  // Debug log (sanitized)
  const debugConfig = { ...connectionConfig };
  if (debugConfig.password) debugConfig.password = '***';
  if (debugConfig.privateKey) debugConfig.privateKey = '***';
  if (debugConfig.privateKeyPass) debugConfig.privateKeyPass = '***';
  console.log('[Snowflake] Connection Config:', JSON.stringify(debugConfig));

  const conn = snowflake.createConnection(connectionConfig);

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
5. ALWAYS use "GMH_CLINIC" (with underscore) for the database name. NEVER use "GMHCLINIC".
6. ALWAYS use "PATIENT_DATA" and "FINANCIAL_DATA" (with underscores). NEVER use "PATIENTDATA" or "FINANCIALDATA".

Generate a Snowflake SQL query to answer this question.
${contextHint ? 'IMPORTANT: This is a follow-up question - keep the same patient/filter context from the previous query!' : ''}`;

  // Use Gemini instead of Bedrock
  let result = await callGemini(prompt, 1000, 0);

  // Remove markdown code blocks
  result = result.replace(/```sql\n?|\n?```/g, '');

  // Extract just the SQL if AI added explanatory text before it
  // Look for SQL keywords at start of a line
  const sqlMatch = result.match(/^(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b[\s\S]*/im);
  if (sqlMatch) {
    result = sqlMatch[0].trim();
  }

  // FIX HALLUCINATED SCHEMA NAMES - Claude keeps dropping underscores
  result = result.replace(/GMHCLINIC\./gi, 'GMH_CLINIC.');
  result = result.replace(/\.PATIENTDATA\./gi, '.PATIENT_DATA.');
  result = result.replace(/\.FINANCIALDATA\./gi, '.FINANCIAL_DATA.');
  result = result.replace(/\.INTEGRATIONLOGS\./gi, '.INTEGRATION_LOGS.');

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
- ALWAYS use "GMH_CLINIC" (with underscore) for the database name. NEVER use "GMHCLINIC".
- ALWAYS use "PATIENT_DATA" and "FINANCIAL_DATA" (with underscores). NEVER use "PATIENTDATA" or "FINANCIALDATA".

Generate ONLY the corrected SQL query. No explanations.`;

  // Use Gemini instead of Bedrock
  let result = await callGemini(prompt, 1000, 0);

  // Remove markdown code blocks
  result = result.replace(/```sql\n?|\n?```/g, '');

  // Extract just the SQL if AI added explanatory text before it
  const sqlMatch = result.match(/^(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b[\s\S]*/im);
  if (sqlMatch) {
    result = sqlMatch[0].trim();
  }

  // FIX HALLUCINATED SCHEMA NAMES - Claude keeps dropping underscores
  result = result.replace(/GMHCLINIC\./gi, 'GMH_CLINIC.');
  result = result.replace(/\.PATIENTDATA\./gi, '.PATIENT_DATA.');
  result = result.replace(/\.FINANCIALDATA\./gi, '.FINANCIAL_DATA.');
  result = result.replace(/\.INTEGRATIONLOGS\./gi, '.INTEGRATION_LOGS.');

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
  const prompt = `You are a clinic data assistant. Answer BRIEFLY.

Question: ${question}
${additionalContext}
SQL Used: ${sql}

Results: ${JSON.stringify(results, null, 2)}

RULES:
1. Be EXTREMELY BRIEF - 1-3 sentences max
2. Just state the key numbers/facts directly
3. NO emojis, NO filler phrases, NO explanations of what the query does
4. If showing patient names, just list them
5. When asked "who were my patients" after a previous question, relate it to that context

BAD: "Based on the data provided, the clinic generated a total of $480.00 in revenue from..."
GOOD: "Last week: $480 revenue from 4 payments."

BAD: "Here's a summary of the key findings from the inventory data..."
GOOD: "Testosterone inventory: 14 Carrie Boyd vials (419ml), 33 TopRX vials (330ml)."`;

  return await callGemini(prompt, 300, 0.1);
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

// ========== HELPER: Build full session keyboard (module scope) ==========
function buildSessionKeyboard(sessionId: string, sessionData: any): any[][] {
  const pi = sessionData.classification?.patient_identification;
  // Only trust patient_id if manually assigned OR not flagged for manual verification
  const patientId = pi?.patient_id && (!pi?.requires_manual_verification || pi?.manually_assigned) ? pi.patient_id : null;
  const docs = sessionData.documents || {};
  const selectedTypes: string[] = sessionData.selected_types || ['soap_note'];
  const buttonRows: any[][] = [];

  const docLabelsMap: Record<string, string> = {
    'work_note': 'Work Note',
    'school_note': 'School Note',
    'discharge_instructions': 'Discharge',
    'care_plan': 'Care Plan'
  };

  // Row 1: View and Edit
  buttonRows.push([
    { text: "📄 View Full SOAP", callback_data: `view_soap_${sessionId}` },
    { text: "✏️ Edit via AI", callback_data: `edit_help_${sessionId}` }
  ]);

  // Row 2: Add buttons for docs not yet generated
  const addRow: any[] = [];
  if (!docs.work_note) addRow.push({ text: "➕ Work Note", callback_data: `add_work_note_${sessionId}` });
  if (!docs.school_note) addRow.push({ text: "➕ School Note", callback_data: `add_school_note_${sessionId}` });
  if (addRow.length) buttonRows.push(addRow);

  const addRow2: any[] = [];
  if (!docs.discharge_instructions) addRow2.push({ text: "➕ Discharge", callback_data: `add_discharge_${sessionId}` });
  if (!docs.care_plan) addRow2.push({ text: "➕ Care Plan", callback_data: `add_care_plan_${sessionId}` });
  if (addRow2.length) buttonRows.push(addRow2);

  // Row 3: Toggle generated docs — ✅ = selected for upload, ❌ = skipped + 👁️ View
  for (const [docKey, docLabel] of Object.entries(docLabelsMap)) {
    if (docs[docKey]) {
      const isSelected = selectedTypes.includes(docKey);
      const icon = isSelected ? '✅' : '❌';
      buttonRows.push([
        { text: `${icon} ${docLabel}`, callback_data: `toggle_${docKey}_${sessionId}` },
        { text: `👁️ View`, callback_data: `view_doc_${docKey}_${sessionId}` }
      ]);
    }
  }

  // Row 4: Change Patient
  buttonRows.push([
    { text: "🔄 Change Patient", callback_data: `change_patient_${sessionId}` }
  ]);

  // Row 5: Confirm & Send / Discard
  if (patientId) {
    buttonRows.push([
      { text: "🚀 Confirm & Send", callback_data: `confirm_send_${sessionId}` },
      { text: "🗑️ Discard", callback_data: `reject_${sessionId}` }
    ]);
  } else {
    buttonRows.push([
      { text: "⚠️ SELECT PATIENT FIRST", callback_data: `change_patient_${sessionId}` }
    ]);
    buttonRows.push([
      { text: "🗑️ Discard", callback_data: `reject_${sessionId}` }
    ]);
  }

  // Row 6: Pending Sessions
  buttonRows.push([
    { text: "📋 Pending Sessions", callback_data: "pending_sessions" }
  ]);

  return buttonRows;
}

async function handleMessage(chatId: number, text: string, username?: string) {
  console.log(`[Bot] Message from ${username} (${chatId}): ${text}`);

  if (AUTHORIZED_CHAT_IDS.length > 0 && !AUTHORIZED_CHAT_IDS.includes(chatId)) {
    await sendMessage(chatId, '⛔ You are not authorized to use this bot.');
    return;
  }

  // CHECK FOR PENDING PATIENT SEARCH (from Change Patient button)
  const pendingSearchFile = `/tmp/telegram_approvals/pending_patient_search_${chatId}.json`;
  if (fs.existsSync(pendingSearchFile)) {
    console.log(`[Bot] Pending patient search found for ${chatId}, processing: ${text}`);

    try {
      console.log(`[Bot] Step 1: Reading pending file ${pendingSearchFile}`);
      const pendingData = JSON.parse(fs.readFileSync(pendingSearchFile, 'utf8'));
      const sessionId = pendingData.session_id;
      console.log(`[Bot] Step 2: Got session ID ${sessionId}`);

      // Search for patient in Healthie (ACTIVE patients only)
      const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
      console.log(`[Bot] Step 3: HEALTHIE_API_KEY: ${HEALTHIE_API_KEY ? 'SET' : 'NOT SET'}`);

      const searchQuery = `
        query SearchPatients($keyword: String) {
          users(keywords: $keyword, active_status: "Active", sort_by: "last_name_asc", should_paginate: false) {
            id
            first_name
            last_name
            dob
            email
            active
          }
        }
      `;

      console.log(`[Bot] Step 4: Calling Healthie API for "${text}"...`);

      const searchResponse = await fetch('https://api.gethealthie.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${HEALTHIE_API_KEY}`,
          'Content-Type': 'application/json',
          'AuthorizationSource': 'API'
        },
        body: JSON.stringify({ query: searchQuery, variables: { keyword: text } })
      });

      console.log(`[Bot] Step 5: Got Healthie response, status=${searchResponse.status}`);

      const searchResult: any = await searchResponse.json();
      console.log(`[Bot] Healthie search response for "${text}": status=${searchResponse.status}, patients=${searchResult.data?.users?.length || 0}, errors=${JSON.stringify(searchResult.errors || null)}`);

      const patients = searchResult.data?.users || [];

      // Filter by name match AND active status (Healthie keyword search ignores active_status filter!)
      const filtered = patients.filter((p: any) => {
        // CRITICAL: Must check active field - Healthie API bug ignores active_status with keywords
        // Use strict === true check: archived patients may have active: null/undefined (not just false)
        if (p.active !== true) return false;

        const fullName = `${p.first_name || ''} ${p.last_name || ''}`;
        // Use fuzzy matching for name variations (Jennifer = Jen, etc)
        return fuzzyNameMatch(text, fullName);
      });

      // Deduplicate by Healthie user ID (archived+unarchived copies may both appear)
      const seenIds = new Set<string>();
      const deduped = filtered.filter((p: any) => {
        if (seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        return true;
      }).slice(0, 5); // Limit to 5 results

      console.log(`[Bot] Filtered to ${deduped.length} active matches (${filtered.length} before dedup) for "${text}"`);

      if (deduped.length === 0) {
        await sendMessage(chatId, `⚠️ No active patients found matching "${text}".\n\nType another name to search, or use /sessions to go back.`);
        // Keep pending file so user can try again
        return;
      }

      // Build selection buttons (callback_data must be <= 64 bytes for Telegram!)
      const buttons: any[] = [];
      for (const p of deduped) {
        const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        const dob = p.dob ? ` (${p.dob})` : '';
        // Use short prefix 'sp_' and no name to stay under 64 bytes
        const callbackData = `sp_${sessionId}_${p.id}`;
        console.log(`[Bot] Button callback_data: ${callbackData} (${callbackData.length} bytes)`);
        buttons.push([{
          text: `${name}${dob}`,
          callback_data: callbackData
        }]);
      }
      buttons.push([{ text: '❌ Cancel', callback_data: 'cancel_patient_search' }]);

      console.log(`[Bot] Sending patient selection to Telegram for ${deduped.length} patients`);

      const sendResponse = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🔍 Found ${deduped.length} patient(s) matching "${text}":\n\nSelect the correct patient:`,
          reply_markup: { inline_keyboard: buttons }
        })
      });

      const sendResult = await sendResponse.json();
      if (!sendResult.ok) {
        console.error(`[Bot] ❌ Telegram sendMessage failed:`, JSON.stringify(sendResult));
        // Try without inline keyboard in case that's the issue
        await sendMessage(chatId, `❌ Failed to show patient buttons. Error: ${sendResult.description}. Try /sessions and search again.`);
      } else {
        console.log(`[Bot] ✅ Patient selection sent successfully`);
      }

      // Remove pending file after showing results (user will select)
      fs.unlinkSync(pendingSearchFile);

    } catch (err: any) {
      console.error('[Bot] Error in patient search:', err);
      await sendMessage(chatId, `❌ Error searching patients: ${err?.message || err}`);
      fs.unlinkSync(pendingSearchFile);
    }
    return;
  }

  // CHECK FOR ACTIVE EDIT MODE (from Edit via AI button)
  const activeEditFile = `/tmp/telegram_approvals/active_edit_${chatId}.json`;
  if (fs.existsSync(activeEditFile) && !text.startsWith('/')) {
    console.log(`[Bot] ✏️ Edit mode active for ${chatId}, applying edit: "${text}"`);
    try {
      const editData = JSON.parse(fs.readFileSync(activeEditFile, 'utf8'));
      const sessionId = editData.session_id;
      const documentType = editData.document_type || 'soap_note'; // Track which document to edit
      const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;

      if (!fs.existsSync(sessionFile)) {
        await sendMessage(chatId, '⚠️ Session not found. Edit mode cancelled.');
        fs.unlinkSync(activeEditFile);
        return;
      }

      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      const currentDoc = sessionData.documents?.[documentType] || '';
      const patientName = sessionData.patient_name || 'Patient';

      const docTypeLabels: Record<string, string> = {
        'soap_note': 'SOAP note',
        'discharge_instructions': 'Discharge Instructions',
        'work_note': 'Work Excuse Note',
        'school_note': 'School Excuse Note',
        'care_plan': 'Care Plan'
      };
      const docLabel = docTypeLabels[documentType] || documentType;

      await sendMessage(chatId, `⏳ Applying edit to ${patientName}'s ${docLabel}...`);

      // Use Gemini to apply the edit intelligently
      const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
      if (!GEMINI_API_KEY) {
        await sendMessage(chatId, '❌ Gemini API key not configured.');
        fs.unlinkSync(activeEditFile);
        return;
      }

      const editPrompt = `You are editing a medical document (${docLabel}). Apply the following edit instruction to the document below. Return ONLY the complete updated document with the edit applied. Do not add any commentary, explanations, or markdown formatting around the document itself — just return the full updated document.

EDIT INSTRUCTION: ${text}

CURRENT ${docLabel.toUpperCase()}:
${currentDoc}`;

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: editPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
          })
        }
      );

      const geminiResult: any = await geminiResponse.json();
      console.log(`[Bot] Edit Gemini response status: ${geminiResponse.status}`);
      const updatedDoc = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!updatedDoc) {
        console.error('[Bot] Edit failed - Gemini response:', JSON.stringify(geminiResult).substring(0, 500));
        await sendMessage(chatId, '❌ Failed to generate edit. Please try again.');
        return;
      }

      // Save the updated document (correct type)
      sessionData.documents[documentType] = updatedDoc;
      sessionData.updated_at = new Date().toISOString();
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

      // Clear edit mode
      fs.unlinkSync(activeEditFile);

      // Confirm edit and show keyboard
      const preview = updatedDoc.length > 800 ? updatedDoc.substring(0, 800) + '...' : updatedDoc;
      const keyboard = { inline_keyboard: buildSessionKeyboard(sessionId, sessionData) };

      // Send without parse_mode since SOAP content has markdown chars that break Telegram's parser
      const sendResult = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `✅ ${docLabel} Updated for ${patientName}\n\n${preview}`,
          reply_markup: keyboard
        })
      });
      const sendResultJson: any = await sendResult.json();
      if (!sendResultJson.ok) {
        console.error('[Bot] Edit confirmation send failed:', JSON.stringify(sendResultJson));
      }

      console.log(`[Bot] ✅ Edit applied to ${documentType} in session ${sessionId} for ${patientName}`);
    } catch (err: any) {
      console.error('[Bot] Edit mode error:', err);
      await sendMessage(chatId, `❌ Error applying edit: ${err?.message || err}`);
      try { fs.unlinkSync(activeEditFile); } catch { }
    }
    return;
  }

  // CHECK FOR SCRIBE LOCK (Collision Avoidance)
  // BUT: Allow slash commands to bypass scribe lock - they should be handled by bot
  const lockFile = `/tmp/scribe_lock_${chatId}`;
  const isSlashCommand = text.startsWith('/');

  if (fs.existsSync(lockFile) && !isSlashCommand) {
    console.log(`[Bot] Scribe lock active for ${chatId}. Forwarding message to Scribe...`);

    const responseDir = "/tmp/telegram_approvals";
    if (!fs.existsSync(responseDir)) fs.mkdirSync(responseDir);

    fs.writeFileSync(
      path.join(responseDir, `text_response_${chatId}.json`),
      JSON.stringify({ text, timestamp: Date.now() })
    );
    return; // Stop processing - let Scribe handle it
  } else if (fs.existsSync(lockFile) && isSlashCommand) {
    console.log(`[Bot] Scribe lock active but allowing slash command: ${text}`);
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

🤖 *Agentic AI Commands (NEW!):*
• /agent find John Smith - Search patients
• /agent get labs for John Smith - Get lab results
• /agent send John Smith his latest lab results - Multi-step action!
• /agent create task for John: call to follow up

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

  // Handle /agent command - Agentic AI with function calling
  if (textLower.startsWith('/agent ')) {
    const query = text.substring('/agent '.length).trim();
    console.log(`[Bot] 🤖 Agentic query: "${query}"`);
    await sendTyping(chatId);

    try {
      const systemPrompt = `You are an AI assistant for a men's health clinic. You have access to tools for:
- Searching patients (by name, phone, email)
- Getting patient lab results from Healthie
- Sending emails via AWS SES
- Creating tasks in Healthie

When a user asks you to do something, use the appropriate tool. For multi-step tasks, you may need to call multiple tools.
Always confirm what you're doing before sending emails.`;

      // First call - get tool selection from Gemini
      let response = await callGeminiWithTools(query, systemPrompt);
      let maxIterations = 5;
      let iteration = 0;
      let conversationLog = `🤖 *Agentic AI Processing*\n\nQuery: "${query}"\n\n`;

      // Execute tools in a loop until Gemini returns text (done)
      while (response.functionCall && iteration < maxIterations) {
        iteration++;
        const { name, args } = response.functionCall;
        conversationLog += `*Step ${iteration}:* Calling \`${name}\`\n`;

        // Execute the tool
        console.log(`[Agentic] Step ${iteration}: Executing ${name}`, args);
        const toolResult = await executeAgenticTool(name, args);
        console.log(`[Agentic] Tool result:`, toolResult.substring(0, 200));

        // Send tool result back to Gemini for next step
        const followUpPrompt = `Tool "${name}" returned: ${toolResult}\n\nBased on this result, what should I do next? If the task is complete, provide a summary for the user.`;
        response = await callGeminiWithTools(followUpPrompt, systemPrompt);
      }

      // Send final response
      if (response.text) {
        conversationLog += `\n*Result:*\n${response.text}`;
      } else if (response.functionCall) {
        conversationLog += `\n⚠️ Max iterations reached. Last tool: ${response.functionCall.name}`;
      }

      await sendMessage(chatId, conversationLog, 'Markdown');

    } catch (error: any) {
      console.error('[Agentic] Error:', error);
      await sendMessage(chatId, `❌ Agentic error: ${error.message}`);
    }
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
          const { chat: { id: chatId }, text, from, reply_to_message } = update.message;
          const username = from?.username || from?.first_name;

          // Also write text to IPC file for Python scribe (for "Edit with AI" feedback)
          try {
            const approvalDir = '/tmp/telegram_approvals';
            if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

            // 1. Write generic latest text response (fallback)
            fs.writeFileSync(
              path.join(approvalDir, `text_response_${chatId}.json`),
              JSON.stringify({ text, timestamp: Date.now(), from: username })
            );

            // 2. Write specific REPLY response if applicable
            if (reply_to_message) {
              const replyId = reply_to_message.message_id;
              fs.writeFileSync(
                path.join(approvalDir, `${replyId}_text.json`),
                JSON.stringify({ text, timestamp: Date.now(), from: username, action: text })
                // 'action' key for compatibility with existing generic readers expecting generic json
              );
              console.log(`[Bot] 💬 Saved REPLY for msg ${replyId}: "${text.substring(0, 30)}..."`);
            }

            console.log(`[Bot] 💬 Saved text response for IPC`);
          } catch (err) {
            console.error('[Bot] Failed to save text response IPC:', err);
          }
          // ========== SCRIBE SESSIONS COMMAND ==========
          if (text.toLowerCase().startsWith('/session')) {
            console.log('[Bot] 📋 /sessions command - handling directly');
            const sessionsDir = '/tmp/scribe_sessions';
            try {
              if (!fs.existsSync(sessionsDir)) {
                await sendMessage(chatId, '📋 No pending sessions.');
                continue;
              }
              const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
              const sessions: any[] = [];
              const submittedToday: any[] = [];
              const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

              for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                if (Number(data.chat_id) !== Number(chatId)) continue;

                if (data.status === 'SUBMITTED' || data.status === 'SENT') {
                  // Show recent submitted sessions as reopenable (last 7 days)
                  const createdDate = (data.created_at || '').slice(0, 10);
                  if (createdDate >= sevenDaysAgo) {
                    submittedToday.push(data);
                  }
                  continue;
                }
                if (data.status === 'DISCARDED') continue;
                sessions.push(data);
              }
              sessions.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
              submittedToday.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));

              if (sessions.length === 0 && submittedToday.length === 0) {
                await sendMessage(chatId, '📋 No pending sessions.\n\nAll patient visits have been completed or discarded.');
              } else {
                let msg = '';
                const buttons: any[][] = [];

                if (sessions.length > 0) {
                  msg += '📋 *PENDING SCRIBE SESSIONS*\n\nTap to switch:\n\n';
                  for (const s of sessions.slice(0, 10)) {
                    const patientId = s.classification?.patient_identification?.patient_id || s.patient_id;
                    const icon = patientId ? '🟡' : '🔴';
                    const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '?';
                    msg += `${icon} *${s.patient_name}* (${time}) - ${s.status}\n`;
                    buttons.push([{ text: `${icon} ${s.patient_name} (${time})`, callback_data: `switch_session_${s.session_id}` }]);
                  }
                }

                if (submittedToday.length > 0) {
                  msg += '\n✅ *RECENTLY SUBMITTED* (tap to reopen & edit):\n\n';
                  for (const s of submittedToday.slice(0, 5)) {
                    const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '?';
                    msg += `✅ *${s.patient_name}* (${time})\n`;
                    buttons.push([{ text: `🔄 Reopen ${s.patient_name} (${time})`, callback_data: `reopen_${s.session_id}` }]);
                  }
                }

                buttons.push([{ text: '🔙 Back', callback_data: 'cancel_pending' }]);
                await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: buttons }
                  })
                });
              }
            } catch (err) {
              console.error('[Bot] Error listing sessions:', err);
              await sendMessage(chatId, '❌ Error listing sessions.');
            }
            continue;
          }

          handleMessage(chatId, text, username).catch(err => console.error('[Bot] Message handling error:', err));
        }

        // buildSessionKeyboard is defined at module scope (above handleMessage)

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
                // Don't spam chat for toggle actions or confirm_final_send
                if (!action.startsWith('toggle_') && !action.startsWith('confirm_final_send') && !action.startsWith('reopen_')) {
                  let statusEmoji = '📝 PROCESSING';
                  if (action === 'approve' || action.startsWith('confirm_send')) {
                    statusEmoji = '✅ REVIEWING';
                  } else if (action === 'reject' || action.startsWith('reject_')) {
                    statusEmoji = '❌ REJECTED';
                  } else if (action.startsWith('view_soap')) {
                    statusEmoji = '📄 VIEWING SOAP';
                  } else if (action.startsWith('add_')) {
                    statusEmoji = `➕ ADDING ${action.replace('add_', '').split('_')[0].toUpperCase()}`;
                  } else if (action.startsWith('edit_help')) {
                    statusEmoji = '✏️ EDIT MODE';
                  }
                  await sendMessage(cb.message.chat.id, `Received: ${statusEmoji}`);
                }

                // ========== TOGGLE DOCUMENT SELECTION ==========
                if (action.startsWith('toggle_')) {
                  // Parse: toggle_{docType}_{sessionId}
                  const toggleParts = action.replace('toggle_', '').split('_');
                  // Session ID is everything after the doc type. Doc types: work_note, school_note, discharge_instructions, care_plan
                  let toggleDocType = '';
                  let toggleSessionId = '';
                  for (const dt of ['discharge_instructions', 'work_note', 'school_note', 'care_plan']) {
                    if (action.startsWith(`toggle_${dt}_`)) {
                      toggleDocType = dt;
                      toggleSessionId = action.replace(`toggle_${dt}_`, '');
                      break;
                    }
                  }

                  if (toggleDocType && toggleSessionId) {
                    try {
                      const sessionFile = `/tmp/scribe_sessions/${toggleSessionId}.json`;
                      if (fs.existsSync(sessionFile)) {
                        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                        if (!sessionData.selected_types) sessionData.selected_types = ['soap_note'];

                        const idx = sessionData.selected_types.indexOf(toggleDocType);
                        if (idx >= 0) {
                          sessionData.selected_types.splice(idx, 1);
                          console.log(`[Bot] ❌ Deselected ${toggleDocType} for session ${toggleSessionId}`);
                        } else {
                          sessionData.selected_types.push(toggleDocType);
                          console.log(`[Bot] ✅ Selected ${toggleDocType} for session ${toggleSessionId}`);
                        }

                        sessionData.updated_at = new Date().toISOString();
                        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

                        // Refresh keyboard with updated selection state
                        const toggleKeyboard = { inline_keyboard: buildSessionKeyboard(toggleSessionId, sessionData) };
                        const selectedCount = sessionData.selected_types.length;
                        await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            chat_id: cb.message.chat.id,
                            text: `📋 ${selectedCount} document(s) selected for upload`,
                            reply_markup: toggleKeyboard
                          })
                        });
                      }
                    } catch (err: any) {
                      console.error('[Bot] Toggle error:', err);
                    }
                  }
                  continue;
                }

                // ========== REOPEN SUBMITTED SESSION ==========
                if (action.startsWith('reopen_')) {
                  const reopenSessionId = action.replace('reopen_', '');
                  console.log(`[Bot] 🔄 Reopening submitted session: ${reopenSessionId}`);
                  const sessionFile = `/tmp/scribe_sessions/${reopenSessionId}.json`;
                  try {
                    if (fs.existsSync(sessionFile)) {
                      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                      // Keep chart_note_id for smart resubmit (updateFormAnswerGroup)
                      sessionData.status = 'REOPENED';
                      sessionData.reopened_at = new Date().toISOString();
                      sessionData.updated_at = new Date().toISOString();
                      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

                      const patientName = sessionData.patient_name || 'Unknown';
                      const soapNote = sessionData.documents?.soap_note || 'No SOAP note';
                      const preview = soapNote.length > 500 ? soapNote.substring(0, 500) + '...' : soapNote;

                      const keyboard = { inline_keyboard: buildSessionKeyboard(reopenSessionId, sessionData) };

                      await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: `🔄 **Session Reopened: ${patientName}**\n\nChart Note ID: ${sessionData.chart_note_id || 'N/A'}\n(Resubmit will UPDATE the existing note)\n\n${preview}`,
                          parse_mode: 'Markdown',
                          reply_markup: keyboard
                        })
                      });
                      console.log(`[Bot] ✅ Session ${reopenSessionId} reopened (chart_note_id: ${sessionData.chart_note_id})`);
                    } else {
                      await sendMessage(cb.message.chat.id, '⚠️ Session file not found.');
                    }
                  } catch (err: any) {
                    console.error('[Bot] Reopen error:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error reopening session: ${err?.message || err}`);
                  }
                  continue;
                }

                // ========== SWITCH SESSION CALLBACK ==========
                if (action.startsWith('switch_session_')) {
                  const sessionId = action.replace('switch_session_', '');
                  console.log(`[Bot] 🔄 Switching to session: ${sessionId}`);
                  const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                  try {
                    if (fs.existsSync(sessionFile)) {
                      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                      const patientName = sessionData.patient_name || 'Unknown';
                      const patientId = sessionData.classification?.patient_identification?.patient_id;
                      const soapNote = sessionData.documents?.soap_note || 'No SOAP note available';
                      const statusIcon = patientId ? '🟡 READY' : '🔴 UNKNOWN';

                      // Build full button set like Python scribe
                      const preview = soapNote.length > 500 ? soapNote.substring(0, 500) + '...' : soapNote;
                      const hasWorkNote = sessionData.documents?.work_note;
                      const hasSchoolNote = sessionData.documents?.school_note;
                      const hasDischarge = sessionData.documents?.discharge_instructions;
                      const hasCarePlan = sessionData.documents?.care_plan;

                      const buttonRows = buildSessionKeyboard(sessionId, sessionData);
                      const buttons = { inline_keyboard: buttonRows };
                      // Send without parse_mode to avoid markdown conflicts with SOAP content
                      const response = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: `📋 ${patientName} (${statusIcon})\n\n${preview}`,
                          reply_markup: buttons
                        })
                      });
                      const result = await response.json();
                      if (!result.ok) {
                        console.error('[Bot] Telegram API error:', result);
                      }
                    } else {
                      await sendMessage(cb.message.chat.id, `❌ Session not found: ${sessionId}`);
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error switching session:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error loading session: ${err?.message || err}`);
                  }
                }

                // ========== SCRIBE LOCK CHECK FOR DIRECT HANDLERS ==========
                // If Python scribe is actively running (scribe_lock exists), let IT handle these callbacks
                // TypeScript only handles these for ORPHANED sessions (no scribe_lock)
                const scribeLockFile = `/tmp/scribe_lock_${cb.message.chat.id}`;
                const scribeLockExists = fs.existsSync(scribeLockFile);

                if (scribeLockExists) {
                  console.log(`[Bot] Scribe lock exists - skipping TS handlers, letting Python handle: ${action}`);
                  // Don't process - Python scribe will handle via its approval loop
                  continue;
                }

                // ========== CHANGE PATIENT CALLBACK (Direct Handling for ORPHANED sessions) ==========
                if (action === 'change_patient' || action.startsWith('change_patient_')) {
                  const callbackSessionId = action.startsWith('change_patient_') ? action.replace('change_patient_', '') : null;
                  console.log(`[Bot] 🔄 Change patient requested for chat ${cb.message.chat.id}, sessionId: ${callbackSessionId || 'auto-detect'}`);
                  try {
                    const sessionsDir = '/tmp/scribe_sessions';
                    let targetSessionId = callbackSessionId || '';

                    // If no session ID provided, find latest active session (fallback)
                    if (!targetSessionId && fs.existsSync(sessionsDir)) {
                      let latestTime = 0;
                      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                      for (const file of files) {
                        try {
                          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                          if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                            data.status !== 'SENT' && data.status !== 'DISCARDED' && data.status !== 'SUBMITTED') {
                            const sessionTime = new Date(data.created_at || data.updated_at || 0).getTime();
                            if (sessionTime > latestTime) {
                              latestTime = sessionTime;
                              targetSessionId = data.session_id;
                            }
                          }
                        } catch (e) { /* skip invalid files */ }
                      }
                    }

                    if (targetSessionId) {
                      // Save pending patient search state
                      const approvalDir = '/tmp/telegram_approvals';
                      if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

                      const pendingFile = path.join(approvalDir, `pending_patient_search_${cb.message.chat.id}.json`);
                      fs.writeFileSync(pendingFile, JSON.stringify({
                        session_id: targetSessionId,
                        action: 'patient_search',
                        timestamp: Date.now()
                      }));

                      await sendMessage(cb.message.chat.id,
                        `🔍 **Change Patient**\n\nReply with the patient name to search for:\n\n(e.g., "Tim Burke" or "Steve Schott")`);
                    } else {
                      await sendMessage(cb.message.chat.id, '⚠️ No active session found. Use /sessions to select one first.');
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error in change_patient:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== CONFIRM SEND CALLBACK (Direct Handling) ==========
                if (action === 'confirm_send' || action.startsWith('confirm_send_')) {
                  // Parse session ID from callback if present
                  const callbackSessionId = action.startsWith('confirm_send_') ? action.replace('confirm_send_', '') : null;
                  console.log(`[Bot] 🚀 Confirm send requested for chat ${cb.message.chat.id}, sessionId: ${callbackSessionId || 'auto-detect'}`);

                  try {
                    const sessionsDir = '/tmp/scribe_sessions';
                    let targetSession: any = null;

                    // If session ID provided, load that specific session
                    if (callbackSessionId) {
                      const sessionFile = path.join(sessionsDir, `${callbackSessionId}.json`);
                      if (fs.existsSync(sessionFile)) {
                        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                        targetSession = { ...data, file: sessionFile };
                      }
                    }

                    // Fallback: find latest active session for this chat (legacy support)
                    if (!targetSession && fs.existsSync(sessionsDir)) {
                      let latestTime = 0;
                      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                      for (const file of files) {
                        try {
                          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                          if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                            data.status !== 'SENT' && data.status !== 'DISCARDED' && data.status !== 'SUBMITTED') {
                            const sessionTime = new Date(data.created_at || data.updated_at || 0).getTime();
                            if (sessionTime > latestTime) {
                              latestTime = sessionTime;
                              targetSession = { ...data, file: path.join(sessionsDir, file) };
                            }
                          }
                        } catch (e) { /* skip invalid files */ }
                      }
                    }

                    if (!targetSession) {
                      await sendMessage(cb.message.chat.id, '⚠️ No active session found. Use /sessions to select one first.');
                      continue;
                    }

                    // CRITICAL: Skip if session was already submitted by Python scribe
                    // This prevents dual-upload when Python scribe submits first then TS picks up the same callback
                    if (targetSession.status === 'SUBMITTED' && !targetSession.reopened_at) {
                      console.log(`[Bot] ⏭️ Session already SUBMITTED - skipping TS confirm_send (Python scribe handled it)`);
                      continue;
                    }

                    const patientId = targetSession.classification?.patient_identification?.patient_id;
                    const soapNote = targetSession.documents?.soap_note;
                    const patientName = targetSession.patient_name || 'Unknown';

                    if (!patientId) {
                      await sendMessage(cb.message.chat.id, '⚠️ **Cannot submit - Patient is UNKNOWN!**\n\nPlease tap **🔄 Change Patient** first to assign a patient.');
                      continue;
                    }

                    if (!soapNote) {
                      await sendMessage(cb.message.chat.id, '⚠️ No SOAP note in session!');
                      continue;
                    }

                    // --- PRE-SEND CONFIRMATION SUMMARY ---
                    const selectedTypes: string[] = Array.isArray(targetSession.selected_types)
                      ? [...targetSession.selected_types]
                      : ['soap_note'];
                    if (!selectedTypes.includes('soap_note')) selectedTypes.unshift('soap_note');

                    console.log(`[Bot] confirm_send selected_types from file:`, targetSession.selected_types);
                    console.log(`[Bot] confirm_send resolved selectedTypes:`, selectedTypes);

                    const docTitleMap: Record<string, string> = {
                      'soap_note': '📋 SOAP Note',
                      'discharge_instructions': '📄 Discharge Instructions',
                      'work_note': '📝 Work Excuse Note',
                      'school_note': '🏫 School Excuse Note',
                      'care_plan': '🎯 Care Plan'
                    };

                    let summaryLines: string[] = [];
                    summaryLines.push(`📋 **Ready to send to Healthie for ${patientName}:**\n`);
                    summaryLines.push(`✅ SOAP Note → Chart Note form`);

                    for (const [dk, dt] of Object.entries(docTitleMap)) {
                      if (dk === 'soap_note') continue;
                      const hasDoc = targetSession.documents?.[dk];
                      if (hasDoc) {
                        const isSelected = selectedTypes.includes(dk);
                        console.log(`[Bot] confirm_send doc ${dk}: hasDoc=${!!hasDoc}, isSelected=${isSelected}`);
                        summaryLines.push(`${isSelected ? '✅' : '❌'} ${dt}${isSelected ? ' → will upload as chart note' : ' → skipped'}`);
                      }
                    }

                    summaryLines.push(`\n👤 Patient: ${patientName}`);

                    const confirmButtons = {
                      inline_keyboard: [
                        [
                          { text: "✅ Yes, Send Now", callback_data: `confirm_final_send_${targetSession.session_id || ''}` },
                          { text: "↩️ Go Back", callback_data: `switch_session_${targetSession.session_id || ''}` }
                        ]
                      ]
                    };

                    await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: cb.message.chat.id,
                        text: summaryLines.join('\n'),
                        reply_markup: confirmButtons
                      })
                    });
                  } catch (err: any) {
                    console.error('[Bot] Error in confirm_send:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== CONFIRM FINAL SEND (Actual Upload) ==========
                if (action.startsWith('confirm_final_send')) {
                  const sessionIdFromAction = action.replace('confirm_final_send_', '');
                  try {
                    const sessionsDir = '/tmp/scribe_sessions';
                    let targetSession: any = null;

                    if (sessionIdFromAction && fs.existsSync(`${sessionsDir}/${sessionIdFromAction}.json`)) {
                      const data = JSON.parse(fs.readFileSync(`${sessionsDir}/${sessionIdFromAction}.json`, 'utf8'));
                      targetSession = { ...data, file: `${sessionsDir}/${sessionIdFromAction}.json` };
                    } else {
                      let latestTime = 0;
                      if (fs.existsSync(sessionsDir)) {
                        const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                        for (const file of files) {
                          try {
                            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                            if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                              data.status !== 'SENT' && data.status !== 'DISCARDED' && data.status !== 'SUBMITTED') {
                              const sessionTime = new Date(data.created_at || data.updated_at || 0).getTime();
                              if (sessionTime > latestTime) {
                                latestTime = sessionTime;
                                targetSession = { ...data, file: path.join(sessionsDir, file) };
                              }
                            }
                          } catch (e) { /* skip */ }
                        }
                      }
                    }

                    if (!targetSession) {
                      await sendMessage(cb.message.chat.id, '⚠️ No active session found.');
                      continue;
                    }

                    // DUPLICATE UPLOAD PROTECTION:
                    // Skip if session was already submitted very recently (within 30s) and not reopened
                    // This catches race conditions where both Python scribe and TS bot try to upload
                    if (targetSession.status === 'SUBMITTED' && !targetSession.reopened_at) {
                      const submittedAt = targetSession.submitted_at ? new Date(targetSession.submitted_at).getTime() : 0;
                      const elapsed = Date.now() - submittedAt;
                      if (elapsed < 30000) {
                        console.log(`[Bot] ⏭️ Session already submitted ${elapsed}ms ago - skipping duplicate upload`);
                        await sendMessage(cb.message.chat.id, `✅ Already submitted! [View in Healthie](https://secure.gethealthie.com/users/${targetSession.classification?.patient_identification?.patient_id})`);
                        continue;
                      }
                    }

                    const pi = targetSession.classification?.patient_identification;
                    // Safety: only trust patient_id if manually assigned OR not flagged for verification
                    const patientId = pi?.patient_id && (!pi?.requires_manual_verification || pi?.manually_assigned) ? pi.patient_id : null;
                    const soapNote = targetSession.documents?.soap_note;
                    const patientName = targetSession.patient_name || 'Unknown';
                    const selectedTypes: string[] = targetSession.selected_types || ['soap_note'];

                    if (!patientId) {
                      await sendMessage(cb.message.chat.id, '⚠️ Cannot submit - no patient assigned!');
                      continue;
                    }

                    const isResubmit = !!targetSession.chart_note_id;
                    await sendMessage(cb.message.chat.id, `📤 ${isResubmit ? 'Updating' : 'Uploading'} ${selectedTypes.length} document(s) for **${patientName}**...`);

                    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

                    // --- 1. SOAP NOTE (always) ---
                    if (soapNote) {
                      const SOAP_FORM_ID = "2898601";
                      const FIELD_IDS = {
                        subjective: "37256657",
                        objective: "37256658",
                        assessment: "37256659",
                        plan: "37256660"
                      };

                      const parseSoapSections = (note: string) => {
                        const sections: { [key: string]: string } = { subjective: '', objective: '', assessment: '', plan: '' };
                        const subMatch = note.match(/SUBJECTIVE[\s\S]*?(?=OBJECTIVE|$)/i);
                        const objMatch = note.match(/OBJECTIVE[\s\S]*?(?=ASSESSMENT|$)/i);
                        const assMatch = note.match(/ASSESSMENT[\s\S]*?(?=PLAN|$)/i);
                        const planMatch = note.match(/PLAN[\s\S]*/i);
                        if (subMatch) sections.subjective = subMatch[0].replace(/^SUBJECTIVE\s*/i, '').trim();
                        if (objMatch) sections.objective = objMatch[0].replace(/^OBJECTIVE\s*/i, '').trim();
                        if (assMatch) sections.assessment = assMatch[0].replace(/^ASSESSMENT\s*/i, '').trim();
                        if (planMatch) sections.plan = planMatch[0].replace(/^PLAN\s*/i, '').trim();
                        return sections;
                      };

                      const formatSectionHtml = (text: string): string => {
                        if (!text || !text.trim()) return ' ';
                        let html = text;
                        html = html.replace(/^\s*[-*]\s+/gm, '<br/>&nbsp;&nbsp;• ');
                        html = html.replace(/\*\*(.*?)\*\*:/g, '<br/><span style="font-size:15px; font-weight:bold; color:#34495e;">$1:</span>');
                        html = html.replace(/^\s*([A-Za-z][A-Za-z\s/]+):/gm, '<br/><strong>$1:</strong>');
                        html = html.replace(/\n/g, '<br/>');
                        html = html.replace(/<br\/><br\/><br\/>/g, '<br/><br/>');
                        return html;
                      };

                      const sections = parseSoapSections(soapNote);
                      const formattedSections = {
                        subjective: formatSectionHtml(sections.subjective),
                        objective: formatSectionHtml(sections.objective),
                        assessment: formatSectionHtml(sections.assessment),
                        plan: formatSectionHtml(sections.plan)
                      };

                      const form_answers = [
                        { custom_module_id: FIELD_IDS.subjective, answer: formattedSections.subjective, user_id: patientId },
                        { custom_module_id: FIELD_IDS.objective, answer: formattedSections.objective, user_id: patientId },
                        { custom_module_id: FIELD_IDS.assessment, answer: formattedSections.assessment, user_id: patientId },
                        { custom_module_id: FIELD_IDS.plan, answer: formattedSections.plan, user_id: patientId }
                      ];

                      // Smart resubmit: update if chart_note_id exists, otherwise create
                      const existingChartNoteId = targetSession.chart_note_id;
                      let mutation: string;
                      let variables: any;

                      if (existingChartNoteId) {
                        console.log(`[Bot] 🔄 Updating existing chart note ${existingChartNoteId}`);
                        mutation = `
                          mutation UpdateFormAnswerGroup($input: updateFormAnswerGroupInput!) {
                            updateFormAnswerGroup(input: $input) {
                              form_answer_group { id }
                              messages { field message }
                            }
                          }
                        `;
                        variables = {
                          input: {
                            id: existingChartNoteId,
                            finished: true,
                            form_answers: form_answers
                          }
                        };
                      } else {
                        mutation = `
                          mutation CreateFormAnswerGroup($input: createFormAnswerGroupInput!) {
                            createFormAnswerGroup(input: $input) {
                              form_answer_group { id }
                            }
                          }
                        `;
                        variables = {
                          input: {
                            custom_module_form_id: SOAP_FORM_ID,
                            user_id: patientId,
                            finished: true,
                            form_answers: form_answers
                          }
                        };
                      }

                      const healthieResponse = await fetch('https://api.gethealthie.com/graphql', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                          'Content-Type': 'application/json',
                          'AuthorizationSource': 'API'
                        },
                        body: JSON.stringify({ query: mutation, variables })
                      });

                      const result: any = await healthieResponse.json();
                      if (result.errors) {
                        console.error('[Bot] Healthie error:', result.errors);
                        await sendMessage(cb.message.chat.id, `❌ SOAP upload error: ${JSON.stringify(result.errors)}`);
                        // Don't continue — still finalize session status below
                      }

                      const mutationKey = existingChartNoteId ? 'updateFormAnswerGroup' : 'createFormAnswerGroup';
                      const chartNoteId = result.data?.[mutationKey]?.form_answer_group?.id;
                      if (chartNoteId) {
                        targetSession.chart_note_id = chartNoteId;
                        const verb = existingChartNoteId ? 'updated' : 'submitted';
                        await sendMessage(cb.message.chat.id, `✅ SOAP Note ${verb} (ID: ${chartNoteId})`);
                      } else if (existingChartNoteId) {
                        // Update failed (e.g. chart note deleted in Healthie) - fallback to create new
                        console.log(`[Bot] ⚠️ Update of chart note ${existingChartNoteId} failed, falling back to create new`);
                        const createMutation = `
                          mutation CreateFormAnswerGroup($input: createFormAnswerGroupInput!) {
                            createFormAnswerGroup(input: $input) {
                              form_answer_group { id }
                            }
                          }
                        `;
                        const createVariables = {
                          input: {
                            custom_module_form_id: SOAP_FORM_ID,
                            user_id: patientId,
                            finished: true,
                            form_answers: form_answers
                          }
                        };
                        const createResponse = await fetch('https://api.gethealthie.com/graphql', {
                          method: 'POST',
                          headers: {
                            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                            'Content-Type': 'application/json',
                            'AuthorizationSource': 'API'
                          },
                          body: JSON.stringify({ query: createMutation, variables: createVariables })
                        });
                        const createResult: any = await createResponse.json();
                        const newChartNoteId = createResult.data?.createFormAnswerGroup?.form_answer_group?.id;
                        if (newChartNoteId) {
                          targetSession.chart_note_id = newChartNoteId;
                          await sendMessage(cb.message.chat.id, `✅ SOAP Note created as new (ID: ${newChartNoteId}) — previous note was deleted in Healthie`);
                        } else {
                          console.error('[Bot] Fallback create also failed:', JSON.stringify(createResult));
                          await sendMessage(cb.message.chat.id, '❌ Failed to submit SOAP Note.');
                        }
                      } else {
                        console.error('[Bot] SOAP mutation response:', JSON.stringify(result));
                        await sendMessage(cb.message.chat.id, '❌ Failed to submit SOAP Note.');
                      }
                    }

                    // --- 2. UPLOAD SELECTED ADDITIONAL DOCS AS PDFs ---
                    const additionalDocs: Record<string, string> = {
                      'discharge_instructions': 'Discharge Instructions',
                      'work_note': 'Work Excuse Note',
                      'school_note': 'School Excuse Note',
                      'care_plan': 'Care Plan'
                    };


                    for (const [docKey, docTitle] of Object.entries(additionalDocs)) {
                      if (!selectedTypes.includes(docKey)) {
                        console.log(`[Bot] ⏭️ Skipping ${docTitle} (not selected)`);
                        continue;
                      }

                      const docContent = targetSession.documents?.[docKey];
                      if (docContent && typeof docContent === 'string' && docContent.length > 10) {
                        try {
                          // Generate PDF using Python pdf_generator CLI wrapper
                          const { execSync } = require('child_process');
                          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                          const safePatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_');
                          const pdfPath = `/tmp/${docKey}_${safePatientName}_${timestamp}.pdf`;

                          // For discharge/care plan, write content to temp file
                          let contentFile = '';
                          if (docKey === 'discharge_instructions' || docKey === 'care_plan') {
                            contentFile = `/tmp/${docKey}_content_${timestamp}.txt`;
                            fs.writeFileSync(contentFile, docContent);
                          }

                          // Call the CLI wrapper
                          const cliCmd = contentFile
                            ? `python3 /home/ec2-user/scripts/scribe/generate_pdf_cli.py "${docKey}" "${patientName}" "${pdfPath}" "${contentFile}"`
                            : `python3 /home/ec2-user/scripts/scribe/generate_pdf_cli.py "${docKey}" "${patientName}" "${pdfPath}"`;

                          const pyResult = execSync(cliCmd, { timeout: 15000, encoding: 'utf8' });
                          console.log(`[Bot] 📄 PDF generated: ${pdfPath} (${pyResult.trim()})`);

                          // Clean up content temp file
                          if (contentFile) try { fs.unlinkSync(contentFile); } catch { }

                          // Read and base64 encode the PDF
                          const pdfBytes = fs.readFileSync(pdfPath);
                          const pdfBase64 = pdfBytes.toString('base64');

                          // Upload via Healthie createDocument mutation
                          const docMutation = `
                            mutation CreateDocument($input: createDocumentInput!) {
                              createDocument(input: $input) {
                                document { id display_name }
                                messages { field message }
                              }
                            }
                          `;

                          const docVariables = {
                            input: {
                              rel_user_id: patientId,
                              display_name: `${docTitle} - ${patientName} - ${new Date().toLocaleDateString()}`,
                              file_string: `data:application/pdf;base64,${pdfBase64}`,
                              description: `${docTitle} generated by AI Scribe`,
                              share_with_rel: true
                            }
                          };

                          const docResponse = await fetch('https://api.gethealthie.com/graphql', {
                            method: 'POST',
                            headers: {
                              'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                              'Content-Type': 'application/json',
                              'AuthorizationSource': 'API'
                            },
                            body: JSON.stringify({ query: docMutation, variables: docVariables })
                          });

                          const docResult: any = await docResponse.json();
                          const docId = docResult.data?.createDocument?.document?.id;
                          if (docId) {
                            console.log(`[Bot] ✅ Uploaded ${docTitle} as PDF document (ID: ${docId})`);
                            await sendMessage(cb.message.chat.id, `✅ ${docTitle} uploaded as PDF (ID: ${docId})`);
                          } else {
                            console.error(`[Bot] Failed to upload ${docTitle}:`, JSON.stringify(docResult));
                            await sendMessage(cb.message.chat.id, `⚠️ ${docTitle} upload failed: ${JSON.stringify(docResult.errors || docResult.data?.createDocument?.messages || 'Unknown error')}`);
                          }

                          // Clean up temp PDF
                          try { fs.unlinkSync(pdfPath); } catch { }
                        } catch (docErr: any) {
                          console.error(`[Bot] Error uploading ${docTitle}:`, docErr);
                          await sendMessage(cb.message.chat.id, `⚠️ ${docTitle} PDF generation/upload failed: ${docErr?.message || docErr}`);
                        }
                      }
                    }

                    // --- 3. FINALIZE ---
                    targetSession.status = 'SUBMITTED';
                    targetSession.submitted_at = new Date().toISOString();
                    fs.writeFileSync(targetSession.file, JSON.stringify(targetSession, null, 2));

                    const doneVerb = isResubmit ? 'updated' : 'sent';
                    await sendMessage(cb.message.chat.id, `✅ **All done!** ${selectedTypes.length} document(s) ${doneVerb} for ${patientName}.\n\n[View Chart in Healthie](https://secure.gethealthie.com/users/${patientId})`);
                  } catch (err: any) {
                    console.error('[Bot] Error in confirm_final_send:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== SELECT PATIENT CALLBACK ==========
                // Handles both old format (select_patient_...) and new short format (sp_...)
                if (action.startsWith('select_patient_') || action.startsWith('sp_')) {
                  // New short format: sp_{sessionId}_{patientId} (sessionId has underscores)
                  // Old format: select_patient_{sessionId}_{patientId}_{name}
                  let sessionId: string;
                  let patientId: string;

                  if (action.startsWith('sp_')) {
                    // New short format: sp_20260130_150200_jennifer_frederick_12746172
                    const parts = action.replace('sp_', '').split('_');
                    patientId = parts.pop()!; // Last part is always patient ID
                    sessionId = parts.join('_'); // Rest is session ID
                  } else {
                    // Old format parsing (for backwards compatibility)
                    const parts = action.replace('select_patient_', '').split('_');
                    sessionId = parts.slice(0, -2).join('_');
                    patientId = parts[parts.length - 2];
                  }

                  console.log(`[Bot] 👤 Selecting patient ${patientId} for session ${sessionId}`);

                  try {
                    // Fetch patient name from Healthie API
                    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
                    const patientQuery = `query { user(id: "${patientId}") { id first_name last_name dob } }`;
                    const patientResp = await fetch('https://api.gethealthie.com/graphql', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'Content-Type': 'application/json',
                        'AuthorizationSource': 'API'
                      },
                      body: JSON.stringify({ query: patientQuery })
                    });
                    const patientResult: any = await patientResp.json();
                    const patientData = patientResult.data?.user;
                    const patientName = patientData ? `${patientData.first_name || ''} ${patientData.last_name || ''}`.trim() : 'Unknown';
                    console.log(`[Bot] 👤 Fetched patient name: ${patientName}`);

                    const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                    if (fs.existsSync(sessionFile)) {
                      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));

                      // Update patient identification
                      if (!sessionData.classification) sessionData.classification = {};
                      if (!sessionData.classification.patient_identification) {
                        sessionData.classification.patient_identification = {};
                      }

                      // Store old patient name for SOAP content replacement
                      const oldPatientName = sessionData.patient_name;

                      sessionData.classification.patient_identification.patient_id = patientId;
                      sessionData.classification.patient_identification.matched_name = patientName;
                      sessionData.classification.patient_identification.manually_assigned = true;
                      sessionData.classification.patient_identification.confidence = 1.0;
                      sessionData.patient_name = patientName;
                      sessionData.updated_at = new Date().toISOString();

                      // Replace old patient name in SOAP content if different
                      if (oldPatientName && oldPatientName !== patientName && sessionData.documents?.soap_note) {
                        const oldSoap = sessionData.documents.soap_note;
                        // Replace old name with new name in SOAP
                        sessionData.documents.soap_note = oldSoap.replace(new RegExp(oldPatientName, 'gi'), patientName);
                        console.log(`[Bot] 📝 Replaced "${oldPatientName}" with "${patientName}" in SOAP content`);
                      }

                      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

                      // Show updated session with full keyboard
                      const preview = (sessionData.documents?.soap_note || '').substring(0, 300) + '...';
                      const spButtons = { inline_keyboard: buildSessionKeyboard(sessionId, sessionData) };

                      await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: `✅ **Patient assigned: ${patientName}**\n\n📋 Session ready to submit:\n\n${preview}`,
                          reply_markup: spButtons
                        })
                      });
                    } else {
                      await sendMessage(cb.message.chat.id, `❌ Session not found: ${sessionId}`);
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error selecting patient:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== CANCEL PATIENT SEARCH CALLBACK ==========
                if (action === 'cancel_patient_search') {
                  // Remove any pending search file
                  const pendingFile = `/tmp/telegram_approvals/pending_patient_search_${cb.message.chat.id}.json`;
                  if (fs.existsSync(pendingFile)) {
                    fs.unlinkSync(pendingFile);
                  }
                  await sendMessage(cb.message.chat.id, '❌ Patient search cancelled. Use /sessions to view pending sessions.');
                }

                // ========== ADD DOCUMENT CALLBACKS (Work Note, School Note, Discharge, Care Plan) ==========
                if (action.startsWith('add_work_note_') || action.startsWith('add_school_note_') ||
                  action.startsWith('add_discharge_') || action.startsWith('add_care_plan_')) {

                  // Parse action to get document type and session ID
                  const match = action.match(/^add_([^_]+(?:_[^_]+)?(?:_note|_instructions|_plan)?)_(.+)$/);
                  let docType = '';
                  let sessionId = '';

                  if (action.startsWith('add_work_note_')) {
                    docType = 'work_note';
                    sessionId = action.replace('add_work_note_', '');
                  } else if (action.startsWith('add_school_note_')) {
                    docType = 'school_note';
                    sessionId = action.replace('add_school_note_', '');
                  } else if (action.startsWith('add_discharge_')) {
                    docType = 'discharge_instructions';
                    sessionId = action.replace('add_discharge_', '');
                  } else if (action.startsWith('add_care_plan_')) {
                    docType = 'care_plan';
                    sessionId = action.replace('add_care_plan_', '');
                  }

                  console.log(`[Bot] ➕ Adding ${docType} for session ${sessionId}`);

                  const docLabels: Record<string, string> = {
                    'work_note': 'Work Excuse Note',
                    'school_note': 'School Excuse Note',
                    'discharge_instructions': 'Discharge Instructions',
                    'care_plan': 'Care Plan'
                  };

                  try {
                    const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                    if (fs.existsSync(sessionFile)) {
                      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                      const soapNote = sessionData.documents?.soap_note || '';
                      const patientName = sessionData.patient_name || 'Patient';

                      await sendMessage(cb.message.chat.id, `⏳ Generating ${docLabels[docType]} for ${patientName}...`);

                      // Generate document using Gemini AI
                      const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
                      console.log(`[Bot] 🔑 GOOGLE_AI_API_KEY loaded: ${GEMINI_API_KEY ? 'YES (' + GEMINI_API_KEY.substring(0, 10) + '...)' : 'NO'}`);
                      if (!GEMINI_API_KEY) {
                        console.log('[Bot] ❌ GOOGLE_AI_API_KEY is undefined - dotenv may not have loaded');
                        await sendMessage(cb.message.chat.id, '❌ Error: Gemini API key not configured');
                        continue;
                      }

                      const prompts: Record<string, string> = {
                        'work_note': `Based on this SOAP note, generate a professional Work Excuse Note for the patient. Include the date, patient name, that they were seen today, and any work restrictions or return-to-work date as appropriate. Keep it concise and professional.\n\nClinic: NowOptimal Network\nPhone: 928-277-0001\nEmail: hello@nowoptimal.com\nWebsite: nowoptimal.com\n\nSOAP Note:\n${soapNote}\n\nPatient Name: ${patientName}\nDate: ${new Date().toLocaleDateString()}`,
                        'school_note': `Based on this SOAP note, generate a School Excuse Note for the patient. Include the date, patient name, that they were seen today, and any school restrictions or return-to-school date as appropriate. Keep it concise and professional.\n\nClinic: NowOptimal Network\nPhone: 928-277-0001\nEmail: hello@nowoptimal.com\nWebsite: nowoptimal.com\n\nSOAP Note:\n${soapNote}\n\nPatient Name: ${patientName}\nDate: ${new Date().toLocaleDateString()}`,
                        'discharge_instructions': `You are generating Discharge Instructions for a patient visit at NowOptimal Network.

CRITICAL FORMATTING RULES:
- Do NOT use any markdown symbols: no #, ##, **, *, or backticks
- Do NOT use asterisks for bullet points or emphasis
- Use clean plain text only
- Use ALL CAPS for section headers (e.g., MEDICATIONS, WOUND CARE, FOLLOW-UP)
- Use dashes (-) for bullet points
- Use plain text for emphasis, no special characters
- Leave a blank line between sections for readability

BRANDING:
- Practice name: NowOptimal Network
- Phone: 928-277-0001
- Email: hello@nowoptimal.com
- Website: nowoptimal.com

STRUCTURE:
1. Start with patient name and date on separate lines
2. A brief warm opening paragraph (1-2 sentences)
3. MEDICATIONS section with each medication on its own line, including name, dose, and clear instructions
4. Any relevant care sections (WOUND CARE, ACTIVITY, etc.)
5. WARNING SIGNS - when to call the office
6. FOLLOW-UP section
7. End with: "Questions or concerns? Contact us at 928-277-0001 or hello@nowoptimal.com"

Write in warm, patient-friendly language. Be thorough but concise.

SOAP Note:
${soapNote}

Patient Name: ${patientName}
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
                        'care_plan': `Based on this SOAP note, generate a comprehensive Care Plan. Include goals, interventions, patient education, and follow-up schedule. Format it professionally.\n\nClinic: NowOptimal Network\nPhone: 928-277-0001\nEmail: hello@nowoptimal.com\n\nSOAP Note:\n${soapNote}\n\nPatient Name: ${patientName}`
                      };

                      const geminiResponse = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contents: [{ parts: [{ text: prompts[docType] }] }],
                            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
                          })
                        }
                      );

                      const geminiResult: any = await geminiResponse.json();
                      const generatedDoc = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || 'Error generating document';

                      // Save to session and auto-select for upload
                      sessionData.documents[docType] = generatedDoc;
                      if (!sessionData.selected_types) sessionData.selected_types = ['soap_note'];
                      if (!sessionData.selected_types.includes(docType)) {
                        sessionData.selected_types.push(docType);
                      }
                      sessionData.updated_at = new Date().toISOString();
                      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

                      // Send the generated document
                      await sendMessage(cb.message.chat.id, `✅ **${docLabels[docType]} Generated:**\n\n${generatedDoc.substring(0, 2000)}`);

                      // Show action buttons for the generated doc (including edit button for this specific doc type)
                      const docActionButtons = {
                        inline_keyboard: [
                          [
                            { text: '✏️ Edit', callback_data: `edit_doc_${docType}_${sessionId}` },
                            { text: '📄 View Full', callback_data: `view_doc_${docType}_${sessionId}` }
                          ],
                          ...buildSessionKeyboard(sessionId, sessionData)
                        ]
                      };
                      await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: `📄 ${docLabels[docType]} saved to session.`,
                          reply_markup: docActionButtons
                        })
                      });

                    } else {
                      await sendMessage(cb.message.chat.id, `❌ Session not found: ${sessionId}`);
                    }
                  } catch (err: any) {
                    console.error(`[Bot] Error generating ${docType}:`, err);
                    await sendMessage(cb.message.chat.id, `❌ Error generating document: ${err?.message || err}`);
                  }
                }

                // ========== PENDING SESSIONS CALLBACK ==========
                if (action === 'pending_sessions') {
                  console.log(`[Bot] 📋 Pending sessions requested via callback`);
                  // Reuse the same logic as /sessions command
                  try {
                    const sessionsDir = '/tmp/scribe_sessions';
                    const sessions: any[] = [];
                    const submittedToday: any[] = [];
                    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

                    if (fs.existsSync(sessionsDir)) {
                      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                      for (const file of files) {
                        try {
                          const data = JSON.parse(fs.readFileSync(`${sessionsDir}/${file}`, 'utf8'));

                          if (data.status === 'SUBMITTED' || data.status === 'SENT') {
                            const createdDate = (data.created_at || '').slice(0, 10);
                            if (createdDate >= sevenDaysAgo) {
                              submittedToday.push({
                                id: file.replace('.json', ''),
                                name: data.patient_name || 'Unknown',
                                createdAt: data.created_at,
                                session_id: data.session_id || file.replace('.json', '')
                              });
                            }
                            continue;
                          }

                          if (data.status !== 'DISCARDED') {
                            sessions.push({
                              id: file.replace('.json', ''),
                              name: data.patient_name || 'Unknown',
                              status: data.status || 'UNKNOWN',
                              patientId: data.classification?.patient_identification?.patient_id,
                              createdAt: data.created_at
                            });
                          }
                        } catch { /* skip invalid */ }
                      }
                    }

                    if (sessions.length === 0 && submittedToday.length === 0) {
                      await sendMessage(cb.message.chat.id, '📋 No pending sessions. Upload an audio recording to create one.');
                    } else {
                      let msg = '';
                      const buttons: any[][] = [];

                      if (sessions.length > 0) {
                        msg += '📋 PENDING SCRIBE SESSIONS\n\nTap to switch:\n';
                        for (const s of sessions.slice(0, 8)) {
                          buttons.push([{
                            text: `${s.patientId ? '🟡' : '🔴'} ${s.name} (${new Date(s.createdAt).toLocaleTimeString()}) - ${s.status}`,
                            callback_data: `switch_session_${s.id}`
                          }]);
                        }
                      }

                      if (submittedToday.length > 0) {
                        msg += '\n✅ RECENTLY SUBMITTED (tap to reopen & edit):\n';
                        for (const s of submittedToday.slice(0, 5)) {
                          const time = new Date(s.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                          buttons.push([{
                            text: `🔄 Reopen ${s.name} (${time})`,
                            callback_data: `reopen_${s.session_id}`
                          }]);
                        }
                      }

                      await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: msg,
                          reply_markup: { inline_keyboard: buttons }
                        })
                      });
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error listing sessions:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== REJECT/DISCARD CALLBACK ==========
                if (action === 'reject' || action.startsWith('reject_')) {
                  const callbackSessionId = action.startsWith('reject_') ? action.replace('reject_', '') : null;
                  console.log(`[Bot] 🗑️ Discard requested for chat ${cb.message.chat.id}, sessionId: ${callbackSessionId || 'auto-detect'}`);
                  try {
                    const sessionsDir = '/tmp/scribe_sessions';
                    let discarded = false;

                    // If session ID provided, discard that specific session
                    if (callbackSessionId) {
                      const sessionFile = path.join(sessionsDir, `${callbackSessionId}.json`);
                      if (fs.existsSync(sessionFile)) {
                        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                        data.status = 'DISCARDED';
                        data.discarded_at = new Date().toISOString();
                        fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
                        discarded = true;
                        await sendMessage(cb.message.chat.id, `🗑️ Session for **${data.patient_name}** has been discarded.`);
                      }
                    }

                    // Fallback: find latest active session (legacy support)
                    if (!discarded && fs.existsSync(sessionsDir)) {
                      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                      for (const file of files) {
                        try {
                          const filePath = path.join(sessionsDir, file);
                          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                          if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                            data.status !== 'SENT' && data.status !== 'DISCARDED' && data.status !== 'SUBMITTED') {
                            data.status = 'DISCARDED';
                            data.discarded_at = new Date().toISOString();
                            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                            discarded = true;
                            await sendMessage(cb.message.chat.id, `🗑️ Session for **${data.patient_name}** has been discarded.`);
                            break;
                          }
                        } catch (e) { /* skip invalid files */ }
                      }
                    }

                    if (!discarded) {
                      await sendMessage(cb.message.chat.id, '⚠️ No active session found to discard.');
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error in reject:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== EDIT HELP CALLBACK ==========
                if (action.startsWith('edit_help') || action.startsWith('edit_doc_')) {
                  // Parse session ID - handle both formats:
                  // edit_help_{sessionId} 
                  // edit_doc_{docType}_{sessionId}
                  let sessionId = '';
                  if (action.startsWith('edit_doc_')) {
                    // Extract session ID after the doc type
                    for (const dt of ['discharge_instructions', 'work_note', 'school_note', 'care_plan']) {
                      if (action.startsWith(`edit_doc_${dt}_`)) {
                        sessionId = action.replace(`edit_doc_${dt}_`, '');
                        break;
                      }
                    }
                  } else {
                    sessionId = action.includes('_') ? action.split('_').slice(2).join('_') : '';
                  }
                  console.log(`[Bot] ✏️ Edit mode for session: ${sessionId || 'latest'}`);
                  try {
                    // Find the session to edit
                    let targetSessionId = sessionId;
                    if (!targetSessionId) {
                      // Find latest session for this chat
                      const sessionsDir = '/tmp/scribe_sessions';
                      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
                      for (const file of files) {
                        const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                        if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                          data.status !== 'SENT' && data.status !== 'DISCARDED') {
                          targetSessionId = data.session_id;
                          break;
                        }
                      }
                    }
                    if (targetSessionId) {
                      // Save edit mode state - default to soap_note unless a specific doc type is provided
                      const approvalDir = '/tmp/telegram_approvals';
                      const activeEditFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                      // Parse document type from action: edit_help_{sessionId} or edit_doc_{docType}_{sessionId}
                      let editDocType = 'soap_note';  // default
                      if (action.startsWith('edit_doc_')) {
                        // Format: edit_doc_{docType}_{sessionId}
                        for (const dt of ['discharge_instructions', 'work_note', 'school_note', 'care_plan']) {
                          if (action.startsWith(`edit_doc_${dt}_`)) {
                            editDocType = dt;
                            break;
                          }
                        }
                      } else {
                        // Generic edit_help button - check which documents exist and offer selection
                        const sessionFile = `/tmp/scribe_sessions/${targetSessionId}.json`;
                        if (fs.existsSync(sessionFile)) {
                          const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                          const docs = sessionData.documents || {};
                          const availableDocs: { key: string; label: string }[] = [];
                          if (docs.soap_note) availableDocs.push({ key: 'soap_note', label: '📋 SOAP Note' });
                          if (docs.discharge_instructions) availableDocs.push({ key: 'discharge_instructions', label: '📄 Discharge Instructions' });
                          if (docs.work_note) availableDocs.push({ key: 'work_note', label: '📝 Work Excuse Note' });
                          if (docs.school_note) availableDocs.push({ key: 'school_note', label: '🏫 School Excuse Note' });
                          if (docs.care_plan) availableDocs.push({ key: 'care_plan', label: '🎯 Care Plan' });

                          if (availableDocs.length > 1) {
                            // Multiple docs - show selection buttons
                            const editButtons = availableDocs.map(d => ([{
                              text: `✏️ Edit ${d.label}`,
                              callback_data: `edit_doc_${d.key}_${targetSessionId}`
                            }]));
                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                chat_id: cb.message.chat.id,
                                text: '✏️ Which document would you like to edit?',
                                reply_markup: { inline_keyboard: editButtons }
                              })
                            });
                            break; // Don't enter edit mode yet - wait for user selection
                          } else if (availableDocs.length === 1) {
                            // Only one doc - auto-select it
                            editDocType = availableDocs[0].key;
                          }
                        }
                      }

                      const editDocLabels: Record<string, string> = {
                        'soap_note': 'SOAP note',
                        'discharge_instructions': 'Discharge Instructions',
                        'work_note': 'Work Excuse Note',
                        'school_note': 'School Excuse Note',
                        'care_plan': 'Care Plan'
                      };

                      fs.writeFileSync(activeEditFile, JSON.stringify({
                        session_id: targetSessionId,
                        mode: 'edit',
                        document_type: editDocType,
                        timestamp: Date.now()
                      }));
                      await sendMessage(cb.message.chat.id,
                        `✏️ EDIT MODE ACTIVE — Editing **${editDocLabels[editDocType] || editDocType}**\n\nType your edit instruction, for example:\n• "Remove shortness of breath"\n• "Change Progesterone to 200mg"\n• "Add follow-up in 2 weeks"\n\nType your instruction now:`);
                    } else {
                      await sendMessage(cb.message.chat.id, '⚠️ No active session found. Use /sessions to select one.');
                    }
                  } catch (err: any) {
                    console.error('[Bot] Error entering edit mode:', err);
                    await sendMessage(cb.message.chat.id, `❌ Error: ${err?.message || err}`);
                  }
                }

                // ========== VIEW SOAP CALLBACK ==========
                if (action.startsWith('view_soap_')) {
                  const sessionId = action.replace('view_soap_', '');
                  try {
                    const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                    if (fs.existsSync(sessionFile)) {
                      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                      const soapNote = sessionData.documents?.soap_note || 'No SOAP note available';
                      // Split into chunks if too long
                      const chunks = soapNote.match(/.{1,4000}/gs) || [soapNote];
                      for (const chunk of chunks) {
                        await sendMessage(cb.message.chat.id, chunk);
                      }
                      // Show full keyboard after SOAP view
                      const vsButtons = { inline_keyboard: buildSessionKeyboard(sessionId, sessionData) };
                      await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: cb.message.chat.id,
                          text: '👇 Actions:',
                          reply_markup: vsButtons
                        })
                      });
                    }
                  } catch (err: any) {
                    await sendMessage(cb.message.chat.id, `❌ Error viewing SOAP: ${err?.message || err}`);
                  }
                }

                // ========== VIEW DOCUMENT CALLBACK (discharge, work note, etc.) ==========
                if (action.startsWith('view_doc_')) {
                  // Parse: view_doc_{docType}_{sessionId}
                  let viewDocType = '';
                  let viewSessionId = '';
                  for (const dt of ['discharge_instructions', 'work_note', 'school_note', 'care_plan']) {
                    if (action.startsWith(`view_doc_${dt}_`)) {
                      viewDocType = dt;
                      viewSessionId = action.replace(`view_doc_${dt}_`, '');
                      break;
                    }
                  }

                  const docTitles: Record<string, string> = {
                    'discharge_instructions': '📄 Discharge Instructions',
                    'work_note': '📝 Work Excuse Note',
                    'school_note': '🏫 School Excuse Note',
                    'care_plan': '🎯 Care Plan'
                  };

                  if (viewDocType && viewSessionId) {
                    try {
                      const sessionFile = `/tmp/scribe_sessions/${viewSessionId}.json`;
                      if (fs.existsSync(sessionFile)) {
                        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                        const docContent = sessionData.documents?.[viewDocType];
                        if (docContent) {
                          const title = docTitles[viewDocType] || viewDocType;
                          const fullText = `**${title}**\n\n${docContent}`;
                          const chunks = fullText.match(/.{1,4000}/gs) || [fullText];
                          for (const chunk of chunks) {
                            await sendMessage(cb.message.chat.id, chunk);
                          }
                        } else {
                          await sendMessage(cb.message.chat.id, `⚠️ No ${docTitles[viewDocType] || viewDocType} found in session.`);
                        }
                        // Show keyboard after viewing
                        const vdButtons = { inline_keyboard: buildSessionKeyboard(viewSessionId, sessionData) };
                        await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            chat_id: cb.message.chat.id,
                            text: '👇 Actions:',
                            reply_markup: vdButtons
                          })
                        });
                      }
                    } catch (err: any) {
                      await sendMessage(cb.message.chat.id, `❌ Error viewing document: ${err?.message || err}`);
                    }
                  }
                }
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

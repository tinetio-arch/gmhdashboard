#!/usr/bin/env tsx
/**
 * Schema Discovery Script
 * Queries Snowflake to discover all tables and columns, 
 * then generates a schema file for the AI bot to use.
 */

import snowflake from 'snowflake-sdk';
import * as fs from 'fs';
import * as path from 'path';

// Load env from home directory
require('dotenv').config({ path: '/home/ec2-user/.env' });

interface ColumnInfo {
  name: string;
  type: string;
}

interface TableSchema {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

interface DiscoveredSchema {
  discoveredAt: string;
  database: string;
  tables: TableSchema[];
  missingDataSuggestions: string[];
}

async function connectSnowflake(): Promise<snowflake.Connection> {
  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USERNAME!,
      password: process.env.SNOWFLAKE_PASSWORD!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
      database: 'GMH_CLINIC'
    });

    conn.connect((err) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
}

async function executeQuery(conn: snowflake.Connection, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      complete: (err: any, stmt: any, rows: any) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    });
  });
}

async function discoverSchema(): Promise<DiscoveredSchema> {
  console.log('🔍 Discovering Snowflake schema...\n');
  
  const conn = await connectSnowflake();
  
  try {
    // Get all columns from relevant schemas
    const columnQuery = `
      SELECT 
        TABLE_SCHEMA,
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE
      FROM GMH_CLINIC.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA IN ('PATIENT_DATA', 'FINANCIAL_DATA', 'INTEGRATION_LOGS')
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `;
    
    const columns = await executeQuery(conn, columnQuery);
    
    // Group by table
    const tableMap = new Map<string, TableSchema>();
    
    for (const col of columns) {
      const key = `${col.TABLE_SCHEMA}.${col.TABLE_NAME}`;
      
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          schema: col.TABLE_SCHEMA,
          table: col.TABLE_NAME,
          columns: []
        });
      }
      
      tableMap.get(key)!.columns.push({
        name: col.COLUMN_NAME,
        type: col.DATA_TYPE
      });
    }
    
    // Get row counts for each table
    console.log('📊 Getting row counts...');
    for (const [key, tableSchema] of tableMap) {
      try {
        const countQuery = `SELECT COUNT(*) as CNT FROM GMH_CLINIC.${key}`;
        const countResult = await executeQuery(conn, countQuery);
        tableSchema.rowCount = countResult[0]?.CNT || 0;
      } catch (e) {
        tableSchema.rowCount = -1; // Couldn't count (might be a view)
      }
    }
    
    // Check for commonly requested data that might be missing
    const missingDataSuggestions: string[] = [];
    
    // Check if PROVIDER exists anywhere
    let hasProvider = false;
    for (const [, tableSchema] of tableMap) {
      if (tableSchema.columns.some(c => c.name.includes('PROVIDER'))) {
        hasProvider = true;
        break;
      }
    }
    if (!hasProvider) {
      missingDataSuggestions.push('PROVIDER: No provider/doctor assignment column found. Consider adding PROVIDER_ID or ASSIGNED_PROVIDER to PATIENTS table, sourced from Healthie provider assignments.');
    }
    
    // Check for appointment data
    let hasAppointments = false;
    for (const [key] of tableMap) {
      if (key.includes('APPOINTMENT')) {
        hasAppointments = true;
        break;
      }
    }
    if (!hasAppointments) {
      missingDataSuggestions.push('APPOINTMENTS: No appointments table found. Consider syncing from Healthie appointments API.');
    }
    
    const schema: DiscoveredSchema = {
      discoveredAt: new Date().toISOString(),
      database: 'GMH_CLINIC',
      tables: Array.from(tableMap.values()),
      missingDataSuggestions
    };
    
    return schema;
    
  } finally {
    conn.destroy(() => {});
  }
}

function generateSchemaContext(schema: DiscoveredSchema): string {
  let context = `// Auto-generated schema context from Snowflake discovery
// Generated: ${schema.discoveredAt}
// Database: ${schema.database}

export const DISCOVERED_SCHEMA = \`
You are a SQL expert querying a Snowflake database. Here is the COMPLETE and ACCURATE schema:

Database: ${schema.database}

`;

  // Group tables by schema
  const bySchema = new Map<string, TableSchema[]>();
  for (const table of schema.tables) {
    if (!bySchema.has(table.schema)) {
      bySchema.set(table.schema, []);
    }
    bySchema.get(table.schema)!.push(table);
  }

  for (const [schemaName, tables] of bySchema) {
    context += `\n📁 SCHEMA: ${schemaName}\n${'='.repeat(50)}\n`;
    
    for (const table of tables) {
      const rowInfo = table.rowCount !== undefined && table.rowCount >= 0 
        ? ` (${table.rowCount} rows)` 
        : '';
      context += `\n📋 ${schema.database}.${schemaName}.${table.table}${rowInfo}\n`;
      context += `   Columns: ${table.columns.map(c => c.name).join(', ')}\n`;
    }
  }

  if (schema.missingDataSuggestions.length > 0) {
    context += `\n\n⚠️ KNOWN DATA GAPS:\n`;
    for (const suggestion of schema.missingDataSuggestions) {
      context += `- ${suggestion}\n`;
    }
  }

  context += `

🔧 SNOWFLAKE SQL SYNTAX (CRITICAL - NOT MySQL!):
- Date arithmetic: DATEADD(day, -7, CURRENT_DATE()) NOT DATE_SUB()
- Current date: CURRENT_DATE() or CURRENT_TIMESTAMP()
- Date difference: DATEDIFF(day, start_date, end_date)
- String matching: ILIKE '%term%' for partial match (case-insensitive)
- Null handling: COALESCE(value, 0) or NVL(value, 0)
- Conditional: IFF(condition, true_val, false_val) or CASE WHEN
- Round: ROUND(value, decimals)

� CRITICAL: USE THESE EXACT QUERIES FOR COMMON QUESTIONS!

-- PROVIDER PATIENTS: How many patients does Dr. Whitten/any provider have?
-- USE THIS EXACT QUERY - The PROVIDERS table has PATIENT_COUNT pre-calculated!
SELECT FULL_NAME, PATIENT_COUNT, EMAIL, ACTIVE
FROM GMH_CLINIC.PATIENT_DATA.PROVIDERS
WHERE FULL_NAME ILIKE '%whitten%';
-- For "all providers": SELECT * FROM GMH_CLINIC.PATIENT_DATA.PROVIDERS ORDER BY PATIENT_COUNT DESC;
-- NEVER try to count from PATIENTS table for provider counts - use PROVIDERS.PATIENT_COUNT directly!

-- INVENTORY PROJECTION: When will we run out of testosterone?
-- This is a complex query - USE THIS EXACT SQL:
WITH dispense_stats AS (
  SELECT 
    SUM(TOTAL_DISPENSED_ML) as TOTAL_DISPENSED,
    DATEDIFF(day, MIN(DISPENSE_DATE), CURRENT_DATE()) as DAYS_OF_DATA,
    SUM(TOTAL_DISPENSED_ML) / NULLIF(DATEDIFF(day, MIN(DISPENSE_DATE), CURRENT_DATE()), 0) as ML_PER_DAY
  FROM GMH_CLINIC.PATIENT_DATA.DISPENSES
  WHERE MEDICATION_NAME ILIKE '%testosterone%'
),
inventory AS (
  SELECT SUM(REMAINING_VOLUME_ML) as REMAINING_ML
  FROM GMH_CLINIC.PATIENT_DATA.VIALS
  WHERE STATUS = 'Active' AND DEA_DRUG_NAME ILIKE '%testosterone%'
)
SELECT 
  ROUND(i.REMAINING_ML, 1) as REMAINING_ML,
  ROUND(d.ML_PER_DAY, 2) as DAILY_USAGE_ML,
  d.DAYS_OF_DATA as BASED_ON_DAYS_OF_DATA,
  ROUND(i.REMAINING_ML / NULLIF(d.ML_PER_DAY, 0), 0) as DAYS_REMAINING,
  DATEADD(day, ROUND(i.REMAINING_ML / NULLIF(d.ML_PER_DAY, 0), 0)::INT, CURRENT_DATE()) as PROJECTED_RUNOUT_DATE
FROM inventory i, dispense_stats d;

📊 OTHER COMMON QUERIES:

-- REVENUE: How much did we make in the last N days?
SELECT 
  SUM(AMOUNT_PAID) as TOTAL_REVENUE,
  COUNT(*) as PAYMENT_COUNT,
  COUNT(DISTINCT PATIENT_ID) as UNIQUE_PATIENTS
FROM GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
WHERE STATE = 'succeeded' 
  AND PAYMENT_DATE >= DATEADD(day, -7, CURRENT_DATE());

-- REVENUE BREAKDOWN: Show all payments in the last 2 days
SELECT 
  PAYMENT_DATE, SENDER_NAME as PATIENT, RECIPIENT_NAME as PROVIDER, 
  AMOUNT_PAID, STATE
FROM GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
WHERE PAYMENT_DATE >= DATEADD(day, -2, CURRENT_DATE())
  AND STATE = 'succeeded'
ORDER BY PAYMENT_DATE DESC;

-- INVENTORY: How much testosterone do we have?
SELECT 
  DEA_DRUG_NAME,
  COUNT(*) as VIAL_COUNT,
  SUM(REMAINING_VOLUME_ML) as TOTAL_REMAINING_ML,
  SUM(SIZE_ML) as TOTAL_CAPACITY_ML,
  ROUND(SUM(REMAINING_VOLUME_ML) / NULLIF(SUM(SIZE_ML), 0) * 100, 1) as PCT_REMAINING
FROM GMH_CLINIC.PATIENT_DATA.VIALS
WHERE STATUS = 'Active' AND REMAINING_VOLUME_ML > 0
GROUP BY DEA_DRUG_NAME;

-- PATIENT SEARCH: Find patient by name
SELECT PATIENT_NAME, EMAIL, PHONE_NUMBER, REGIMEN, STATUS, PAYMENT_METHOD
FROM GMH_CLINIC.PATIENT_DATA.PATIENTS
WHERE PATIENT_NAME ILIKE '%john%';

-- PATIENT FINANCIALS: How much has a specific patient paid?
SELECT 
  p.PATIENT_NAME,
  SUM(b.AMOUNT_PAID) as TOTAL_HEALTHIE_PAID,
  MAX(b.PAYMENT_DATE) as LAST_PAYMENT
FROM GMH_CLINIC.PATIENT_DATA.PATIENTS p
LEFT JOIN GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS b 
  ON p.PATIENT_ID = b.PATIENT_ID AND b.STATE = 'succeeded'
WHERE p.PATIENT_NAME ILIKE '%andrew lang%'
GROUP BY p.PATIENT_NAME;

⚠️ CRITICAL RULES:
1. ONLY use columns that exist in the schema above
2. Use full table names: GMH_CLINIC.SCHEMA.TABLE
3. Use ILIKE '%term%' for text matching (case-insensitive)
4. Use Snowflake DATEADD() syntax, NEVER MySQL DATE_SUB()
5. Filter BILLING_ITEMS by STATE = 'succeeded' for actual payments
6. For provider patient counts, query PROVIDERS.PATIENT_COUNT directly - do NOT count from PATIENTS
7. For inventory projections, use the simplified CTE with DISPENSES and VIALS tables
8. If a user asks for data not in this schema, explain what's missing
\`;\n`;

  return context;
}

async function main() {
  try {
    const schema = await discoverSchema();
    
    // Print summary
    console.log('\n📋 DISCOVERED TABLES:\n');
    for (const table of schema.tables) {
      const rowInfo = table.rowCount !== undefined && table.rowCount >= 0 
        ? ` (${table.rowCount} rows)` 
        : '';
      console.log(`  ${table.schema}.${table.table}${rowInfo}`);
      console.log(`    Columns: ${table.columns.map(c => c.name).join(', ')}`);
      console.log('');
    }
    
    if (schema.missingDataSuggestions.length > 0) {
      console.log('\n⚠️  MISSING DATA SUGGESTIONS:');
      for (const suggestion of schema.missingDataSuggestions) {
        console.log(`  - ${suggestion}`);
      }
    }
    
    // Save raw schema as JSON
    const schemaPath = path.join(__dirname, '../data/discovered-schema.json');
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    console.log(`\n✅ Schema saved to: ${schemaPath}`);
    
    // Generate TypeScript schema context
    const contextCode = generateSchemaContext(schema);
    const contextPath = path.join(__dirname, '../lib/discoveredSchema.ts');
    fs.writeFileSync(contextPath, contextCode);
    console.log(`✅ Schema context saved to: ${contextPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

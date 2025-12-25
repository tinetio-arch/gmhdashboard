#!/usr/bin/env tsx
/**
 * Sync Healthie Provider Data to Snowflake
 * 
 * This script:
 * 1. Fetches all organization members (providers) from Healthie
 * 2. Fetches patient-provider assignments
 * 3. Creates/updates PROVIDERS table in Snowflake
 * 4. Updates PATIENTS.PRESCRIBING_PROVIDER_ID with Healthie provider IDs
 * 
 * Run: npm run healthie:sync-providers
 */

import snowflake from 'snowflake-sdk';

// Load env from home directory
require('dotenv').config({ path: '/home/ec2-user/.env' });

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY!;
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

interface Provider {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  patientCount: number;
}

interface PatientProvider {
  healthieClientId: string;
  patientName: string;
  providerId: string;
  providerName: string;
}

// Healthie GraphQL helper
async function healthieQuery(query: string, variables: Record<string, any> = {}): Promise<any> {
  const response = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Basic ${HEALTHIE_API_KEY}`,
      authorizationsource: 'API',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) {
    console.error('GraphQL errors:', json.errors);
    throw new Error(json.errors[0]?.message || 'GraphQL error');
  }
  return json.data;
}

// Snowflake connection helper
async function connectSnowflake(): Promise<snowflake.Connection> {
  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USERNAME!,
      password: process.env.SNOWFLAKE_PASSWORD!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
      database: 'GMH_CLINIC',
      schema: 'PATIENT_DATA'
    });
    conn.connect((err) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
}

async function executeSnowflake(conn: snowflake.Connection, sql: string): Promise<any[]> {
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

// Fetch organization members (providers)
async function fetchProviders(): Promise<Provider[]> {
  console.log('📥 Fetching organization members from Healthie...');
  
  const query = `
    query {
      organizationMembers(page_size: 100) {
        id
        first_name
        last_name
        email
        active
      }
    }
  `;
  
  const data = await healthieQuery(query);
  const members = data.organizationMembers || [];
  
  return members.map((m: any) => ({
    id: m.id,
    firstName: m.first_name,
    lastName: m.last_name,
    email: m.email || '',
    active: m.active,
    patientCount: 0 // Will be calculated
  }));
}

// Fetch patient-provider assignments
async function fetchPatientProviders(): Promise<PatientProvider[]> {
  console.log('📥 Fetching patient-provider assignments from Healthie...');
  
  const assignments: PatientProvider[] = [];
  let offset = 0;
  const pageSize = 100;
  let hasMore = true;
  
  while (hasMore) {
    const query = `
      query($offset: Int) {
        users(page_size: ${pageSize}, offset: $offset, should_paginate: true) {
          id
          first_name
          last_name
          dietitian_id
          providers {
            id
            first_name
            last_name
          }
        }
      }
    `;
    
    const data = await healthieQuery(query, { offset });
    const users = data.users || [];
    
    if (users.length === 0) {
      hasMore = false;
      break;
    }
    
    for (const u of users) {
      const provider = u.providers?.[0];
      if (provider) {
        assignments.push({
          healthieClientId: u.id,
          patientName: `${u.first_name} ${u.last_name}`,
          providerId: provider.id,
          providerName: `${provider.first_name} ${provider.last_name}`
        });
      }
    }
    
    offset += pageSize;
    process.stdout.write(`  Processed ${offset} users...\r`);
    
    if (users.length < pageSize) {
      hasMore = false;
    }
  }
  
  console.log(`\n✅ Found ${assignments.length} patient-provider assignments`);
  return assignments;
}

// Create/update PROVIDERS table in Snowflake
async function syncProvidersToSnowflake(
  conn: snowflake.Connection, 
  providers: Provider[],
  patientProviders: PatientProvider[]
): Promise<void> {
  console.log('\n📤 Syncing providers to Snowflake...');
  
  // Calculate patient counts
  const countByProvider = new Map<string, number>();
  for (const pp of patientProviders) {
    countByProvider.set(pp.providerId, (countByProvider.get(pp.providerId) || 0) + 1);
  }
  
  for (const p of providers) {
    p.patientCount = countByProvider.get(p.id) || 0;
  }
  
  // Create PROVIDERS table if not exists
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS GMH_CLINIC.PATIENT_DATA.PROVIDERS (
      PROVIDER_ID VARCHAR(50) PRIMARY KEY,
      HEALTHIE_USER_ID VARCHAR(50),
      FIRST_NAME VARCHAR(100),
      LAST_NAME VARCHAR(100),
      FULL_NAME VARCHAR(200),
      EMAIL VARCHAR(255),
      ACTIVE BOOLEAN,
      PATIENT_COUNT INT,
      CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      SYNCED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `;
  await executeSnowflake(conn, createTableSQL);
  console.log('  ✅ PROVIDERS table ready');
  
  // Upsert providers using MERGE
  for (const p of providers) {
    const mergeSQL = `
      MERGE INTO GMH_CLINIC.PATIENT_DATA.PROVIDERS t
      USING (SELECT 
        '${p.id}' AS HEALTHIE_USER_ID,
        '${p.firstName.replace(/'/g, "''")}' AS FIRST_NAME,
        '${p.lastName.replace(/'/g, "''")}' AS LAST_NAME,
        '${p.firstName.replace(/'/g, "''")} ${p.lastName.replace(/'/g, "''")}' AS FULL_NAME,
        '${p.email.replace(/'/g, "''")}' AS EMAIL,
        ${p.active} AS ACTIVE,
        ${p.patientCount} AS PATIENT_COUNT
      ) s
      ON t.HEALTHIE_USER_ID = s.HEALTHIE_USER_ID
      WHEN MATCHED THEN UPDATE SET
        FIRST_NAME = s.FIRST_NAME,
        LAST_NAME = s.LAST_NAME,
        FULL_NAME = s.FULL_NAME,
        EMAIL = s.EMAIL,
        ACTIVE = s.ACTIVE,
        PATIENT_COUNT = s.PATIENT_COUNT,
        SYNCED_AT = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (
        PROVIDER_ID, HEALTHIE_USER_ID, FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, ACTIVE, PATIENT_COUNT
      ) VALUES (
        UUID_STRING(), s.HEALTHIE_USER_ID, s.FIRST_NAME, s.LAST_NAME, s.FULL_NAME, s.EMAIL, s.ACTIVE, s.PATIENT_COUNT
      )
    `;
    await executeSnowflake(conn, mergeSQL);
  }
  console.log(`  ✅ Synced ${providers.length} providers`);
}

// Update patient PRESCRIBING_PROVIDER_ID
async function updatePatientProviders(
  conn: snowflake.Connection,
  patientProviders: PatientProvider[]
): Promise<void> {
  console.log('\n📤 Updating patient provider assignments...');
  
  let updated = 0;
  for (const pp of patientProviders) {
    const updateSQL = `
      UPDATE GMH_CLINIC.PATIENT_DATA.PATIENTS
      SET PRESCRIBING_PROVIDER_ID = '${pp.providerId}',
          UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE HEALTHIE_CLIENT_ID = '${pp.healthieClientId}'
        AND (PRESCRIBING_PROVIDER_ID IS NULL OR PRESCRIBING_PROVIDER_ID != '${pp.providerId}')
    `;
    
    try {
      const result = await executeSnowflake(conn, updateSQL);
      updated++;
    } catch (e) {
      // Ignore errors for patients not in our system
    }
    
    if (updated % 50 === 0) {
      process.stdout.write(`  Updated ${updated} patients...\r`);
    }
  }
  
  console.log(`\n  ✅ Updated provider assignments for ${updated} patients`);
}

async function main() {
  console.log('\n🔄 Healthie Provider Sync');
  console.log('=' .repeat(50));
  
  try {
    // Fetch data from Healthie
    const providers = await fetchProviders();
    console.log(`✅ Found ${providers.length} providers`);
    
    const patientProviders = await fetchPatientProviders();
    
    // Connect to Snowflake
    console.log('\n📡 Connecting to Snowflake...');
    const conn = await connectSnowflake();
    console.log('✅ Connected');
    
    // Sync data
    await syncProvidersToSnowflake(conn, providers, patientProviders);
    await updatePatientProviders(conn, patientProviders);
    
    // Show summary
    console.log('\n📊 Provider Summary:');
    providers
      .sort((a, b) => b.patientCount - a.patientCount)
      .forEach(p => {
        console.log(`  ${p.firstName} ${p.lastName}: ${p.patientCount} patients`);
      });
    
    conn.destroy(() => {});
    console.log('\n✅ Sync complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

/**
 * Check which active patients have Healthie packages (offerings)
 * Uses batched GraphQL aliases to minimize API calls
 * Rate-limited: 1 request per second, batches of 10
 */

import { getPool } from '../lib/db';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

interface PatientRow {
  patient_id: string;
  full_name: string;
  healthie_client_id: string;
  clinic: string;
  status_key: string;
}

interface PackageResult {
  patient_id: string;
  full_name: string;
  healthie_client_id: string;
  clinic: string;
  offerings: { id: string; name: string; price: string; billing_frequency: string }[];
  has_package: boolean;
}

async function healthieQuery(gql: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${HEALTHIE_API_KEY}`,
      'AuthorizationSource': 'API',
    },
    body: JSON.stringify({ query: gql, variables }),
  });

  if (response.status === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    throw new Error(`Healthie API HTTP ${response.status}`);
  }

  const result = await response.json();
  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
  }
  return result.data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const pool = getPool();

  // Get all active patients with Healthie IDs
  const { rows: patients } = await pool.query<PatientRow>(`
    SELECT patient_id, full_name, healthie_client_id, COALESCE(clinic, '') as clinic, status_key
    FROM patients
    WHERE status_key = 'active'
      AND healthie_client_id IS NOT NULL
      AND healthie_client_id != ''
    ORDER BY full_name
  `);

  console.log(`Found ${patients.length} active patients with Healthie IDs`);

  const results: PackageResult[] = [];
  const BATCH_SIZE = 10;
  const DELAY_MS = 1000; // 1 second between batches — very conservative

  for (let i = 0; i < patients.length; i += BATCH_SIZE) {
    const batch = patients.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(patients.length / BATCH_SIZE);

    // Build aliased query
    const aliases = batch.map((p, idx) => {
      return `u${idx}: user(id: "${p.healthie_client_id}") {
        id
        offerings {
          id
          name
          price
          billing_frequency
        }
      }`;
    }).join('\n    ');

    const query = `query { ${aliases} }`;

    try {
      process.stdout.write(`Batch ${batchNum}/${totalBatches} (patients ${i + 1}-${Math.min(i + BATCH_SIZE, patients.length)})...`);
      const data = await healthieQuery(query);

      for (let idx = 0; idx < batch.length; idx++) {
        const patient = batch[idx];
        const userData = data?.[`u${idx}`];
        const offerings = userData?.offerings || [];

        results.push({
          patient_id: patient.patient_id,
          full_name: patient.full_name,
          healthie_client_id: patient.healthie_client_id,
          clinic: patient.clinic,
          offerings,
          has_package: offerings.length > 0,
        });
      }
      console.log(' OK');
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        console.log(' RATE LIMITED - waiting 60s...');
        await sleep(60000);
        i -= BATCH_SIZE; // retry this batch
        continue;
      }
      console.error(` ERROR: ${err.message}`);
      // Still record these patients as unknown
      for (const patient of batch) {
        results.push({
          patient_id: patient.patient_id,
          full_name: patient.full_name,
          healthie_client_id: patient.healthie_client_id,
          clinic: patient.clinic,
          offerings: [],
          has_package: false,
        });
      }
    }

    // Rate limiting delay between batches
    if (i + BATCH_SIZE < patients.length) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  const withPackage = results.filter(r => r.has_package);
  const withoutPackage = results.filter(r => !r.has_package);

  console.log('\n' + '='.repeat(80));
  console.log(`RESULTS SUMMARY`);
  console.log('='.repeat(80));
  console.log(`Total active patients checked: ${results.length}`);
  console.log(`With Healthie package: ${withPackage.length}`);
  console.log(`WITHOUT Healthie package: ${withoutPackage.length}`);

  if (withPackage.length > 0) {
    console.log('\n--- PATIENTS WITH PACKAGES ---');
    for (const p of withPackage) {
      const pkgNames = p.offerings.map(o => `${o.name} ($${o.price}/${o.billing_frequency})`).join(', ');
      console.log(`  ${p.full_name} [${p.healthie_client_id}] → ${pkgNames}`);
    }
  }

  console.log('\n--- PATIENTS WITHOUT PACKAGES ---');
  for (const p of withoutPackage) {
    console.log(`  ${p.full_name} [${p.healthie_client_id}]${p.clinic ? ` (${p.clinic})` : ''}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

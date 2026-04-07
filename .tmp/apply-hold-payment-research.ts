/**
 * ONE-TIME SCRIPT: Set qualifying patients to hold_payment_research
 *
 * Criteria:
 * - status_key = 'active'
 * - payment_method_key = 'healthie'
 * - No recurring payment in Healthie
 * - Has testosterone dispense history
 * - NOT pro_bono
 * - NOT Phillip Schafer (12123979) or John Doe2 (13568112)
 */

import { getPool } from '../lib/db';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';
const EXCLUDED_HEALTHIE_IDS = ['12123979', '13568112']; // Phillip Schafer, John Doe2

async function healthieQuery(gql: string) {
  const response = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${HEALTHIE_API_KEY}`,
      'AuthorizationSource': 'API',
    },
    body: JSON.stringify({ query: gql }),
  });
  if (response.status === 429) throw new Error('RATE_LIMITED');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  return result.data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const pool = getPool();

  // Step 1: Get all active Healthie-payment patients with dispense history (excluding pro_bono and test accounts)
  const { rows: candidates } = await pool.query<{
    patient_id: string;
    full_name: string;
    healthie_client_id: string;
  }>(`
    SELECT p.patient_id, p.full_name, p.healthie_client_id
    FROM patients p
    WHERE p.status_key = 'active'
      AND p.payment_method_key = 'healthie'
      AND p.payment_method_key != 'pro_bono'
      AND p.healthie_client_id IS NOT NULL
      AND p.healthie_client_id != ''
      AND p.healthie_client_id NOT IN ($1, $2)
      AND EXISTS (SELECT 1 FROM dispenses d WHERE d.patient_id = p.patient_id)
    ORDER BY p.full_name
  `, EXCLUDED_HEALTHIE_IDS);

  console.log(`Found ${candidates.length} active Healthie patients with testosterone dispenses (excl. test accounts)\n`);

  // Step 2: Check which ones have NO recurring payment in Healthie
  const noPackage: typeof candidates = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const aliases = batch.map((p, idx) => `
      u${idx}: user(id: "${p.healthie_client_id}") {
        id
        next_recurring_payment { amount_paid }
      }
    `).join('\n');

    try {
      const data = await healthieQuery(`query { ${aliases} }`);
      for (let idx = 0; idx < batch.length; idx++) {
        const recurring = data?.[`u${idx}`]?.next_recurring_payment;
        if (!recurring?.amount_paid) {
          noPackage.push(batch[idx]);
        }
      }
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        console.log('RATE LIMITED — waiting 60s...');
        await sleep(60000);
        i -= BATCH_SIZE;
        continue;
      }
      console.error(`Batch error: ${err.message}`);
    }

    if (i + BATCH_SIZE < candidates.length) await sleep(1000);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`PATIENTS TO SET TO hold_payment_research: ${noPackage.length}`);
  console.log('='.repeat(70));

  if (noPackage.length === 0) {
    console.log('No patients qualify. Nothing to do.');
    await pool.end();
    return;
  }

  for (const p of noPackage) {
    console.log(`  ${p.full_name} [${p.healthie_client_id}]`);
  }

  // Step 3: Apply the status change
  console.log(`\nApplying status change to ${noPackage.length} patients...`);

  for (const p of noPackage) {
    try {
      await pool.query(`
        UPDATE patients
        SET status_key = 'hold_payment_research',
            alert_status = (SELECT display_name FROM patient_status_lookup WHERE status_key = 'hold_payment_research'),
            updated_at = NOW(),
            last_modified = NOW()
        WHERE patient_id = $1
          AND status_key = 'active'
      `, [p.patient_id]);
      console.log(`  [OK] ${p.full_name} → hold_payment_research`);
    } catch (err: any) {
      console.error(`  [FAIL] ${p.full_name}: ${err.message}`);
    }
  }

  console.log('\nDone. All qualifying patients set to hold_payment_research.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

/**
 * Check which active patients have recurring payments in Healthie
 * Uses batched GraphQL aliases, 1 req/sec rate limiting
 */

import { getPool } from '../lib/db';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

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
  if (result.errors) console.error('GraphQL errors:', JSON.stringify(result.errors).substring(0, 200));
  return result.data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const pool = getPool();

  const { rows: patients } = await pool.query<{
    patient_id: string;
    full_name: string;
    healthie_client_id: string;
    clinic: string;
  }>(`
    SELECT patient_id, full_name, healthie_client_id, COALESCE(clinic, '') as clinic
    FROM patients
    WHERE status_key = 'active'
      AND healthie_client_id IS NOT NULL
      AND healthie_client_id != ''
    ORDER BY full_name
  `);

  console.log(`Checking ${patients.length} active patients for recurring payments...\n`);

  interface Result {
    full_name: string;
    healthie_id: string;
    clinic: string;
    has_recurring: boolean;
    amount: string | null;
    next_date: string | null;
    has_card: boolean;
    card_info: string | null;
  }

  const results: Result[] = [];
  const BATCH_SIZE = 10;
  const DELAY_MS = 1000;

  for (let i = 0; i < patients.length; i += BATCH_SIZE) {
    const batch = patients.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(patients.length / BATCH_SIZE);

    const aliases = batch.map((p, idx) => `
      u${idx}: user(id: "${p.healthie_client_id}") {
        id
        next_recurring_payment {
          amount_paid
          start_at
        }
        stripe_customer_detail {
          card_type_label
          last_four
        }
      }
    `).join('\n');

    try {
      process.stdout.write(`Batch ${batchNum}/${totalBatches}...`);
      const data = await healthieQuery(`query { ${aliases} }`);

      for (let idx = 0; idx < batch.length; idx++) {
        const patient = batch[idx];
        const user = data?.[`u${idx}`];
        const recurring = user?.next_recurring_payment;
        const card = user?.stripe_customer_detail;

        results.push({
          full_name: patient.full_name,
          healthie_id: patient.healthie_client_id,
          clinic: patient.clinic,
          has_recurring: !!recurring?.amount_paid,
          amount: recurring?.amount_paid || null,
          next_date: recurring?.start_at || null,
          has_card: !!card?.card_type_label,
          card_info: card ? `${card.card_type_label} ****${card.last_four}` : null,
        });
      }
      console.log(' OK');
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        console.log(' RATE LIMITED - waiting 60s...');
        await sleep(60000);
        i -= BATCH_SIZE;
        continue;
      }
      console.error(` ERROR: ${err.message}`);
      for (const patient of batch) {
        results.push({
          full_name: patient.full_name,
          healthie_id: patient.healthie_client_id,
          clinic: patient.clinic,
          has_recurring: false,
          amount: null,
          next_date: null,
          has_card: false,
          card_info: null,
        });
      }
    }

    if (i + BATCH_SIZE < patients.length) await sleep(DELAY_MS);
  }

  // Categorize
  const withRecurring = results.filter(r => r.has_recurring);
  const withoutRecurring = results.filter(r => !r.has_recurring);
  const noCard = results.filter(r => !r.has_card);
  const noRecurringNoCard = results.filter(r => !r.has_recurring && !r.has_card);

  console.log('\n' + '='.repeat(80));
  console.log('RECURRING PAYMENT STATUS — ALL ACTIVE PATIENTS');
  console.log('='.repeat(80));
  console.log(`Total active patients: ${results.length}`);
  console.log(`WITH recurring payment: ${withRecurring.length}`);
  console.log(`WITHOUT recurring payment: ${withoutRecurring.length}`);
  console.log(`No card on file: ${noCard.length}`);
  console.log(`No recurring AND no card: ${noRecurringNoCard.length}`);

  console.log('\n\n--- PATIENTS WITH RECURRING PAYMENTS ---');
  for (const p of withRecurring) {
    const dateStr = p.next_date ? p.next_date.split(' ')[0] : 'N/A';
    console.log(`  ${p.full_name} — $${p.amount}/mo, next: ${dateStr}, card: ${p.card_info || 'NONE'}${p.clinic ? ` (${p.clinic})` : ''}`);
  }

  console.log('\n\n--- PATIENTS WITHOUT RECURRING PAYMENTS (NO PACKAGE) ---');
  for (const p of withoutRecurring) {
    const cardStr = p.has_card ? `card: ${p.card_info}` : 'NO CARD';
    console.log(`  ${p.full_name} [${p.healthie_id}] — ${cardStr}${p.clinic ? ` (${p.clinic})` : ''}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

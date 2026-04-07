/**
 * Find active patients with payment_method_key = 'healthie' who have no recurring payment
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
      AND payment_method_key = 'healthie'
      AND healthie_client_id IS NOT NULL
      AND healthie_client_id != ''
    ORDER BY full_name
  `);

  console.log(`Found ${patients.length} active patients with payment type = Healthie\n`);

  const noPackage: { full_name: string; healthie_id: string; clinic: string; has_card: boolean; card_info: string | null }[] = [];
  const withPackage: { full_name: string; healthie_id: string; clinic: string; amount: string; next_date: string }[] = [];

  const BATCH_SIZE = 10;
  const DELAY_MS = 1000;

  for (let i = 0; i < patients.length; i += BATCH_SIZE) {
    const batch = patients.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(patients.length / BATCH_SIZE);

    const aliases = batch.map((p, idx) => `
      u${idx}: user(id: "${p.healthie_client_id}") {
        id
        next_recurring_payment { amount_paid start_at }
        stripe_customer_detail { card_type_label last_four }
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

        if (recurring?.amount_paid) {
          withPackage.push({
            full_name: patient.full_name,
            healthie_id: patient.healthie_client_id,
            clinic: patient.clinic,
            amount: recurring.amount_paid,
            next_date: recurring.start_at?.split(' ')[0] || 'N/A',
          });
        } else {
          noPackage.push({
            full_name: patient.full_name,
            healthie_id: patient.healthie_client_id,
            clinic: patient.clinic,
            has_card: !!card?.card_type_label,
            card_info: card ? `${card.card_type_label} ****${card.last_four}` : null,
          });
        }
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
    }

    if (i + BATCH_SIZE < patients.length) await sleep(DELAY_MS);
  }

  console.log('\n' + '='.repeat(80));
  console.log('ACTIVE PATIENTS — PAYMENT TYPE: HEALTHIE — WITHOUT RECURRING PAYMENT');
  console.log('='.repeat(80));
  console.log(`Total Healthie-payment active patients: ${patients.length}`);
  console.log(`With recurring payment: ${withPackage.length}`);
  console.log(`WITHOUT recurring payment: ${noPackage.length}`);

  console.log('\n#  | Name | Healthie ID | Card on File | Clinic');
  console.log('-'.repeat(80));
  noPackage.forEach((p, i) => {
    const cardStr = p.has_card ? p.card_info : 'NO CARD';
    const clinicStr = p.clinic || '-';
    console.log(`${(i + 1).toString().padStart(2)}. ${p.full_name} | ${p.healthie_id} | ${cardStr} | ${clinicStr}`);
  });

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

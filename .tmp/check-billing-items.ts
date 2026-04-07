/**
 * Check a sample of active patients for billingItems with recurring payments
 * This checks the alternative billing mechanism vs offerings
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()).data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const pool = getPool();

  // Get a sample of 5 active patients
  const { rows: patients } = await pool.query(`
    SELECT patient_id, full_name, healthie_client_id
    FROM patients
    WHERE status_key = 'active'
      AND healthie_client_id IS NOT NULL
    ORDER BY full_name
    LIMIT 5
  `);

  console.log(`Checking billing items for ${patients.length} sample patients...\n`);

  for (const p of patients) {
    console.log(`--- ${p.full_name} [${p.healthie_client_id}] ---`);

    // Query multiple billing-related fields
    const data = await healthieQuery(`query {
      user(id: "${p.healthie_client_id}") {
        id
        first_name
        last_name
        active_tags {
          id
          name
        }
        offerings {
          id
          name
          price
          billing_frequency
        }
        next_recurring_payment {
          amount_paid
          start_at
        }
        upcoming_payments {
          amount_paid
        }
        stripe_customer_detail {
          card_type_label
          last_four
        }
      }
    }`);

    const user = data?.user;
    if (!user) {
      console.log('  User not found in Healthie');
      continue;
    }

    console.log(`  Offerings: ${JSON.stringify(user.offerings || [])}`);
    console.log(`  Next recurring payment: ${JSON.stringify(user.next_recurring_payment)}`);
    console.log(`  Upcoming payments: ${JSON.stringify(user.upcoming_payments || [])}`);
    console.log(`  Stripe: ${JSON.stringify(user.stripe_customer_detail)}`);
    console.log(`  Tags: ${JSON.stringify((user.active_tags || []).map((t: any) => t.name))}`);
    console.log('');

    await sleep(1000);
  }

  // Also check what offerings exist in the system
  console.log('\n=== AVAILABLE OFFERINGS IN HEALTHIE ===');
  const offeringsData = await healthieQuery(`query {
    offerings(offset: 0, page_size: 50, show_only_visible: true) {
      id
      name
      description
      price
      billing_frequency
      visibility
    }
  }`);

  const offerings = offeringsData?.offerings || [];
  console.log(`Found ${offerings.length} offerings:`);
  for (const o of offerings) {
    console.log(`  [${o.id}] ${o.name} - $${o.price}/${o.billing_frequency} (${o.visibility || 'visible'})`);
  }

  // Also check all offerings including hidden
  await sleep(1000);
  console.log('\n=== ALL OFFERINGS (including hidden) ===');
  const allOfferingsData = await healthieQuery(`query {
    offerings(offset: 0, page_size: 100) {
      id
      name
      description
      price
      billing_frequency
      visibility
    }
  }`);

  const allOfferings = allOfferingsData?.offerings || [];
  console.log(`Found ${allOfferings.length} total offerings:`);
  for (const o of allOfferings) {
    console.log(`  [${o.id}] ${o.name} - $${o.price}/${o.billing_frequency} (${o.visibility || 'N/A'})`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

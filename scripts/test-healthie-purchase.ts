#!/usr/bin/env npx tsx
/**
 * Create a test billing item in Healthie to trigger the webhook
 * This simulates a patient purchasing a peptide product
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

// Test patient: Use an existing test patient ID from Healthie
// We'll query for a patient first
const FIND_PATIENT_QUERY = `
  query FindPatient($email: String) {
    users(email: $email, first: 1) {
      id
      first_name
      last_name
      email
    }
  }
`;

// Create billing item for the patient with a peptide offering
const CREATE_BILLING_ITEM_MUTATION = `
  mutation CreateBillingItem($input: createBillingItemInput!) {
    createBillingItem(input: $input) {
      billingItem {
        id
        amount_paid
        sender {
          id
          first_name
          last_name
        }
        recipient {
          id
          first_name
          last_name
        }
        offering {
          id
          name
        }
      }
      messages {
        field
        message
      }
    }
  }
`;

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${HEALTHIE_API_KEY}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors.map((e: any) => e.message).join(', ')}`);
  }

  return result.data as T;
}

async function main() {
  console.log('=== TEST PEPTIDE PURCHASE ===\n');

  if (!HEALTHIE_API_KEY) {
    console.error('ERROR: HEALTHIE_API_KEY not set');
    return;
  }

  // 1. Use TEST CLIENT patient (known to be is_patient=true)
  console.log('1. Using TEST CLIENT patient (ID: 12088281)...');
  const patient = { id: '12088281', first_name: 'TEST CLIENT', last_name: 'Client' };
  console.log(`   Using: ${patient.first_name} ${patient.last_name} (ID: ${patient.id})`);

  // 2. Create billing item for Retatrutide (12mg) - ID 29095
  console.log('\n2. Creating billing item for Retatrutide (12mg)...');
  const billingResult = await graphql<any>(CREATE_BILLING_ITEM_MUTATION, {
    input: {
      recipient_id: patient.id,
      offering_id: '29095',  // Retatrutide (12 mg)
    }
  });

  if (billingResult.createBillingItem?.messages?.length > 0) {
    console.log('   Messages:', billingResult.createBillingItem.messages);
  }

  const billingItem = billingResult.createBillingItem?.billingItem;
  if (billingItem) {
    console.log('   ✅ Billing item created!');
    console.log(`   - ID: ${billingItem.id}`);
    console.log(`   - Amount: $${billingItem.amount}`);
    console.log(`   - Product: ${billingItem.offering?.name || 'N/A'}`);
    console.log(`   - Patient: ${billingItem.recipient?.first_name} ${billingItem.recipient?.last_name}`);
  } else {
    console.log('   ⚠️ Billing item not created - check Healthie settings');
    console.log('   Response:', JSON.stringify(billingResult, null, 2));
  }

  console.log('\n3. Waiting 5 seconds for webhook to fire...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n=== CHECK dashboard for new pending dispense ===');
  console.log('   URL: https://nowoptimal.com/ops/peptides');
}

main().catch(console.error);

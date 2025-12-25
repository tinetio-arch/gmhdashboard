#!/usr/bin/env tsx
/**
 * Test script to explore Healthie GraphQL API capabilities
 */

import 'dotenv/config';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

async function fetchGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
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
    console.error('API Error:', JSON.stringify(json.errors || json, null, 2));
    throw new Error(`Healthie API error: ${res.status}`);
  }
  
  return json.data;
}

async function introspectBillingQueries() {
  console.log('\n=== Introspecting Healthie API ===\n');
  
  const query = `{
    __schema {
      queryType {
        fields(includeDeprecated: false) {
          name
          args {
            name
            type { name kind ofType { name kind } }
          }
        }
      }
    }
  }`;
  
  const data: any = await fetchGraphQL(query);
  const fields = data.__schema.queryType.fields;
  
  // Find billing-related queries
  const relevantTerms = ['billing', 'invoice', 'payment', 'user', 'client', 'subscription', 'package'];
  const billingFields = fields.filter((f: any) => 
    relevantTerms.some(term => f.name.toLowerCase().includes(term))
  );
  
  console.log('Billing/Payment related queries:\n');
  for (const f of billingFields) {
    const args = f.args.map((a: any) => {
      const typeName = a.type.name || (a.type.ofType?.name ? `${a.type.kind}<${a.type.ofType.name}>` : a.type.kind);
      return `${a.name}: ${typeName}`;
    }).join(', ');
    console.log(`  ${f.name}(${args})`);
  }
}

async function testUserQuery(healthieClientId: string) {
  console.log(`\n=== Testing user query for ID: ${healthieClientId} ===\n`);
  
  // Query user with valid fields
  const query = `
    query GetUser($id: ID!) {
      user(id: $id) {
        id
        email
        first_name
        last_name
        phone_number
        dob
        
        stripe_customer_detail {
          id
        }
        
        active_packages {
          id
          package { id name price billing_frequency }
          is_active
          started_at
          credits_remaining
        }
      }
    }
  `;
  
  try {
    const data: any = await fetchGraphQL(query, { id: healthieClientId });
    console.log('User data:', JSON.stringify(data.user, null, 2));
  } catch (e: any) {
    console.error('Error querying user:', e.message);
  }
}

async function testBillingItemsForUser(healthieClientId: string) {
  console.log(`\n=== Testing billingItems with client_id filter ===\n`);
  
  // billingItems accepts client_id (from introspection)
  const query = `
    query BillingItemsForClient($client_id: ID) {
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
  
  try {
    const data: any = await fetchGraphQL(query, { client_id: healthieClientId });
    console.log('Billing items:', JSON.stringify(data.billingItems, null, 2));
    console.log(`Total items: ${data.billingItems?.length || 0}`);
    
    // Calculate total paid
    let totalPaid = 0;
    for (const item of data.billingItems || []) {
      if (item.state === 'succeeded') {
        totalPaid += parseFloat(item.amount_paid || '0');
      }
    }
    console.log(`\nTotal paid (succeeded): $${totalPaid.toFixed(2)}`);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function testRequestedPayments(healthieClientId: string) {
  console.log(`\n=== Testing requestedPayments (search by name) ===\n`);
  
  // requestedPayments doesn't accept client_id, use keywords or sender_id
  // Let's search by the patient name instead
  const query = `
    query RequestedPayments($keywords: String) {
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
  
  try {
    const data: any = await fetchGraphQL(query, { keywords: 'Andrew Lang' });
    console.log('Requested payments (searched by name):', JSON.stringify(data.requestedPayments, null, 2));
    console.log(`Total: ${data.requestedPayments?.length || 0}`);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function testRecurringPayments(healthieClientId: string) {
  console.log(`\n=== Testing recurringPayments for user_id: ${healthieClientId} ===\n`);
  
  const query = `
    query RecurringPayments($user_id: ID!) {
      recurringPayments(user_id: $user_id) {
        id
        price
        recurring_cadence
        is_active
        start_at
        next_pay_date
        offering { name }
        user { id full_name }
      }
    }
  `;
  
  try {
    const data: any = await fetchGraphQL(query, { user_id: healthieClientId });
    console.log('Recurring payments:', JSON.stringify(data.recurringPayments, null, 2));
    console.log(`Total: ${data.recurringPayments?.length || 0}`);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function findAndrewLang() {
  console.log('\n=== Searching for Andrew Lang ===\n');
  
  const query = `
    query FindUsers($keyword: String) {
      users(keywords: $keyword, page_size: 10) {
        id
        email
        first_name
        last_name
        phone_number
        active_tags { id name }
      }
    }
  `;
  
  try {
    const data: any = await fetchGraphQL(query, { keyword: 'Andrew Lang' });
    console.log('Found users:', JSON.stringify(data.users, null, 2));
    return data.users?.[0]?.id;
  } catch (e: any) {
    console.error('Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('Healthie API Test Script');
  console.log('========================');
  console.log(`API URL: ${HEALTHIE_API_URL}`);
  console.log(`API Key: ${HEALTHIE_API_KEY?.slice(0, 15)}...`);
  
  // First, introspect available queries
  await introspectBillingQueries();
  
  // Find Andrew Lang
  const andrewId = await findAndrewLang();
  
  if (andrewId) {
    console.log(`\nFound Andrew Lang with Healthie ID: ${andrewId}`);
    
    // Test each query type
    await testUserQuery(andrewId);
    await testBillingItemsForUser(andrewId);
    await testRecurringPayments(andrewId);
    await testRequestedPayments(andrewId);
  } else {
    console.log('\nCould not find Andrew Lang. Testing with a sample user ID...');
    // You can hardcode a known ID here for testing
  }
}

main().catch(console.error);

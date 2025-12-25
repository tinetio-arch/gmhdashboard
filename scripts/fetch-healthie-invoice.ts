#!/usr/bin/env npx tsx
/**
 * Fetch a specific requested payment (invoice) from Healthie
 * Usage: npx tsx scripts/fetch-healthie-invoice.ts <invoice_id>
 */

import fetch from 'node-fetch';

const invoiceId = process.argv[2];
if (!invoiceId) {
  console.error('Usage: npx tsx scripts/fetch-healthie-invoice.ts <invoice_id>');
  process.exit(1);
}

const query = `query GetRequestedPayment($id: ID) {
  requestedPayment(id: $id) {
    id
    recipient_id
    recipient { full_name email }
    sender { full_name }
    price
    balance_due
    status
    created_at
    updated_at
    paid_at
    email_sent_at
    invoice_type
    notes
    offering { name }
    currency
  }
}`;

async function main() {
  const res = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Basic ${process.env.HEALTHIE_API_KEY}`,
      authorizationsource: 'API'
    },
    body: JSON.stringify({ query, variables: { id: invoiceId } })
  });
  const data = await res.json() as any;
  
  if (data.errors) {
    console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
    return;
  }
  
  console.log(JSON.stringify(data.data?.requestedPayment, null, 2));
}

main().catch(console.error);

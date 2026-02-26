#!/usr/bin/env npx tsx
/**
 * Introspect Healthie GraphQL schema for a specific type
 * Usage: npx tsx scripts/introspect-healthie.ts TypeName
 */

import fetch from 'node-fetch';

const typeName = process.argv[2] || 'RequestedPayment';

const query = `query IntrospectType($typeName: String!) {
  __type(name: $typeName) {
    name
    kind
    fields { 
      name 
      description
      type { 
        name 
        kind 
        ofType { name kind } 
      } 
    }
    inputFields {
      name
      description
      type {
        name
        kind
        ofType { name kind }
      }
    }
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
    body: JSON.stringify({ query, variables: { typeName } })
  });
  const data = await res.json() as { data?: { __type: any }, errors?: any };

  if (data.errors) {
    console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
    return;
  }

  if (!data.data?.__type) {
    console.log(`Type "${typeName}" not found in schema`);
    return;
  }

  const type = data.data.__type;
  console.log(`\n=== ${type.name} (${type.kind}) ===\n`);

  if (type.fields) {
    console.log('Fields:');
    for (const field of type.fields) {
      const typePart = field.type.name || `${field.type.kind}<${field.type.ofType?.name}>`;
      console.log(`  ${field.name}: ${typePart}`);
    }
  }

  if (type.inputFields) {
    console.log('Input Fields:');
    for (const field of type.inputFields) {
      const typePart = field.type.name || `${field.type.kind}<${field.type.ofType?.name}>`;
      console.log(`  ${field.name}: ${typePart}`);
    }
  }
}

main().catch(console.error);

#!/usr/bin/env npx tsx
/**
 * Introspect Healthie GraphQL input types
 * Usage: npx tsx scripts/introspect-input.ts TypeName
 */

import fetch from 'node-fetch';

const typeName = process.argv[2] || 'updateClientInput';

const query = `query IntrospectInput($typeName: String!) {
  __type(name: $typeName) {
    name
    kind
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
  const data = await res.json() as any;
  
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
  
  if (type.inputFields) {
    console.log('Input Fields:');
    for (const field of type.inputFields) {
      const typePart = field.type.name || `${field.type.kind}<${field.type.ofType?.name}>`;
      const desc = field.description ? ` // ${field.description}` : '';
      console.log(`  ${field.name}: ${typePart}${desc}`);
    }
  }
}

main().catch(console.error);

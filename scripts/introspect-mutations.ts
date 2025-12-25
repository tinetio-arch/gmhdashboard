#!/usr/bin/env npx tsx
/**
 * Introspect Healthie GraphQL mutations
 * Usage: npx tsx scripts/introspect-mutations.ts
 */

import fetch from 'node-fetch';

const query = `query IntrospectMutations {
  __schema {
    mutationType {
      fields {
        name
        args {
          name
          type { name kind ofType { name kind ofType { name } } }
        }
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
    body: JSON.stringify({ query })
  });
  const data = await res.json() as any;
  
  if (data.errors) {
    console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
    return;
  }
  
  const mutations = data.data?.__schema?.mutationType?.fields || [];
  
  // Find client/user update mutations
  const updateMutations = mutations.filter((m: any) => 
    m.name.toLowerCase().includes('client') || 
    m.name.toLowerCase().includes('user') ||
    m.name.toLowerCase().includes('patient')
  );
  
  console.log('\n=== Client/User/Patient Mutations ===\n');
  for (const m of updateMutations) {
    console.log(`${m.name}:`);
    for (const arg of m.args) {
      const typeName = arg.type.name || arg.type.ofType?.name || arg.type.ofType?.ofType?.name || arg.type.kind;
      console.log(`  - ${arg.name}: ${typeName}`);
    }
    console.log('');
  }
}

main().catch(console.error);

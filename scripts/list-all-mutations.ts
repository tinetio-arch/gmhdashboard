#!/usr/bin/env npx tsx
/**
 * Get ALL Healthie GraphQL mutations
 */

import fetch from 'node-fetch';

const query = `query IntrospectAllMutations {
  __schema {
    mutationType {
      fields {
        name
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
    const mutationNames = mutations.map((m: any) => m.name).sort();

    console.log('\n=== ALL MUTATIONS ===\n');
    for (const name of mutationNames) {
        console.log(name);
    }

    console.log(`\n\nTotal: ${mutationNames.length} mutations`);

    // Find form/workflow related
    console.log('\n\n=== FORM/WORKFLOW RELATED ===\n');
    const formWorkflow = mutationNames.filter((n: string) =>
        n.toLowerCase().includes('form') ||
        n.toLowerCase().includes('module') ||
        n.toLowerCase().includes('intake') ||
        n.toLowerCase().includes('group')
    );
    for (const name of formWorkflow) {
        console.log(name);
    }
}

main().catch(console.error);

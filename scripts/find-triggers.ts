/**
 * Find Trigger-related types in Schema
 */
import fetch from 'node-fetch';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

const QUERY = `
query FindTriggers {
  __schema {
    types {
      name
      fields {
        name
      }
    }
  }
}
`;

async function executeGraphQL(query: string) {
    const apiKey = process.env.HEALTHIE_API_KEY;
    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query }),
    });
    return response.json();
}

async function main() {
    const data = await executeGraphQL(QUERY);
    const types = data.data.__schema.types;

    console.log("🔍 Searching for 'Trigger' or 'Automation'...");

    const relevant = types.filter((t: any) => {
        const name = t.name.toLowerCase();
        return name.includes('trigger') || name.includes('automation') || name.includes('rule');
    });

    relevant.forEach((t: any) => console.log(`- ${t.name}`));
}

main();

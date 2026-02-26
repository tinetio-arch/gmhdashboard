/**
 * Inspect Healthie Configuration
 * Fetches Locations, Users, and Appointment Types to map the clinic setup.
 */

import fetch from 'node-fetch';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

async function executeGraphQL(query: string, variables = {}) {
    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) throw new Error('HEALTHIE_API_KEY not set');

    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query, variables }),
    });

    const result = await response.json();
    if (result.errors) throw new Error(JSON.stringify(result.errors, null, 2));
    return result.data;
}

const QUERY = `
query DeepDive {
  locations {
    id
    name
    line1
    city
    state
    zip
  }
  organizationMembers {
    id
    first_name
    last_name
    email
    is_owner
    user_groups {
      id
      name
    }
  }
  appointmentTypes {
    id
    name
    length
    is_group
    pricing
  }
}
`;

async function main() {
    try {
        console.log("🔍 Starting Healthie Deep Dive...");
        const data = await executeGraphQL(QUERY);

        console.log("\n📍 LOCATIONS:");
        data.locations.forEach((loc: any) => {
            console.log(`- [${loc.id}] ${loc.name}`);
            console.log(`  ${loc.line1 || ''}, ${loc.city}, ${loc.state} ${loc.zip}`);
        });

        console.log("\n👨‍⚕️ STAFF (Providers/Admins):");
        data.organizationMembers.forEach((user: any) => {
            console.log(`- [${user.id}] ${user.first_name} ${user.last_name} (${user.email})`);
            if (user.user_groups?.length) {
                console.log(`  Groups: ${user.user_groups.map((g: any) => g.name).join(', ')}`);
            }
        });

        console.log("\n📅 APPOINTMENT TYPES:");
        // Sorting for readability using logic instead of GraphQL sort which might fail if unsupported
        const sortedTypes = data.appointmentTypes.sort((a: any, b: any) => a.name.localeCompare(b.name));
        sortedTypes.forEach((type: any) => {
            console.log(`- [${type.id}] ${type.name} (${type.length}m)`);
        });

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

main();

/**
 * Inspect Healthie Workflows
 * Fetches Client Groups and attempts to find Intake Flow configurations.
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
query WorkflowDeepDive {
  # Inspect Client Groups
  userGroups(page: 1, per_page: 50) {
    id
    name
    smart_soft_allocation
  }
  
  # Try to find Intake Flows (Note: Schema introspection showed no direct 'intakeFlows' query, 
  # so we check 'onboarding_flows' or similar if they exist, otherwise we infer from other data)
  # Based on schema guessing - if this fails we will use introspection to find the right field
}
`;

// Backup introspection if the above simple query fails
const INTROSPECT_QUERY = `
query FindFlowTypes {
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

async function main() {
  try {
    console.log("🔍 Inspecting Onboarding Flows...");
    const flowData = await executeGraphQL(`
          query GetDeepWorkflowData {
            userGroups {
              id
              name
            }
            onboardingFlows {
              id
              name
              user_groups {
                id
                name
              }
              onboarding_items {
                id
                display_name
                item_type
                is_skippable
                item_id
              }
            }
          }
        `);

    console.log("\n🌊 ONBOARDING FLOWS (Intake Workflows):");
    flowData.onboardingFlows.forEach((flow: any) => {
      console.log(`\nFlow: "${flow.name}" (ID: ${flow.id})`);

      if (flow.user_groups && flow.user_groups.length > 0) {
        console.log(`  Target Groups: ${flow.user_groups.map((g: any) => `[${g.id}] ${g.name}`).join(', ')}`);
      } else {
        console.log(`  Target Groups: (None/Default?)`);
      }

      console.log(`  Items:`);
      flow.onboarding_items.forEach((item: any) => {
        console.log(`    - [${item.item_type}] ${item.display_name} (Item ID: ${item.item_id}) ${item.is_skippable ? '(Optional)' : ''}`);
      });
    });

    // Map Groups to Flows logic
    console.log("\n📋 GROUP ASSIGNMENT SUMMARY:");
    const groups = flowData.userGroups;
    groups.forEach((g: any) => {
      const flowsForGroup = flowData.onboardingFlows.filter((f: any) =>
        f.user_groups.some((ug: any) => ug.id === g.id)
      );
      console.log(`Group [${g.id}] "${g.name}" receives:`);
      if (flowsForGroup.length === 0) console.log("  - (No explicit flow assigned)");
      flowsForGroup.forEach((f: any) => console.log(`  - Flow: "${f.name}"`));
    });

  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();

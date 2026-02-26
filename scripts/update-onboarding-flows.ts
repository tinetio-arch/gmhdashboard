/**
 * Update Onboarding Flows
 * Adds missing "Default" forms to "Men's Health" and "Weight Loss" flows.
 */

import fetch from 'node-fetch';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

// Form IDs (from previous inspection)
const FORMS = {
    HIPAA: '2898628',
    CONSENT_TREAT: '2898608',
    AI_SCRIBE: '2898621',
    MEDICAL_HISTORY: '2898619'
};

// Flow IDs
const FLOWS = {
    MENS_HEALTH: '118068',
    WEIGHT_LOSS: '118643'
};

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

const ADD_ITEM_MUTATION = `
mutation AddItem($input: createOnboardingItemInput!) {
  createOnboardingItem(input: $input) {
    onboardingItem {
      id
      display_name
    }
  }
}
`;

async function addItem(flowId: string, formId: string, name: string) {
    // Try 'custom_module_form' first, as it's the standard API name for forms
    const variables = {
        input: {
            onboarding_flow_id: flowId,
            item_type: "custom_module_form",
            item_id: formId,
            is_skippable: false
        }
    };

    try {
        console.log(`Adding '${name}' (${formId}) to Flow ${flowId}...`);
        const data = await executeGraphQL(ADD_ITEM_MUTATION, variables);
        console.log(`✅ Success: Added item ${data.createOnboardingItem.onboardingItem.id}`);
    } catch (error) {
        console.error(`❌ Failed to add '${name}':`, error);
        // Fallback or inspection could happen here if 'item_type' is wrong
    }
}

async function main() {
    console.log("🚀 Updating Intake Flows...");

    // 1. Update Men's Health Flow (Needs Consent & AI)
    // It already has HIPAA and Men's Intake.
    await addItem(FLOWS.MENS_HEALTH, FORMS.CONSENT_TREAT, "Consent to Treat");
    await addItem(FLOWS.MENS_HEALTH, FORMS.AI_SCRIBE, "AI Scribe Consent");

    // 2. Update Weight Loss Flow (Empty - Needs Everything)
    await addItem(FLOWS.WEIGHT_LOSS, FORMS.HIPAA, "HIPAA Agreement");
    await addItem(FLOWS.WEIGHT_LOSS, FORMS.CONSENT_TREAT, "Consent to Treat");
    await addItem(FLOWS.WEIGHT_LOSS, FORMS.AI_SCRIBE, "AI Scribe Consent");
    await addItem(FLOWS.WEIGHT_LOSS, FORMS.MEDICAL_HISTORY, "Medical History");
    // Note: Weight Loss Agreement is still missing from the system forms list entirely? 
    // Or we haven't found its ID yet. We'll skip it for now.

    console.log("🏁 Done.");
}

main();

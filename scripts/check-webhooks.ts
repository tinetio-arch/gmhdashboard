/**
 * List Webhook Events
 */
import fetch from 'node-fetch';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

const QUERY = `
query GetWebhookEvents {
  webhookEventTypes
}
`;

async function main() {
    const apiKey = process.env.HEALTHIE_API_KEY;
    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query: QUERY }),
    });

    const result = await response.json();
    console.log("Webhook Events:", result.data.webhookEventTypes);
}

main();

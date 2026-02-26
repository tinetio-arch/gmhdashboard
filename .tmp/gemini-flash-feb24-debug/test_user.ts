import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const headers = {
    'Authorization': `Basic ${HEALTHIE_API_KEY}`,
    'AuthorizationSource': 'API',
    'Content-Type': 'application/json',
};

async function testQuery(id: string) {
    const query = `
        query {
            user(id: "${id}") {
                id
                first_name
                last_name
            }
        }
    `;

    const res = await fetch('https://api.gethealthie.com/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query })
    });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
}

testQuery(process.argv[2] || "122123979");

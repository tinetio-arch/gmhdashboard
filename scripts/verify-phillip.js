#!/usr/bin/env node
/**
 * Quick check: Is Phillip Schafer actually deactivated in Healthie?
 * Uses the actual HealthieClient class to verify.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

// We need ts-node or tsx to import the TypeScript module, so let's use the raw GraphQL approach
const https = require('https');

const API_KEY = process.env.HEALTHIE_API_KEY;
const PHILLIP_ID = '12123979';

async function graphql(query, variables) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query, variables });
        const req = https.request({
            hostname: 'api.gethealthie.com', path: '/graphql', method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + API_KEY,
                'AuthorizationSource': 'API'
            }
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch { resolve({ raw: d }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function run() {
    // 1. Check Phillip's current status using the EXACT same query as getClient
    console.log('=== CHECKING PHILLIP SCHAFER (Healthie ID: 12123979) ===');
    const result = await graphql(`
    query GetClient($id: ID!) {
      user(id: $id) {
        id
        first_name
        last_name
        email
        phone_number
        dob
        user_group_id
        active
        created_at
        updated_at
      }
    }
  `, { id: PHILLIP_ID });

    console.log('Full response:', JSON.stringify(result, null, 2));

    const user = result?.data?.user;
    if (user) {
        console.log(`\nName: ${user.first_name} ${user.last_name}`);
        console.log(`Email: ${user.email}`);
        console.log(`Active: ${user.active}`);
        console.log(`DOB: ${user.dob}`);
    } else {
        console.log('User not found or error:', JSON.stringify(result?.errors));
    }

    // 2. If still active, try deactivating again and verify
    if (user?.active === true) {
        console.log('\n=== STILL ACTIVE — RE-DEACTIVATING ===');
        const deactivate = await graphql(`
      mutation UpdateClient($input: updateClientInput!) {
        updateClient(input: $input) {
          user {
            id
            first_name
            last_name
            active
          }
          messages { field message }
        }
      }
    `, { input: { id: PHILLIP_ID, active: false } });

        console.log('Deactivation response:', JSON.stringify(deactivate, null, 2));

        // Re-check
        const recheck = await graphql(`
      query GetClient($id: ID!) {
        user(id: $id) { id first_name last_name active }
      }
    `, { id: PHILLIP_ID });
        console.log('\nAfter deactivation:', JSON.stringify(recheck?.data?.user));
    } else if (user?.active === false) {
        console.log('\n✅ User IS deactivated (active=false). The issue is likely in the headless app not checking active status.');
    }
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

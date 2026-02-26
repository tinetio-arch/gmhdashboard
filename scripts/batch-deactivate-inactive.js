#!/usr/bin/env node
/**
 * Batch-deactivate all inactive GMH patients in Healthie.
 * Sets active=false for patients with status_key='inactive' who have a Healthie account.
 * 
 * Usage: node scripts/batch-deactivate-inactive.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const https = require('https');
const { Client } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

async function deactivateInHealthie(healthieId, apiKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            query: `mutation UpdateClient($input: updateClientInput!) {
        updateClient(input: $input) {
          user { id first_name last_name active }
          messages { field message }
        }
      }`,
            variables: { input: { id: healthieId, active: false } }
        });
        const req = https.request({
            hostname: 'api.gethealthie.com', path: '/graphql', method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + apiKey,
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
    const c = new Client({
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
    });
    await c.connect();

    // Get all inactive patients with Healthie IDs
    const result = await c.query(`
    SELECT p.patient_id, p.full_name, 
           COALESCE(hc.healthie_client_id, p.healthie_client_id) as healthie_client_id
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text
    WHERE p.status_key = 'inactive'
      AND COALESCE(hc.healthie_client_id, p.healthie_client_id) IS NOT NULL
    ORDER BY p.full_name
  `);

    console.log(`Found ${result.rows.length} inactive patients with Healthie accounts`);
    console.log(DRY_RUN ? '*** DRY RUN - no changes will be made ***\n' : '\n');

    let success = 0, failed = 0, skipped = 0;

    for (const row of result.rows) {
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would deactivate: ${row.full_name} (Healthie: ${row.healthie_client_id})`);
            skipped++;
            continue;
        }

        try {
            const resp = await deactivateInHealthie(row.healthie_client_id, process.env.HEALTHIE_API_KEY);
            const user = resp?.data?.updateClient?.user;
            const errors = resp?.data?.updateClient?.messages;

            if (errors && errors.length > 0) {
                console.log(`  ❌ ${row.full_name} (${row.healthie_client_id}): ${errors.map(e => e.message).join(', ')}`);
                failed++;
            } else if (user) {
                console.log(`  ✅ ${row.full_name} (${row.healthie_client_id}): active=${user.active}`);
                success++;
            } else {
                console.log(`  ⚠️  ${row.full_name} (${row.healthie_client_id}): unexpected response`);
                failed++;
            }

            // Rate limit: 100ms between requests
            await new Promise(r => setTimeout(r, 100));
        } catch (err) {
            console.log(`  ❌ ${row.full_name} (${row.healthie_client_id}): ${err.message}`);
            failed++;
        }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Success: ${success}, Failed: ${failed}, Skipped: ${skipped}`);

    await c.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

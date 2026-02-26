#!/usr/bin/env node
// Check Phillip Schafer's Healthie active status and clean up duplicate healthie_clients
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const https = require('https');
const { Client } = require('pg');

async function checkHealthie(id) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: `{ user(id: "${id}") { id first_name last_name email active dob active_status } }` });
        const req = https.request({
            hostname: 'api.gethealthie.com', path: '/graphql', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + process.env.HEALTHIE_API_KEY, 'AuthorizationSource': 'API' }
        }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function run() {
    // 1. Check Phillip Schafer in Healthie
    console.log('=== CHECKING PHILLIP SCHAFER IN HEALTHIE (ID: 12123979) ===');
    const ps = await checkHealthie('12123979');
    console.log('Healthie response:', JSON.stringify(ps.data?.user, null, 2));
    console.log('ACTIVE:', ps.data?.user?.active);
    console.log('ACTIVE_STATUS:', ps.data?.user?.active_status);

    // 2. Connect to DB and clean up duplicate healthie_clients
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

    // Clean up duplicate healthie_clients - keep the oldest row for each patient
    console.log('\n=== CLEANING UP DUPLICATE HEALTHIE_CLIENTS ===');
    const dupes = await c.query(`
    DELETE FROM healthie_clients 
    WHERE id NOT IN (
      SELECT MIN(id) FROM healthie_clients GROUP BY patient_id
    )
    RETURNING patient_id, healthie_client_id
  `);
    console.log('Deleted duplicate rows:', dupes.rowCount);
    dupes.rows.forEach(r => console.log('  Deleted: patient=' + r.patient_id + ', healthie=' + r.healthie_client_id));

    // Count inactive patients that need auto-revoke
    console.log('\n=== INACTIVE PATIENTS (need auto-revoke) ===');
    const inactive = await c.query(`
    SELECT p.full_name, p.patient_id, p.status_key, hc.healthie_client_id
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text
    WHERE p.status_key = 'inactive'
    ORDER BY p.full_name
  `);
    console.log('Inactive patients:', inactive.rows.length);
    inactive.rows.slice(0, 10).forEach(r => console.log('  ' + r.full_name + ' (healthie=' + r.healthie_client_id + ')'));
    if (inactive.rows.length > 10) console.log('  ... and', inactive.rows.length - 10, 'more');

    await c.end();
    console.log('\nDone.');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

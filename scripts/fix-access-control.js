#!/usr/bin/env node
// Fix access control: map patients, check revoke records, diagnose duplicates
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const { Client } = require('pg');

async function run() {
    // Use credentials from .env.local directly
    const c = new Client({
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        query_timeout: 10000,
    });

    await c.connect();
    console.log('Connected to production DB (postgres/clinicadmin)');

    // 1. Check revoke records
    console.log('\n=== REVOKE RECORDS ===');
    const revokes = await c.query(`
    SELECT aac.id, p.full_name, aac.access_status, aac.healthie_synced, 
           aac.healthie_sync_error, aac.created_at 
    FROM app_access_controls aac 
    LEFT JOIN patients p ON p.patient_id = aac.patient_id 
    ORDER BY aac.created_at DESC LIMIT 5
  `);
    console.log('Records:', revokes.rows.length);
    revokes.rows.forEach(r => console.log(`  ${r.full_name}: ${r.access_status}, synced=${r.healthie_synced}, error=${r.healthie_sync_error}, at=${r.created_at}`));

    // 2. Anthony Bennett investigation
    console.log('\n=== ANTHONY BENNETT ===');
    const ab = await c.query(`SELECT patient_id, full_name, email, status_key FROM patients WHERE full_name ILIKE '%anthony%bennet%'`);
    console.log('Patient records:', ab.rows.length);
    ab.rows.forEach(r => console.log(`  ${r.patient_id}: ${r.full_name} (${r.email}) status=${r.status_key}`));

    const abHc = await c.query(`SELECT hc.* FROM healthie_clients hc WHERE hc.patient_id IN (SELECT patient_id::text FROM patients WHERE full_name ILIKE '%anthony%bennet%')`);
    console.log('Healthie client entries:', abHc.rows.length);
    abHc.rows.forEach(r => console.log(`  patient=${r.patient_id}, healthie=${r.healthie_client_id}, active=${r.is_active}`));

    // 3. Map Kyle Layton
    console.log('\n=== MAPPING KYLE LAYTON ===');
    const kyle = await c.query(`
    INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active)
    SELECT patient_id::text, '13436959', 'manual_script', true
    FROM patients WHERE full_name ILIKE '%Kyle%Layton%' LIMIT 1
    ON CONFLICT (healthie_client_id) DO NOTHING RETURNING *
  `);
    console.log('Kyle mapped:', kyle.rowCount, 'rows inserted');

    // 4. Map Amanda Austin
    console.log('\n=== MAPPING AMANDA AUSTIN ===');
    const amanda = await c.query(`
    INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active)
    SELECT patient_id::text, '12705573', 'manual_script', true
    FROM patients WHERE full_name = 'Amanda Austin' LIMIT 1
    ON CONFLICT (healthie_client_id) DO NOTHING RETURNING *
  `);
    console.log('Amanda mapped:', amanda.rowCount, 'rows inserted');

    // 5. Check Phillip Schafer
    console.log('\n=== PHILLIP SCHAFER ===');
    const ps = await c.query(`
    SELECT p.patient_id, p.full_name, p.healthie_client_id as p_healthie_id, 
           hc.healthie_client_id as hc_healthie_id
    FROM patients p 
    LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text 
    WHERE p.full_name ILIKE '%schafer%' OR p.full_name ILIKE '%phillip%sch%'
  `);
    ps.rows.forEach(r => console.log(`  ${r.full_name}: patient_healthie=${r.p_healthie_id}, hc_healthie=${r.hc_healthie_id}`));

    // 6. Remaining unmapped (non-inactive)
    const unmapped = await c.query(`
    SELECT COUNT(*)::int as n FROM patients p 
    LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text 
    WHERE hc.id IS NULL AND COALESCE(p.status_key,'') NOT IN ('inactive')
  `);
    console.log('\nRemaining unmapped (non-inactive):', unmapped.rows[0].n);

    // 7. Duplicate check - patients with multiple healthie_clients rows
    console.log('\n=== PATIENTS WITH MULTIPLE HEALTHIE_CLIENTS ROWS ===');
    const dupes = await c.query(`
    SELECT p.full_name, COUNT(*)::int as hc_count 
    FROM healthie_clients hc 
    JOIN patients p ON p.patient_id::text = hc.patient_id 
    GROUP BY p.full_name, hc.patient_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC LIMIT 10
  `);
    console.log('Patients with multiple HC rows:', dupes.rows.length);
    dupes.rows.forEach(r => console.log(`  ${r.full_name}: ${r.hc_count} rows`));

    await c.end();
    console.log('\nDone.');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

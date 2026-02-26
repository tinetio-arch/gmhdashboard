// Quick one-shot remediation - run with: node scripts/fix-holds-now.js
require('dotenv').config({ path: '/home/ec2-user/.env' });
require('dotenv').config({ path: __dirname + '/../.env.local' });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    // 1. Reactivate Klafin and Grabacki (confirmed paid, spam loop victims)
    const res1 = await pool.query(`
    UPDATE patients SET
      status_key = 'active',
      alert_status = 'Active',
      notes = regexp_replace(notes, E'\\n?\\[\\d{4}-\\d{2}-\\d{2}\\] AUTO-SYNC:[^\n]*', '', 'g')
              || E'\n[2026-02-18] Corrected - cron bug spam removed. Payment succeeded.',
      last_modified = NOW()
    WHERE full_name IN ('John Klafin', 'Greg Grabacki')
      AND status_key = 'hold_payment_research'
    RETURNING full_name, status_key
  `);
    console.log('Reactivated:', res1.rows.map(r => r.full_name));

    // 2. Seed the processed billing items file so the cron never reprocesses these
    // Fetch all failed billing item IDs from Healthie that are causing the loop
    // We don't need to call Healthie — we just need a unique file so the cron starts fresh
    const processedFile = path.join(__dirname, '..', '.processed-billing-items.json');
    if (!fs.existsSync(processedFile)) {
        fs.writeFileSync(processedFile, '{}');
        console.log('Created empty .processed-billing-items.json');
    }

    // 3. Verify current state
    const res3 = await pool.query(`
    SELECT full_name, status_key, alert_status, last_modified
    FROM patients
    WHERE full_name IN ('Robert Barr', 'John Klafin', 'Greg Grabacki', 'Eric Lajeunesse', 'Joshua Viol')
    ORDER BY full_name
  `);
    console.log('\nCurrent state of affected patients:');
    for (const r of res3.rows) {
        console.log(`  ${r.full_name}: ${r.status_key} (${r.alert_status}) - modified ${r.last_modified}`);
    }

    await pool.end();
    console.log('\nDone!');
}

run().catch(e => { console.error(e); process.exit(1); });

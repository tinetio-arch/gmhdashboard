const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r1 = await p.query(`SELECT COUNT(*)::int FROM patients`);
  const r2 = await p.query(`SELECT COUNT(*)::int FROM dispenses WHERE dispense_date > NOW() - INTERVAL '7 days'`);
  const r3 = await p.query(`SELECT COUNT(*)::int FROM peptide_dispenses WHERE sale_date > NOW() - INTERVAL '7 days'`);
  const r4 = await p.query(`SELECT to_status, blocked, COUNT(*)::int n FROM patient_status_audit WHERE created_at > NOW() - INTERVAL '6 hours' GROUP BY to_status, blocked ORDER BY 3 DESC LIMIT 20`);
  console.log('Total patients:', r1.rows[0].count);
  console.log('TRT dispenses last 7d:', r2.rows[0].count);
  console.log('Peptide dispenses last 7d:', r3.rows[0].count);
  console.log('Status audit last 6h:', JSON.stringify(r4.rows, null, 2));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });

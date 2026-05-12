const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r1 = await p.query(`SELECT COUNT(*)::int AS n, MAX(updated_at) AS latest FROM prescription_cache`);
  const r2 = await p.query(`SELECT COUNT(*)::int AS n FROM prescription_cache WHERE updated_at > NOW() - INTERVAL '10 minutes'`);
  const r3 = await p.query(`SELECT healthie_patient_id, COUNT(*)::int n FROM prescription_cache WHERE updated_at > NOW() - INTERVAL '10 minutes' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
  console.log('Total prescription_cache rows:', r1.rows[0].n, 'latest:', r1.rows[0].latest);
  console.log('Synced last 10min:', r2.rows[0].n);
  console.log('Top patients synced last 10min:', JSON.stringify(r3.rows, null, 2));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });

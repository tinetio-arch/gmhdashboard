const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // All blocked attempts since Phase 1 went live
  const r = await p.query(`
    SELECT date_trunc('hour', created_at) AS hour, source, blocked, COUNT(*)::int n
    FROM patient_status_audit
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 4 DESC
  `);
  console.log('=== Audit summary last 24h ===');
  console.log(JSON.stringify(r.rows, null, 2));
  
  // Recent unique patients with status changes
  const r2 = await p.query(`
    SELECT patient_id, COUNT(*)::int n, MAX(created_at) AS last
    FROM patient_status_audit
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY patient_id
    ORDER BY last DESC
    LIMIT 10
  `);
  console.log('=== Recent unique patients ===');
  console.log(JSON.stringify(r2.rows, null, 2));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });

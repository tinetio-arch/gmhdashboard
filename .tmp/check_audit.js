const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`SELECT created_at, patient_id, from_status, to_status, source, actor, reason, blocked, block_reason, metadata FROM patient_status_audit WHERE created_at > NOW() - INTERVAL '12 hours' ORDER BY created_at DESC LIMIT 50`);
  console.log(JSON.stringify(r.rows, null, 2));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });

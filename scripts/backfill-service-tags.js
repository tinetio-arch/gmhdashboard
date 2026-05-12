/* eslint-disable */
/**
 * Backfill patient_service_tags from Healthie appointment types.
 *
 * Scope: patients with patient_type IN ('intermittent','member') and healthie_client_id, who don't yet
 * have rows in patient_service_tags for the detected tags. Covers the 71 we just classified + any
 * existing classified patients missing their overlay tags (e.g., Member + pelleting pattern).
 *
 * Rate-limited 1500ms between Healthie calls. Idempotent — no duplicate inserts.
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fetchFn = global.fetch || require('node-fetch').default || require('node-fetch');
const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const RATE_MS = 1500;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function healthieAppointments(userId) {
  const query = `query($userId: ID!) { appointments(user_id: $userId, should_paginate: false, filter: "all") { appointment_type { name } } }`;
  const r = await fetchFn(HEALTHIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
    body: JSON.stringify({ query, variables: { userId: String(userId) } })
  });
  const j = await r.json();
  return j.data?.appointments || [];
}

const TAG_RULES = [
  { re: /pelleting/i,                                                     tag: 'pelleting' },
  { re: /peptide/i,                                                       tag: 'peptides' },
  { re: /weight.?loss|\bglp\b|semaglutide|tirzepatide/i,                  tag: 'weight-loss' }
];

function detectTags(appts) {
  const tags = new Set();
  for (const a of appts || []) {
    const name = a.appointment_type?.name || '';
    for (const rule of TAG_RULES) {
      if (rule.re.test(name)) tags.add(rule.tag);
    }
  }
  return [...tags];
}

async function main() {
  // Scope: intermittent OR member, with healthie ID
  const candidates = (await pool.query(`
    SELECT patient_id::text AS pid, full_name, healthie_client_id, patient_type, client_type
    FROM patients
    WHERE healthie_client_id IS NOT NULL
      AND patient_type IN ('intermittent','member')
    ORDER BY patient_type, full_name
  `)).rows;

  console.log(`Scope: ${candidates.length} candidates (patient_type IN intermittent/member, has Healthie ID)`);
  console.log(`Rate limit: ${RATE_MS}ms between calls (~${Math.round(candidates.length*RATE_MS/1000/60)}min)\n`);

  let fetched = 0, inserted = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    process.stdout.write(`\r[${i+1}/${candidates.length}] ${(p.full_name||'').slice(0,30).padEnd(30)} `);
    let appts;
    try {
      appts = await healthieAppointments(p.healthie_client_id);
      fetched++;
    } catch (e) {
      errors.push({ pid: p.pid, name: p.full_name, err: e.message });
      await sleep(RATE_MS);
      continue;
    }
    const tags = detectTags(appts);
    if (tags.length === 0) { skipped++; await sleep(RATE_MS); continue; }

    for (const tag of tags) {
      // Insert if not exists
      const r = await pool.query(
        `INSERT INTO patient_service_tags (patient_id, healthie_user_id, tag, added_by, added_at)
         SELECT $1, $2, $3, 'antigravity-backfill-2026-04-17', NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM patient_service_tags WHERE patient_id = $1 AND tag = $3
         )
         RETURNING id`,
        [p.pid, p.healthie_client_id, tag]
      );
      if (r.rowCount > 0) inserted++;
    }
    await sleep(RATE_MS);
  }
  console.log('\n\nSummary:');
  console.log(`  Healthie fetches: ${fetched}`);
  console.log(`  Tags inserted (new): ${inserted}`);
  console.log(`  Skipped (no tag signal): ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('   -', e.name, ':', e.err));

  // Distribution after
  const dist = await pool.query(`SELECT tag, COUNT(*) FROM patient_service_tags GROUP BY tag ORDER BY COUNT(*) DESC`);
  console.log('\nFinal tag distribution:');
  dist.rows.forEach(r => console.log(' ', r.tag.padEnd(20), '→', r.count));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

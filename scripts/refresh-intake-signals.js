/* eslint-disable */
/**
 * Nightly Healthie intake-state refresh.
 *
 * For every patient with a healthie_client_id, pulls `any_incomplete_onboarding_steps`
 * and the count of finished/total form_answer_groups, then upserts into patient_signals_cache.
 *
 * Rate-limited (1s between calls) to avoid Healthie rate limits.
 * Safe to re-run. Errors on individual patients are captured in intake_error — they don't
 * halt the batch.
 *
 * Run nightly via cron:
 *   0 3 * * * cd /home/ec2-user/gmhdashboard && node scripts/refresh-intake-signals.js >> /tmp/intake-refresh.log 2>&1
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fetchFn = global.fetch || require('node-fetch').default || require('node-fetch');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const RATE_LIMIT_MS = 1000;

if (!API_KEY) { console.error('HEALTHIE_API_KEY missing'); process.exit(1); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function healthieIntake(userId) {
  const query = `query($id: ID!) {
    user(id: $id) {
      id
      any_incomplete_onboarding_steps
      form_answer_groups { id finished }
    }
  }`;
  const r = await fetchFn(HEALTHIE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + API_KEY,
      'AuthorizationSource': 'API'
    },
    body: JSON.stringify({ query, variables: { id: String(userId) } })
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const j = await r.json();
  if (j.errors) return { error: JSON.stringify(j.errors).slice(0, 200) };
  const u = j.data?.user;
  if (!u) return { error: 'user_not_found_in_healthie' };
  const groups = u.form_answer_groups || [];
  const finished = groups.filter(g => g.finished).length;
  const total = groups.length;
  const anyIncomplete = !!u.any_incomplete_onboarding_steps;
  let state;
  if (!anyIncomplete && finished > 0) state = 'good';
  else if (anyIncomplete && finished > 0) state = 'warn';
  else if (anyIncomplete && finished === 0) state = 'bad';
  else state = 'none';
  return { state, anyIncomplete, finished, total };
}

async function main() {
  const candidates = (await pool.query(`
    SELECT patient_id::text AS pid, full_name, healthie_client_id
    FROM patients
    WHERE healthie_client_id IS NOT NULL
    ORDER BY patient_id
  `)).rows;

  console.log(`Intake refresh: ${candidates.length} patients (rate-limited ${RATE_LIMIT_MS}ms each, ~${Math.round(candidates.length * RATE_LIMIT_MS / 1000 / 60)}min total)`);

  let ok = 0, errors = 0, states = { good: 0, warn: 0, bad: 0, none: 0 };

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    process.stdout.write(`\r  [${i + 1}/${candidates.length}] ${(p.full_name || '').slice(0, 30).padEnd(30)}`);

    let result;
    try {
      result = await healthieIntake(p.healthie_client_id);
    } catch (e) {
      result = { error: e.message };
    }

    if (result.error) {
      errors++;
      await pool.query(
        `INSERT INTO patient_signals_cache (patient_id, intake_state, intake_error, intake_fetched_at, updated_at)
         VALUES ($1::uuid, NULL, $2, NOW(), NOW())
         ON CONFLICT (patient_id) DO UPDATE SET
           intake_error = $2,
           intake_fetched_at = NOW(),
           updated_at = NOW()`,
        [p.pid, result.error]
      );
    } else {
      ok++;
      states[result.state] = (states[result.state] || 0) + 1;
      await pool.query(
        `INSERT INTO patient_signals_cache (patient_id, intake_state, intake_any_incomplete,
          intake_forms_finished, intake_forms_total, intake_fetched_at, intake_error, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, NOW(), NULL, NOW())
         ON CONFLICT (patient_id) DO UPDATE SET
           intake_state = EXCLUDED.intake_state,
           intake_any_incomplete = EXCLUDED.intake_any_incomplete,
           intake_forms_finished = EXCLUDED.intake_forms_finished,
           intake_forms_total = EXCLUDED.intake_forms_total,
           intake_fetched_at = NOW(),
           intake_error = NULL,
           updated_at = NOW()`,
        [p.pid, result.state, result.anyIncomplete, result.finished, result.total]
      );
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n\nSummary:');
  console.log('  successful fetches:', ok);
  console.log('  errors:', errors);
  console.log('  state distribution:', JSON.stringify(states));
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

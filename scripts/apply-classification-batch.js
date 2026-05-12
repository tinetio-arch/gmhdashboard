/* eslint-disable */
/**
 * Apply the 30 high/medium-signal classifications from audit v3.
 * Runs in a single transaction. Prints full diff before COMMIT.
 * Rollback on any error.
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const fetchFn = global.fetch || require('node-fetch').default || require('node-fetch');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function healthieAppointments(userId) {
  const query = `query($userId: ID!) { appointments(user_id: $userId, should_paginate: false, filter: "all") { id appointment_type { name } } }`;
  const r = await fetchFn(HEALTHIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
    body: JSON.stringify({ query, variables: { userId: String(userId) } })
  });
  const j = await r.json();
  return j.data?.appointments || [];
}

// Mirrors scripts/generate-classification-audit-v3.js APPT_RULES
const APPT_RULES = [
  { re: /\bfemale\s+(hormone|hrt)/i,    group: 'nowlongevity',    tag: null,        confidence: 'HIGH' },
  { re: /\bmale\s+(hormone|hrt)/i,      group: 'nowmenshealth',   tag: null,        confidence: 'HIGH' },
  { re: /testosterone|\btrt\b/i,        group: 'nowmenshealth',   tag: null,        confidence: 'HIGH' },
  { re: /pelleting.*\bfemale\b/i,       group: 'nowlongevity',    tag: 'pelleting', confidence: 'HIGH' },
  { re: /pelleting.*\bmale\b/i,         group: 'nowmenshealth',   tag: 'pelleting', confidence: 'HIGH' },
  { re: /pelleting/i,                   group: null,              tag: 'pelleting', confidence: 'MEDIUM' },
  { re: /weight.?loss|\bglp\b|semaglutide|tirzepatide/i, group: null, tag: 'weight-loss', confidence: 'HIGH' },
  { re: /peptide/i,                     group: null,              tag: 'peptides',  confidence: 'HIGH' },
  { re: /premier membership|primary care|\bpc\s+(follow|consult|visit|repeat)|annual physical|wellness visit/i,
    group: 'nowprimarycare', tag: null, confidence: 'HIGH' },
  { re: /\bsick\b/i,                    group: 'sick_visit',      tag: null,        confidence: 'MEDIUM' },
  { re: /mental health|therapy|psychia/i, group: 'nowmentalhealth', tag: null,      confidence: 'HIGH' },
  { re: /longevity/i,                   group: 'nowlongevity',    tag: null,        confidence: 'MEDIUM' }
];

const GROUP_DISPLAY = {
  nowmenshealth: 'NowMensHealth.Care',
  nowprimarycare: 'NowPrimary.Care',
  nowlongevity: 'NOWLongevity.Care',
  nowmentalhealth: 'NOWMentalHealth.Care',
  sick_visit: 'Sick Visit',
  abxtac: 'ABXTAC'
};

function normG(g) {
  const s = (g || '').trim().toLowerCase();
  return ['m','male'].includes(s) ? 'M' : (['f','female'].includes(s) ? 'F' : null);
}

function classify(appts, gender) {
  if (!appts?.length) return null;
  const g = normG(gender);
  let chosenGroup = null, chosenConf = 'LOW';
  const tagSet = new Set();
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const uniqueTypes = new Set(appts.map(a => a.appointment_type?.name || ''));
  const matched = [];
  for (const name of uniqueTypes) {
    for (const rule of APPT_RULES) {
      if (!rule.re.test(name)) continue;
      matched.push(name);
      if (rule.tag) tagSet.add(rule.tag);
      if (rule.group && (!chosenGroup || rank[rule.confidence] > rank[chosenConf])) {
        chosenGroup = rule.group;
        chosenConf = rule.confidence;
      }
    }
  }
  if (!chosenGroup && tagSet.has('pelleting') && g) {
    chosenGroup = g === 'F' ? 'nowlongevity' : 'nowmenshealth';
    chosenConf = 'MEDIUM';
  }
  return matched.length ? { group: chosenGroup, tags: [...tagSet], confidence: chosenConf, matched } : null;
}

function decidePatientType(groupKey, tags, membershipCount) {
  if (membershipCount > 0) return 'member';
  if (tags.length > 0) return 'intermittent';
  return 'visit';
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure all lookup values exist
    const lookupsToAdd = [
      { key: 'nowlongevity',    name: 'NOWLongevity.Care',    color: '#fde68a', primary: false },
      { key: 'nowmentalhealth', name: 'NOWMentalHealth.Care', color: '#ddd6fe', primary: false },
      { key: 'sick_visit',      name: 'Sick Visit',            color: '#e2e8f0', primary: false },
      { key: 'abxtac',          name: 'ABXTAC',                color: '#d1fae5', primary: false }
    ];
    for (const lu of lookupsToAdd) {
      await client.query(
        `INSERT INTO client_type_lookup (type_key, display_name, hex_color, is_primary_care, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (type_key) DO NOTHING`,
        [lu.key, lu.name, lu.color, lu.primary]
      );
    }
    console.log('✓ Lookup values ensured (inserted or already present)');

    // 2. Load Unclassified patients
    const unclassified = (await client.query(`
      SELECT p.patient_id, p.full_name, p.gender, p.healthie_client_id,
        p.client_type, p.client_type_key, p.patient_type,
        p.healthie_group_name, p.clinic,
        (SELECT COUNT(*) FROM clinicsync_memberships m WHERE m.patient_id = p.patient_id) AS membership_count
      FROM patients p
      WHERE (p.client_type IS NULL OR p.client_type = '')
        AND p.healthie_client_id IS NOT NULL
      ORDER BY p.full_name
    `)).rows;
    console.log(`✓ Loaded ${unclassified.length} Unclassified patients with Healthie ID\n`);

    // 3. Classify each via Healthie appointments (rate-limited)
    const plan = [];
    for (let i = 0; i < unclassified.length; i++) {
      const p = unclassified[i];
      process.stdout.write(`\r  Fetching [${i+1}/${unclassified.length}] ${(p.full_name||'').slice(0,30).padEnd(30)}`);
      let appts = [];
      try {
        appts = await healthieAppointments(p.healthie_client_id);
      } catch (e) { /* skip on error */ }
      const c = classify(appts, p.gender);
      if (!c || !c.group) { plan.push({ p, skip: true, reason: c ? 'no group match' : 'no appointments' }); continue; }

      const groupKey = c.group;
      const groupName = GROUP_DISPLAY[groupKey];
      const patientType = decidePatientType(groupKey, c.tags, parseInt(p.membership_count, 10));
      plan.push({ p, groupKey, groupName, patientType, tags: c.tags, confidence: c.confidence, matched: c.matched });
      await sleep(1500);
    }
    console.log('\n  Done fetching.\n');

    const toApply = plan.filter(x => !x.skip);
    const toSkip = plan.filter(x => x.skip);

    // 4. Print plan
    console.log('═══ CLASSIFICATION PLAN ═══\n');
    console.log(`Will UPDATE ${toApply.length} rows, SKIP ${toSkip.length} (no signal).\n`);
    console.log('APPLYING:');
    toApply.forEach(x => {
      console.log(`  ${x.p.full_name.padEnd(28)} → client_type="${x.groupName}" patient_type="${x.patientType}" tags=[${x.tags.join(',')}] (${x.confidence})`);
    });
    console.log('\nSKIPPING:');
    toSkip.forEach(x => console.log(`  ${x.p.full_name.padEnd(28)} → ${x.reason}`));
    console.log('');

    // 5. Apply updates
    let applied = 0;
    for (const x of toApply) {
      await client.query(
        `UPDATE patients
         SET client_type = $1, client_type_key = $2, patient_type = $3
         WHERE patient_id = $4`,
        [x.groupName, x.groupKey, x.patientType, x.p.patient_id]
      );
      applied++;
    }
    console.log(`✓ ${applied} rows staged for commit.\n`);

    await client.query('COMMIT');
    console.log('✓ COMMITTED.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n✗ ROLLED BACK:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

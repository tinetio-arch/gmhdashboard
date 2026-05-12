/* eslint-disable */
/**
 * STAGE 2 DRY-RUN — proposes client_type_key for the 22 NULL active patients.
 * READ-ONLY. Hits Healthie appointments API. No DB writes.
 * Outputs .tmp/stage2-dryrun-report.md
 *
 * Mirrors the classifier from scripts/apply-classification-batch.js
 * (Healthie appointment_type.name → group key, with gender-pelleting fallback).
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fetchFn = global.fetch;
const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const RATE_LIMIT_MS = 1500;

if (!API_KEY) { console.error('HEALTHIE_API_KEY missing'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function healthieAppointments(userId) {
  const query = `query($userId: ID!) {
    appointments(user_id: $userId, should_paginate: false, filter: "all") {
      id date appointment_type { id name } provider { full_name }
    }
  }`;
  try {
    const r = await fetchFn(HEALTHIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
      body: JSON.stringify({ query, variables: { userId: String(userId) } })
    });
    if (!r.ok) return { error: `HTTP ${r.status}`, appointments: [] };
    const j = await r.json();
    if (j.errors) return { error: JSON.stringify(j.errors).slice(0, 200), appointments: [] };
    return { appointments: j.data?.appointments || [] };
  } catch (e) { return { error: e.message, appointments: [] }; }
}

const APPT_RULES = [
  { re: /\bfemale\s+(hormone|hrt)/i,    group: 'nowlongevity',    tag: null,        confidence: 'high' },
  { re: /\bmale\s+(hormone|hrt)/i,      group: 'nowmenshealth',   tag: null,        confidence: 'high' },
  { re: /testosterone|\btrt\b/i,        group: 'nowmenshealth',   tag: null,        confidence: 'high' },
  { re: /pelleting.*\bfemale\b/i,       group: 'nowlongevity',    tag: 'pelleting', confidence: 'high' },
  { re: /pelleting.*\bmale\b/i,         group: 'nowmenshealth',   tag: 'pelleting', confidence: 'high' },
  { re: /pelleting/i,                   group: null,              tag: 'pelleting', confidence: 'medium' },
  { re: /weight.?loss|\bglp\b|semaglutide|tirzepatide/i, group: null, tag: 'weight-loss', confidence: 'high' },
  { re: /peptide/i,                     group: null,              tag: 'peptides',  confidence: 'high' },
  { re: /premier membership|primary care|\bpc\s+(follow|consult|visit|repeat)|annual physical|wellness visit/i,
    group: 'nowprimarycare', tag: null, confidence: 'high' },
  { re: /\bsick\b/i,                    group: 'sick_visit',      tag: null,        confidence: 'medium' },
  { re: /mental health|therapy|psychia/i, group: 'nowmentalhealth', tag: null,      confidence: 'high' },
  { re: /longevity/i,                   group: 'nowlongevity',    tag: null,        confidence: 'medium' }
];

const normG = g => {
  const s = (g || '').trim().toLowerCase();
  return ['m','male'].includes(s) ? 'M' : (['f','female'].includes(s) ? 'F' : null);
};

function classify(appts, gender) {
  if (!appts?.length) return { group: null, confidence: 'none', matched: [], unmatched: [], tags: [] };
  const g = normG(gender);
  let chosenGroup = null, chosenConf = 'low';
  const tagSet = new Set();
  const rank = { high: 3, medium: 2, low: 1 };
  const uniqueTypes = new Set(appts.map(a => a.appointment_type?.name || '(unknown)'));
  const matched = new Set();
  const unmatched = new Set(uniqueTypes);
  for (const name of uniqueTypes) {
    for (const rule of APPT_RULES) {
      if (!rule.re.test(name)) continue;
      matched.add(name); unmatched.delete(name);
      if (rule.tag) tagSet.add(rule.tag);
      if (rule.group && (!chosenGroup || rank[rule.confidence] > rank[chosenConf])) {
        chosenGroup = rule.group; chosenConf = rule.confidence;
      }
    }
  }
  if (!chosenGroup && tagSet.has('pelleting') && g) {
    chosenGroup = g === 'F' ? 'nowlongevity' : 'nowmenshealth';
    chosenConf = 'medium';
  }
  return {
    group: chosenGroup,
    confidence: matched.size ? chosenConf : 'none',
    matched: [...matched],
    unmatched: [...unmatched],
    tags: [...tagSet]
  };
}

(async () => {
  try {
    const nulls = (await pool.query(`
      SELECT p.patient_id, p.full_name, p.email, p.gender, p.clinic, p.healthie_client_id,
             p.status_key, p.client_type, p.patient_type,
             m.program_name, m.fee_amount, m.status AS membership_status,
             c.membership_plan, c.membership_status AS clinicsync_status,
             (SELECT MAX(dispense_date) FROM dispenses d WHERE d.patient_id = p.patient_id) AS last_dispense,
             (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispense_count
      FROM patients p
      LEFT JOIN memberships m ON m.patient_id = p.patient_id
      LEFT JOIN clinicsync_memberships c ON c.patient_id = p.patient_id
      WHERE LOWER(p.status_key) IN ('active','active_pending')
        AND (p.client_type_key IS NULL OR p.client_type_key = '')
      ORDER BY p.full_name
    `)).rows;

    console.log(`Loaded ${nulls.length} active+NULL patients. Fetching Healthie appointments…`);

    const results = [];
    for (let i = 0; i < nulls.length; i++) {
      const p = nulls[i];
      process.stdout.write(`\r  [${i+1}/${nulls.length}] ${(p.full_name||'').slice(0,30).padEnd(30)}`);
      let outcome;
      if (!p.healthie_client_id) {
        outcome = { error: 'no healthie_client_id', appointments: [] };
      } else {
        outcome = await healthieAppointments(p.healthie_client_id);
        await sleep(RATE_LIMIT_MS);
      }
      const c = classify(outcome.appointments, p.gender);
      results.push({ p, outcome, c });
    }
    console.log('\nDone.\n');

    // Markdown report
    const L = [];
    L.push('# Stage 2 Dry-Run — Classifier Proposals for 22 NULL Patients');
    L.push('');
    L.push(`**Generated:** ${new Date().toISOString()}`);
    L.push(`**Scope:** active + active_pending patients with NULL or empty \`client_type_key\``);
    L.push(`**Total:** ${results.length}`);
    L.push('');
    L.push('**No DB writes. Markdown only. Phil reviews row-by-row before Stage 2 apply.**');
    L.push('');
    L.push('Confidence: 🟢 high · 🟡 medium · 🔴 none');
    L.push('');

    const icon = { high: '🟢', medium: '🟡', low: '🟡', none: '🔴' };
    const willApply = results.filter(r => r.c.group);
    const willSkip  = results.filter(r => !r.c.group);

    L.push(`## Summary`);
    L.push(`- **Will apply (clear signal):** ${willApply.length}`);
    L.push(`- **Will skip (no signal — stay manual queue):** ${willSkip.length}`);
    L.push('');

    L.push('## Proposed updates');
    L.push('');
    L.push('| # | Patient | Gender | Clinic | Proposed key | Conf | Membership | Dispenses | Evidence |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    willApply.forEach((r, i) => {
      const p = r.p;
      const ms = p.membership_status || p.clinicsync_status || '—';
      const prog = p.program_name || p.membership_plan || '—';
      const fee = p.fee_amount ? `$${p.fee_amount}` : '';
      const mem = ms !== '—' ? `${prog}${fee ? ' '+fee : ''} (${ms})` : '—';
      const ev = (r.c.matched.join(' | ') || '—').replace(/\|/g, '\\|');
      L.push(`| ${i+1} | **${(p.full_name||'—').replace(/\|/g,'\\|')}** \`${p.patient_id.slice(0,8)}\` | ${normG(p.gender)||'?'} | ${p.clinic||'—'} | \`${r.c.group}\` | ${icon[r.c.confidence]} ${r.c.confidence} | ${mem} | ${p.dispense_count} (last: ${p.last_dispense||'—'}) | ${ev} |`);
    });
    L.push('');

    L.push('## Will skip — no clear signal');
    L.push('');
    L.push('| # | Patient | Gender | Clinic | Healthie ID | Membership | Dispenses | Why skipped |');
    L.push('|---|---|---|---|---|---|---|---|');
    willSkip.forEach((r, i) => {
      const p = r.p;
      const ms = p.membership_status || p.clinicsync_status || '—';
      const prog = p.program_name || p.membership_plan || '—';
      const fee = p.fee_amount ? `$${p.fee_amount}` : '';
      const mem = ms !== '—' ? `${prog}${fee?' '+fee:''} (${ms})` : '—';
      let why;
      if (r.outcome.error) why = `error: ${r.outcome.error}`;
      else if (!r.outcome.appointments?.length) why = 'no appointments in Healthie';
      else if (r.c.unmatched.length) why = `appts didn't match rules: ${r.c.unmatched.slice(0,3).join(' | ')}${r.c.unmatched.length>3?' …':''}`;
      else why = 'no rule match';
      why = why.replace(/\|/g,'\\|');
      L.push(`| ${i+1} | **${(p.full_name||'—').replace(/\|/g,'\\|')}** \`${p.patient_id.slice(0,8)}\` | ${normG(p.gender)||'?'} | ${p.clinic||'—'} | ${p.healthie_client_id||'—'} | ${mem} | ${p.dispense_count} (last: ${p.last_dispense||'—'}) | ${why} |`);
    });
    L.push('');

    L.push('## What happens if Phil approves');
    L.push('1. UPDATE `patients` SET `client_type_key` = proposed key, `client_type_key_updated_at` = NOW() for the **Will apply** rows above.');
    L.push('2. INSERT into `client_type_audit` for each row: `from_value=NULL`, `to_value=<proposed>`, `source=\'reconciler\'`, `confidence=<level>`, `evidence={appt_types: [...]}`.');
    L.push('3. **Will skip** rows stay NULL — they go into the manual review queue.');
    L.push('4. Single transaction — any error rolls back all 22 rows.');
    L.push('');
    L.push('## Effects on production');
    L.push('- **Peptide discount:** patients mapped to `nowmenshealth`/`nowprimarycare`/`nowlongevity` start getting the 20% NOW-brand courtesy discount on peptides.');
    L.push('- **Receipt branding:** patients mapped to `nowmenshealth` get Men\'s Health receipt template instead of generic.');
    L.push('- **CEO revenue/patient counts:** these patients leave the "(NULL)" bucket and join their proper brand bucket.');
    L.push('- **Net dollar impact: $0** — only re-bucketing existing revenue.');

    const out = path.join(__dirname, 'stage2-dryrun-report.md');
    fs.writeFileSync(out, L.join('\n'));
    console.log(`Wrote ${out}`);
    console.log(`Will apply: ${willApply.length}    Will skip: ${willSkip.length}`);
  } catch (e) {
    console.error('FAIL', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

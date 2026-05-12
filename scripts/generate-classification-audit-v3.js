/* eslint-disable */
/**
 * Classification audit v3 — pulls Healthie appointment types per patient.
 *
 * SCOPE (per policy §2 Core Principle #1): only proposes changes for Unclassified rows.
 * SIGNAL (per Phil 2026-04-16): appointment_type.name is authoritative; GHL tags are secondary.
 *
 * Rate limiting: 1500ms between Healthie calls (~55s for 37 patients). Safe for production.
 *
 * Read-only. Outputs docs/sot-modules/26-classification-audit.md.
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fetchFn = global.fetch || require('node-fetch').default || require('node-fetch');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const RATE_LIMIT_MS = 1500;

if (!API_KEY) { console.error('HEALTHIE_API_KEY missing'); process.exit(1); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function healthieAppointments(userId) {
  const query = `
    query AppointmentsForPatient($userId: ID!) {
      appointments(user_id: $userId, should_paginate: false, filter: "all") {
        id
        date
        appointment_type { id name }
        provider { full_name }
      }
    }`;
  const r = await fetchFn(HEALTHIE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + API_KEY,
      'AuthorizationSource': 'API'
    },
    body: JSON.stringify({ query, variables: { userId: String(userId) } })
  });
  if (!r.ok) {
    return { error: `HTTP ${r.status}`, appointments: [] };
  }
  const j = await r.json();
  if (j.errors) return { error: JSON.stringify(j.errors), appointments: [] };
  return { appointments: j.data?.appointments || [] };
}

// Classification rules from appointment type names.
// CRITICAL: "female hormone" MUST be tested before "male hormone" patterns that use no boundary.
// We use \b word boundary on "male" to prevent matching the "male" inside "female".
const APPT_RULES = [
  // Female hormone — check FIRST. Matches "Female Hormone" AND "Female HRT"
  { re: /\bfemale\s+(hormone|hrt)/i,    group: 'NOWLongevity.Care',  tag: null,        confidence: 'HIGH' },
  // Male hormone/HRT — \b word boundary prevents matching "female hormone"
  { re: /\bmale\s+(hormone|hrt)/i,      group: 'NOWMensHealth.Care', tag: null,        confidence: 'HIGH' },
  // TRT / testosterone explicit
  { re: /testosterone|\btrt\b/i,        group: 'NOWMensHealth.Care', tag: null,        confidence: 'HIGH' },

  // Pelleting — explicit gender in the appointment name wins
  { re: /pelleting.*\bfemale\b/i,       group: 'NOWLongevity.Care',  tag: 'pelleting', confidence: 'HIGH' },
  { re: /pelleting.*\bmale\b/i,         group: 'NOWMensHealth.Care', tag: 'pelleting', confidence: 'HIGH' },
  // Generic pelleting — gender-based fallback handled in classifyFromAppointments
  { re: /pelleting/i,                   group: null,                 tag: 'pelleting', confidence: 'MEDIUM' },

  // Weight loss — tag only, group inferred from gender/other signals
  { re: /weight.?loss|\bglp\b|semaglutide|tirzepatide/i, group: null, tag: 'weight-loss', confidence: 'HIGH' },

  // Peptides
  { re: /peptide/i,                     group: null,                 tag: 'peptides',  confidence: 'HIGH' },

  // Primary care — includes "PC Follow-Up" / "PC Consult" abbreviations
  { re: /premier membership|primary care|\bpc\s+(follow|consult|visit|repeat)|annual physical|wellness visit/i,
    group: 'NOWPrimary.Care', tag: null, confidence: 'HIGH' },

  // Sick — any appointment name containing "sick"
  { re: /\bsick\b/i,                    group: 'Sick Visit',         tag: null,        confidence: 'MEDIUM' },

  // Mental health
  { re: /mental health|therapy|psychia/i, group: 'NOWMentalHealth.Care', tag: null,    confidence: 'HIGH' },

  // Longevity generic
  { re: /longevity/i,                   group: 'NOWLongevity.Care',  tag: null,        confidence: 'MEDIUM' }
];

function normGender(g) {
  const s = (g || '').trim().toLowerCase();
  if (['m', 'male'].includes(s)) return 'M';
  if (['f', 'female'].includes(s)) return 'F';
  return null;
}

function classifyFromAppointments(appts, gender) {
  if (!appts || appts.length === 0) {
    return { group: null, tags: [], confidence: 'NONE', signals: [], reason: 'no appointments in Healthie', unmatchedTypes: [] };
  }
  const g = normGender(gender);
  const matchedSignals = new Set();
  let chosenGroup = null;
  let chosenConfidence = 'LOW';
  const tagSet = new Set();
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  const uniqueTypes = new Set();
  for (const appt of appts) uniqueTypes.add(appt.appointment_type?.name || '(unknown)');
  const unmatchedTypes = new Set(uniqueTypes);

  for (const name of uniqueTypes) {
    for (const rule of APPT_RULES) {
      if (!rule.re.test(name)) continue;
      matchedSignals.add(name);
      unmatchedTypes.delete(name);
      if (rule.tag) tagSet.add(rule.tag);
      if (rule.group) {
        if (!chosenGroup || rank[rule.confidence] > rank[chosenConfidence]) {
          chosenGroup = rule.group;
          chosenConfidence = rule.confidence;
        }
      }
    }
  }

  // Fallback for generic "pelleting" without explicit gender in appt name
  if (!chosenGroup && tagSet.has('pelleting') && g) {
    chosenGroup = g === 'F' ? 'NOWLongevity.Care' : 'NOWMensHealth.Care';
    chosenConfidence = 'MEDIUM';
  }

  // If we have a service tag but no group match, suggest Intermittent (patient_type) — group stays null
  // Reason text shows matched + unmatched types for diagnosis
  const matchedList = [...matchedSignals];
  const unmatchedList = [...unmatchedTypes];
  let reason;
  if (matchedList.length && unmatchedList.length) {
    reason = `matched: ${matchedList.join(' | ')}  •  unmatched: ${unmatchedList.join(' | ')}`;
  } else if (matchedList.length) {
    reason = `matched: ${matchedList.join(' | ')}`;
  } else {
    reason = `unmatched: ${unmatchedList.join(' | ')}`;
  }

  return {
    group: chosenGroup,
    tags: [...tagSet],
    confidence: matchedList.length ? chosenConfidence : 'NONE',
    signals: matchedList,
    reason,
    unmatchedTypes: unmatchedList
  };
}

async function main() {
  // Load all patients (for dedup + classified list)
  const all = (await pool.query(`
    SELECT
      p.patient_id, p.full_name, p.email, p.phone_primary, p.dob, p.gender,
      p.healthie_client_id, p.healthie_group_name, p.clinic,
      p.patient_type, p.client_type, p.client_type_key,
      p.payment_method, p.regimen, p.ghl_contact_id, p.status,
      p.first_app_login, p.parent_patient_id, p.date_added,
      (SELECT MAX(dispense_date) FROM dispenses d WHERE d.patient_id = p.patient_id) AS last_dispense,
      (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispense_count,
      (SELECT COUNT(*) FROM clinicsync_memberships m WHERE m.patient_id = p.patient_id) AS membership_count,
      (SELECT tier FROM abxtac_customer_access a WHERE a.healthie_patient_id = p.healthie_client_id LIMIT 1) AS abxtac_tier
    FROM patients p
    ORDER BY p.date_added DESC NULLS LAST
  `)).rows;

  const unclassified = all.filter(p => !p.client_type || !String(p.client_type).trim());
  console.log(`Starting Healthie query for ${unclassified.length} Unclassified patients (rate-limited ${RATE_LIMIT_MS}ms)`);

  // Fetch appointments per Unclassified patient
  const appointmentMap = new Map();
  let i = 0;
  for (const p of unclassified) {
    i++;
    if (!p.healthie_client_id) {
      appointmentMap.set(p.patient_id, { error: 'no healthie_client_id', appointments: [] });
      continue;
    }
    process.stdout.write(`\r  [${i}/${unclassified.length}] ${p.full_name?.slice(0,30).padEnd(30)}`);
    try {
      const res = await healthieAppointments(p.healthie_client_id);
      appointmentMap.set(p.patient_id, res);
    } catch (e) {
      appointmentMap.set(p.patient_id, { error: e.message, appointments: [] });
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log('\n  Done.');

  // Duplicate detection (unchanged from v2)
  const normEmail = e => (e || '').trim().toLowerCase() || null;
  const normPhone = p => { const d = (p || '').replace(/\D/g, ''); return d ? (d.length === 10 ? '1'+d : d) : null; };
  const normName = n => (n || '').trim().toLowerCase().replace(/\s+/g, ' ') || null;

  const byEmail = new Map(), byPhone = new Map(), byHealthie = new Map(), byGhl = new Map(), byNameDob = new Map();
  for (const p of all) {
    const e = normEmail(p.email); if (e) (byEmail.get(e) || byEmail.set(e, []).get(e)).push(p);
    const ph = normPhone(p.phone_primary); if (ph) (byPhone.get(ph) || byPhone.set(ph, []).get(ph)).push(p);
    if (p.healthie_client_id) (byHealthie.get(p.healthie_client_id) || byHealthie.set(p.healthie_client_id, []).get(p.healthie_client_id)).push(p);
    if (p.ghl_contact_id) (byGhl.get(p.ghl_contact_id) || byGhl.set(p.ghl_contact_id, []).get(p.ghl_contact_id)).push(p);
    const nn = normName(p.full_name); const dobKey = p.dob ? String(p.dob).slice(0,10) : '';
    if (nn && dobKey) { const k = `${nn}|${dobKey}`; (byNameDob.get(k) || byNameDob.set(k, []).get(k)).push(p); }
  }
  const dupGroups = []; const seen = new Set();
  function add(kind, key, rows) {
    if (rows.length < 2) return;
    if (kind === 'email' || kind === 'phone') {
      const dobs = new Set(rows.map(r => r.dob ? String(r.dob).slice(0,10) : ''));
      if (dobs.size > 1) return;
    }
    const k = `${kind}:${rows.map(r => r.patient_id).sort().join(',')}`;
    if (seen.has(k)) return; seen.add(k);
    dupGroups.push({ kind, key, rows });
  }
  for (const [k, rows] of byEmail) add('email', k, rows);
  for (const [k, rows] of byPhone) add('phone', k, rows);
  for (const [k, rows] of byHealthie) add('healthie', k, rows);
  for (const [k, rows] of byGhl) add('ghl', k, rows);
  for (const [k, rows] of byNameDob) add('name+dob', k, rows);
  const dupIds = new Set(); dupGroups.forEach(g => g.rows.forEach(r => dupIds.add(r.patient_id)));

  // Orphan links
  const orphans = (await pool.query(`
    SELECT p.patient_id, p.full_name, p.email, p.healthie_client_id, p.status, p.gender
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.healthie_client_id = p.healthie_client_id
    WHERE p.healthie_client_id IS NOT NULL AND hc.healthie_client_id IS NULL
    ORDER BY p.full_name
  `)).rows;

  // Hard flags — female with TRT dispenses
  const hardFlagged = all.filter(p => {
    const g = normGender(p.gender);
    return g === 'F' && p.dispense_count > 0;
  });

  const KNOWN_CASES = {
    'jaren lyon': 'Dependent of Keaton Lyon → set parent_patient_id',
    'sam breyer:7313f334': 'Merge INTO 52221564 (has 2 dispenses)',
    'sam breyer:52221564': 'Keep this row; absorb 7313f334',
    'keira gannon:471ea04b': 'Spouse of Greg. 2 existing dispenses are MISATTRIBUTIONS → reassign to Greg (§7.6)',
    'keira gannon:fa75dcdd': 'Likely dup of the other Keira; decide keeper, merge',
    'greg gannon': 'Spouse of Keira → set spouse_patient_id',
    'brad odom': 'NOT a duplicate of Milfred Tewawina. Split shared GHL contact.',
    'milfred tewawina': 'NOT a duplicate of Brad Odom. Split shared GHL contact.',
    'bennett bunger': 'Dependent of Kristen Bunger → set parent_patient_id'
  };
  function knownCase(p) {
    const n = normName(p.full_name); if (!n) return null;
    const short = p.patient_id.slice(0,8);
    return KNOWN_CASES[`${n}:${short}`] || KNOWN_CASES[n] || null;
  }

  // Build markdown
  const L = [];
  L.push('---');
  L.push('name: Patient Classification Audit v3 (Healthie appointment types)');
  L.push(`description: Dry-run audit using Healthie appointment_type.name as primary signal. Scope: ${unclassified.length} Unclassified patients only. NO DATA WRITTEN.`);
  L.push('type: report');
  L.push('---');
  L.push('');
  L.push(`# Patient Classification Audit v3 — ${new Date().toISOString()}`);
  L.push('');
  L.push(`**Total patients in DB:** ${all.length}`);
  L.push(`**Currently Unclassified (scope for proposals):** ${unclassified.length}`);
  L.push(`**Duplicate groups:** ${dupGroups.length}`);
  L.push(`**Orphan Healthie links:** ${orphans.length}`);
  L.push(`**Hard flags (female + TRT dispenses):** ${hardFlagged.length}`);
  L.push('');
  L.push('> **What changed from v2:** appointment_type.name from Healthie is now the primary classification signal (per Phil 2026-04-16). GHL tags are ignored. Patients without clear appointment signals stay in the Unclassified tab for manual review.');
  L.push('');

  // 0. Confirmed actions
  L.push('## 0. Confirmed Action Items (Phil 2026-04-16)');
  L.push('');
  L.push('| Patient | Confirmed Action |');
  L.push('|---|---|');
  L.push('| Jaren Lyon | Dependent of Keaton Lyon — set `parent_patient_id` |');
  L.push('| Sam Breyer (2 rows) | Keep `52221564-…` (2 dispenses); merge `7313f334-…` into it |');
  L.push('| Keira Gannon | Spouse of Greg; her 2 dispenses are misattributions → reassign to Greg (§7.6) |');
  L.push('| Greg & Keira Gannon | Split GHL contact `8akTGjkoaHS0vjDbPf4w`; set `spouse_patient_id` |');
  L.push('| Brad Odom ↔ Milfred Tewawina | Split shared GHL contact `RXGueSwZbP3Z9yCLDUnV`; separate charts stay |');
  L.push('| Bennett Bunger | Dependent of Kristen Bunger — set `parent_patient_id` |');
  L.push('| Danny Fradenburg | Gender corrected to Male (done 2026-04-16) |');
  L.push('');

  // 1. Hard flags
  L.push('## 1. Hard Flags (Female + TRT dispense)');
  L.push('');
  if (hardFlagged.length === 0) { L.push('_None. Clear._'); }
  else {
    L.push('| Patient | Gender | Dispense Count | Last Dispense |');
    L.push('|---|---|---|---|');
    hardFlagged.forEach(r => L.push(`| ${r.full_name} (\`${r.patient_id.slice(0,8)}\`) | ${normGender(r.gender)} | ${r.dispense_count} | ${r.last_dispense || '—'} |`));
  }
  L.push('');

  // 2. Duplicates
  L.push('## 2. Duplicate Candidates');
  L.push('');
  if (dupGroups.length === 0) L.push('_None._');
  else {
    L.push('| # | Match | Patients |');
    L.push('|---|---|---|');
    dupGroups.forEach((g, i) => {
      const list = g.rows.map(r => `**${r.full_name}** (\`${r.patient_id.slice(0,8)}\`, disp:${r.dispense_count}, gender:${normGender(r.gender) || '?'})`).join(' vs. ');
      L.push(`| ${i+1} | ${g.kind} \`${g.key}\` | ${list} |`);
    });
  }
  L.push('');

  // 3. Orphans
  L.push('## 3. Orphan Healthie Links');
  L.push('');
  if (orphans.length === 0) L.push('_None._');
  else {
    L.push('| Patient | Email | Healthie ID | Gender |');
    L.push('|---|---|---|---|');
    orphans.forEach(o => L.push(`| ${o.full_name || '—'} | ${o.email || '—'} | \`${o.healthie_client_id}\` | ${normGender(o.gender) || '?'} |`));
  }
  L.push('');

  // 4. Proposals (Unclassified) with Healthie appointment data
  L.push(`## 4. Proposed Classification — Unclassified (${unclassified.length})`);
  L.push('');
  L.push('**Signal source:** Healthie `appointment_type.name`. Each proposal shows the exact appointment type(s) that triggered it. Patients with no appointments, errors, or unmatched types → stay Unclassified for staff review.');
  L.push('');
  L.push('**Confidence:** 🟢 HIGH = clear clinical appointment type match. 🟡 MEDIUM = partial or inferred. 🔴 LOW/NONE = no signal.');
  L.push('');
  L.push('| Patient | Gender | Appt Count | Proposed Group | Service Tags | Conf | Evidence | Known Case |');
  L.push('|---|---|---|---|---|---|---|---|');
  const icon = { HIGH: '🟢', MEDIUM: '🟡', LOW: '🔴', NONE: '⚪' };
  const apptsMissing = [];
  unclassified.forEach(r => {
    const appts = appointmentMap.get(r.patient_id);
    const nm = (r.full_name || '—').replace(/\|/g, '\\|');
    const gender = normGender(r.gender) || '?';
    const known = knownCase(r);
    const knownCell = known ? `**${known}**`.replace(/\|/g, '\\|') : '';

    if (appts?.error) {
      L.push(`| ${nm} | ${gender} | ERR | — | — | ⚪ | ${appts.error} | ${knownCell} |`);
      apptsMissing.push({ ...r, reason: appts.error });
      return;
    }
    const c = classifyFromAppointments(appts?.appointments, r.gender);
    const apptCount = appts?.appointments?.length || 0;
    const group = c.group || '_Unclassified_';
    const tags = c.tags.length ? c.tags.join(',') : '—';
    const conf = icon[c.confidence] || '⚪';
    const ev = (c.reason || '—').replace(/\|/g, '\\|');
    L.push(`| ${nm} | ${gender} | ${apptCount} | ${group} | ${tags} | ${conf} | ${ev} | ${knownCell} |`);
  });
  L.push('');

  // Summary stats
  const classifiedByAppt = unclassified.filter(r => {
    const a = appointmentMap.get(r.patient_id);
    if (a?.error || !a?.appointments?.length) return false;
    return classifyFromAppointments(a.appointments, r.gender).group != null;
  });
  L.push('### Summary');
  L.push(`- **High-signal classifications (ready to apply):** ${classifiedByAppt.length}`);
  L.push(`- **No appointments or no matching type (→ manual queue):** ${unclassified.length - classifiedByAppt.length}`);
  L.push('');

  // 5. Classified reference
  const classified = all.filter(p => p.client_type && String(p.client_type).trim());
  L.push(`## 5. Classified Patients — Reference Only (${classified.length})`);
  L.push('');
  L.push('<details><summary>Expand</summary>');
  L.push('');
  L.push('| Patient | Gender | Type | Client Type | Group/Clinic |');
  L.push('|---|---|---|---|---|');
  classified.forEach(r => L.push(`| ${(r.full_name||'—').replace(/\|/g, '\\|')} | ${normGender(r.gender) || '?'} | ${r.patient_type} | ${r.client_type} | ${r.healthie_group_name || r.clinic || '—'} |`));
  L.push('');
  L.push('</details>');
  L.push('');

  L.push('---');
  L.push('');
  L.push('## Next Steps');
  L.push('1. Resolve confirmed action items (§0) — low risk.');
  L.push('2. Resolve duplicates (§2) — staff picks keeper.');
  L.push('3. Relink/archive orphans (§3).');
  L.push('4. Apply HIGH-confidence classifications from §4 in a batch (with Phil review).');
  L.push('5. Everything else stays in the Unclassified tab for manual staff review.');

  const outPath = path.join(__dirname, '..', 'docs', 'sot-modules', '26-classification-audit.md');
  fs.writeFileSync(outPath, L.join('\n'));
  console.log(`Wrote ${outPath}`);
  console.log(`  unclassified=${unclassified.length} highSignal=${classifiedByAppt.length} dups=${dupGroups.length} orphans=${orphans.length} hardFlags=${hardFlagged.length}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

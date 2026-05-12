/* eslint-disable */
/**
 * Read-only classification audit — v2 (2026-04-16 rules update).
 *
 * SCOPE RULE (per policy §2 Core Principle #1):
 *   Only proposes changes for currently-Unclassified patients (client_type IS NULL or empty).
 *   Classified patients are listed for reference only, never re-proposed.
 *
 * NEW CLASSIFICATION SIGNALS:
 *   - gender: male + TRT signal → NOWMensHealth.Care
 *   - gender: female + pelleting/hormone → NOWLongevity.Care (pelleting tag)
 *   - pelleting tag on male → MensHealth with pelleting overlay (Clint Shafer pattern)
 *   - hard rule: TRT never dispensed to non-male
 *
 * KNOWN CONFIRMED CASES (2026-04-16 session):
 *   - Jaren Lyon  → dependent of Keaton Lyon
 *   - Sam Breyer  → merge 7313f334 (empty) INTO 52221564 (has 2 dispenses)
 *   - Keira Gannon → spouse of Greg Gannon; dispense MISATTRIBUTION (reassign 2 dispenses to Greg)
 *   - Brad Odom vs Milfred Tewawina → NOT duplicates; shared GHL contact must be split
 *   - Bennett Bunger → dependent of Kristen Bunger
 *
 * Output: docs/sot-modules/26-classification-audit.md
 * No writes. Safe to run anytime.
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const INTERMITTENT_TAGS = new Set(['pelleting', 'weight-loss', 'peptides']);
const HORMONE_TAGS = new Set(['pelleting']); // pelleting = hormone therapy signal

function normEmail(e) { return (e || '').trim().toLowerCase() || null; }
function normPhone(p) {
  const d = (p || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? '1' + d : d;
}
function normName(n) { return (n || '').trim().toLowerCase().replace(/\s+/g, ' ') || null; }
function normGender(g) {
  const s = (g || '').trim().toLowerCase();
  if (['m', 'male'].includes(s)) return 'M';
  if (['f', 'female'].includes(s)) return 'F';
  return null;
}
function isUnclassified(p) {
  return !p.client_type || !String(p.client_type).trim();
}

const KNOWN_CASES = {
  // keyed by lowercase full_name for easy lookup (single-name matches only; disambiguate on DOB if needed)
  'jaren lyon': { action: 'dependent', note: 'Son of Keaton Lyon → set parent_patient_id' },
  'sam breyer:7313f334': { action: 'merge-loser', note: 'Merge INTO 52221564-dc08-4ef6-b685-1b4c410bab5e (Sam Breyer with 2 dispenses)' },
  'sam breyer:52221564': { action: 'merge-keeper', note: 'Keep this row; absorb 7313f334-fd41-4670-933e-cbaeb694aef5' },
  'keira gannon:471ea04b': { action: 'spouse+misattribution', note: 'Spouse of Greg Gannon. Her 2 existing dispenses are MISATTRIBUTIONS → reassign to Greg' },
  'keira gannon:fa75dcdd': { action: 'spouse', note: 'Likely a duplicate of the other Keira row; decide keeper, merge' },
  'greg gannon': { action: 'spouse', note: 'Spouse of Keira → set spouse_patient_id; will receive Keira\'s mis-recorded dispenses' },
  'brad odom': { action: 'ghl-split', note: 'NOT a duplicate of Milfred Tewawina. Split shared GHL contact RXGueSwZbP3Z9yCLDUnV.' },
  'milfred tewawina': { action: 'ghl-split', note: 'NOT a duplicate of Brad Odom. Split shared GHL contact.' },
  'bennett bunger': { action: 'dependent', note: 'Son of Kristen Bunger → set parent_patient_id' }
};

function knownCaseFor(p) {
  const base = normName(p.full_name);
  if (!base) return null;
  const short = p.patient_id.slice(0, 8);
  return KNOWN_CASES[`${base}:${short}`] || KNOWN_CASES[base] || null;
}

async function main() {
  const patients = (await pool.query(`
    SELECT
      p.patient_id, p.full_name, p.email, p.phone_primary, p.dob, p.gender,
      p.healthie_client_id, p.healthie_group_name, p.clinic,
      p.patient_type, p.client_type, p.client_type_key,
      p.payment_method, p.payment_method_key, p.regimen,
      p.ghl_tags, p.ghl_contact_id, p.status, p.status_key,
      p.first_app_login, p.parent_patient_id, p.date_added,
      p.prescribing_provider_id,
      (SELECT MAX(dispense_date) FROM dispenses d WHERE d.patient_id = p.patient_id) AS last_dispense,
      (SELECT COUNT(*) FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispense_count,
      (SELECT COUNT(*) FROM clinicsync_memberships m WHERE m.patient_id = p.patient_id) AS membership_count,
      (SELECT tier FROM abxtac_customer_access a WHERE a.healthie_patient_id = p.healthie_client_id LIMIT 1) AS abxtac_tier
    FROM patients p
    ORDER BY p.date_added DESC NULLS LAST
  `)).rows;

  // Duplicate detection (family-member aware)
  const byEmail = new Map();
  const byPhone = new Map();
  const byHealthie = new Map();
  const byGhl = new Map();
  const byNameDob = new Map();

  for (const p of patients) {
    const e = normEmail(p.email);
    if (e) (byEmail.get(e) || byEmail.set(e, []).get(e)).push(p);
    const ph = normPhone(p.phone_primary);
    if (ph) (byPhone.get(ph) || byPhone.set(ph, []).get(ph)).push(p);
    if (p.healthie_client_id) (byHealthie.get(p.healthie_client_id) || byHealthie.set(p.healthie_client_id, []).get(p.healthie_client_id)).push(p);
    if (p.ghl_contact_id) (byGhl.get(p.ghl_contact_id) || byGhl.set(p.ghl_contact_id, []).get(p.ghl_contact_id)).push(p);
    const nn = normName(p.full_name);
    const dobKey = p.dob ? String(p.dob).slice(0, 10) : '';
    if (nn && dobKey) {
      const k = `${nn}|${dobKey}`;
      (byNameDob.get(k) || byNameDob.set(k, []).get(k)).push(p);
    }
  }

  const dupGroups = [];
  const seen = new Set();
  function add(kind, key, rows) {
    if (rows.length < 2) return;
    if (kind === 'email' || kind === 'phone') {
      const dobs = new Set(rows.map(r => (r.dob ? String(r.dob).slice(0,10) : '')));
      if (dobs.size > 1) return; // family — not duplicates
    }
    const k = `${kind}:${rows.map(r => r.patient_id).sort().join(',')}`;
    if (seen.has(k)) return;
    seen.add(k);
    dupGroups.push({ kind, key, rows });
  }
  for (const [k, rows] of byEmail) add('email', k, rows);
  for (const [k, rows] of byPhone) add('phone', k, rows);
  for (const [k, rows] of byHealthie) add('healthie', k, rows);
  for (const [k, rows] of byGhl) add('ghl', k, rows);
  for (const [k, rows] of byNameDob) add('name+dob', k, rows);

  const dupIds = new Set();
  dupGroups.forEach(g => g.rows.forEach(r => dupIds.add(r.patient_id)));

  // Classify — BUT only for Unclassified patients
  function classify(p) {
    const hasMembership = p.membership_count > 0;
    const hasTrt = p.dispense_count > 0;
    const hasAbxtac = !!p.abxtac_tier;
    const tags = Array.isArray(p.ghl_tags) ? p.ghl_tags : (p.ghl_tags ? [p.ghl_tags] : []);
    const tagList = tags.map(t => String(t).toLowerCase());
    const hasPelleting = tagList.includes('pelleting');
    const hasHormoneSignal = tagList.some(t => HORMONE_TAGS.has(t));
    const hasServiceTag = tagList.some(t => INTERMITTENT_TAGS.has(t));
    const g = normGender(p.gender);

    // ---- TYPE ----
    let proposedType, typeConf, typeEvidence;
    if (hasMembership || hasAbxtac) {
      proposedType = 'member'; typeConf = 'HIGH';
      typeEvidence = hasAbxtac ? `ABXTAC tier=${p.abxtac_tier}` : 'active membership';
    } else if (hasTrt && g === 'M') {
      proposedType = 'member'; typeConf = 'HIGH';
      typeEvidence = `male + ${p.dispense_count} TRT dispense(s); implies NOWMensHealth membership`;
    } else if (hasTrt && g !== 'M') {
      proposedType = 'member'; typeConf = 'LOW';
      typeEvidence = `⚠ ${p.dispense_count} dispense(s) on non-male — LIKELY MISATTRIBUTION, see §7.6`;
    } else if (hasServiceTag) {
      proposedType = 'intermittent'; typeConf = 'MEDIUM';
      typeEvidence = `tags: ${tagList.filter(t => INTERMITTENT_TAGS.has(t)).join(',')}`;
    } else {
      proposedType = 'visit'; typeConf = 'LOW';
      typeEvidence = 'no package, no dispense, no service tag';
    }

    // ---- GROUP (with new gender rules) ----
    let proposedGroup, groupEvidence;
    if (p.clinic === 'nowmenshealth.care') {
      proposedGroup = 'NOWMensHealth.Care'; groupEvidence = 'clinic=nowmenshealth.care';
    } else if (p.clinic === 'nowprimary.care') {
      proposedGroup = 'NOWPrimary.Care'; groupEvidence = 'clinic=nowprimary.care';
    } else if (p.clinic === 'abxtac' || hasAbxtac) {
      proposedGroup = 'ABXTAC'; groupEvidence = 'ABXTAC tier present';
    } else if (p.healthie_group_name) {
      proposedGroup = p.healthie_group_name; groupEvidence = 'Healthie group';
    } else if (g === 'M' && hasTrt) {
      proposedGroup = 'NOWMensHealth.Care'; groupEvidence = 'male + TRT dispenses → §3.6.a';
    } else if (g === 'F' && hasHormoneSignal) {
      proposedGroup = 'NOWLongevity.Care'; groupEvidence = 'female + hormone tag → §3.6.a';
    } else if (g === 'M' && hasPelleting) {
      proposedGroup = 'NOWMensHealth.Care (pelleting overlay)'; groupEvidence = 'male + pelleting → Clint Shafer pattern';
    } else {
      proposedGroup = 'Sick Visit'; groupEvidence = 'default';
    }

    // ---- PAYMENT ----
    const proposedPayment = (p.payment_method && p.payment_method.trim())
      ? p.payment_method : 'Healthie (default)';

    // ---- SERVICE TAG OVERLAY ----
    const serviceTags = tagList.filter(t => INTERMITTENT_TAGS.has(t));

    // ---- HARD FLAG: female with TRT dispenses ----
    const hardFlag = (g === 'F' && hasTrt)
      ? `HARD FLAG — female patient with ${p.dispense_count} TRT dispense(s). Investigate misattribution (§7.6).`
      : null;

    return { proposedType, proposedGroup, proposedPayment, serviceTags, typeConf, typeEvidence, groupEvidence, hardFlag };
  }

  const rows = patients.map(p => {
    const c = classify(p);
    return { ...p, ...c, isDuplicate: dupIds.has(p.patient_id), isUnclassified: isUnclassified(p), known: knownCaseFor(p) };
  });

  // Orphan links
  const orphanResult = await pool.query(`
    SELECT p.patient_id, p.full_name, p.email, p.healthie_client_id, p.status, p.gender
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.healthie_client_id = p.healthie_client_id
    WHERE p.healthie_client_id IS NOT NULL AND hc.healthie_client_id IS NULL
    ORDER BY p.full_name
  `);
  const orphans = orphanResult.rows;

  // Counts
  const unclassifiedRows = rows.filter(r => r.isUnclassified);
  const hardFlagged = rows.filter(r => r.hardFlag);

  // Build markdown
  const L = [];
  L.push('---');
  L.push('name: Patient Classification Audit v2');
  L.push(`description: Dry-run audit — ${rows.length} total patients; ${unclassifiedRows.length} Unclassified are in scope. Gender/provider rules applied. NO DATA WRITTEN.`);
  L.push('type: report');
  L.push('---');
  L.push('');
  L.push(`# Patient Classification Audit v2 — ${new Date().toISOString()}`);
  L.push('');
  L.push(`**Total patients in DB:** ${rows.length}`);
  L.push(`**Currently Unclassified (in scope for proposals):** ${unclassifiedRows.length}`);
  L.push(`**Duplicate groups detected:** ${dupGroups.length}`);
  L.push(`**Orphan Healthie links:** ${orphans.length}`);
  L.push(`**Hard flags (female + TRT dispenses):** ${hardFlagged.length}`);
  L.push('');
  L.push('> **Rules updated 2026-04-16 (Phil clarifications):**');
  L.push('> 1. Scope: policy only proposes changes for **Unclassified** rows. Classified patients are NOT re-classified.');
  L.push('> 2. Gender gating: male + TRT signal → **NOWMensHealth.Care**; female + hormone signal → **NOWLongevity.Care** with pelleting.');
  L.push('> 3. Hard block: testosterone dispensed to non-male = misattribution (§7.6). System should never silently accept this.');
  L.push('> 4. Service-tag overlay: primary group is sticky (§2 #6); pelleting/peptides/weight-loss layer on top (e.g., Clint Shafer = MensHealth + pelleting).');
  L.push('> 5. Spouses get `spouse_patient_id`; they never inherit TRT eligibility (§7.5).');
  L.push('');

  // Known confirmed cases
  L.push('## 0. Confirmed Action Items (Phil 2026-04-16)');
  L.push('');
  L.push('| Patient | Confirmed Action | Implementation |');
  L.push('|---|---|---|');
  L.push('| Jaren Lyon | Dependent of Keaton Lyon | set `parent_patient_id` to Keaton\'s UUID |');
  L.push('| Sam Breyer (2 rows) | Keep `52221564-dc08-4ef6-b685-1b4c410bab5e` (has 2 dispenses); merge `7313f334-fd41-4670-933e-cbaeb694aef5` into it | Dedup merge (§7.3) |');
  L.push('| Keira Gannon | Spouse of Greg Gannon; **her 2 existing dispenses are MISATTRIBUTIONS** | set `spouse_patient_id`; reassign the 2 dispenses to Greg via §7.6 workflow |');
  L.push('| Greg & Keira Gannon (shared GHL) | Legitimate spouses; not duplicates | Split GHL contact `8akTGjkoaHS0vjDbPf4w`; set `spouse_patient_id` each direction |');
  L.push('| Brad Odom ↔ Milfred Tewawina | NOT duplicates; wrong GHL link | Split shared GHL contact `RXGueSwZbP3Z9yCLDUnV`; two separate charts stay |');
  L.push('| Bennett Bunger | Dependent of Kristen Bunger | set `parent_patient_id` to Kristen\'s UUID |');
  L.push('');

  // Hard flags
  L.push('## 1. Hard Flags (Immediate Attention)');
  L.push('');
  if (hardFlagged.length === 0) {
    L.push('_None._');
  } else {
    L.push('Dispensing testosterone to non-male patients violates the §3.6.a hard rule. These rows indicate data entry errors (most likely misattributed dispenses). Resolve via §7.6 (Dispense Misattribution Correction).');
    L.push('');
    L.push('| Patient | Gender | Dispense Count | Last Dispense | Flag |');
    L.push('|---|---|---|---|---|');
    hardFlagged.forEach(r => {
      L.push(`| ${r.full_name} (\`${r.patient_id.slice(0,8)}\`) | ${normGender(r.gender) || '?'} | ${r.dispense_count} | ${r.last_dispense || '—'} | ${r.hardFlag} |`);
    });
  }
  L.push('');

  // Duplicates
  L.push('## 2. Duplicate Candidates (Resolve Before Classifying)');
  L.push('');
  if (dupGroups.length === 0) {
    L.push('_None detected._');
  } else {
    L.push('Per policy §7.3. Spouse/family members are excluded from name-DOB/email/phone dedup when DOBs differ. GHL-contact collisions may be legitimate family sharing (see Confirmed Action Items above).');
    L.push('');
    L.push('| # | Match | Patients | Staff Direction |');
    L.push('|---|---|---|---|');
    dupGroups.forEach((g, i) => {
      const list = g.rows.map(r => `**${r.full_name}** (\`${r.patient_id.slice(0,8)}\`, disp:${r.dispense_count}, mbr:${r.membership_count}, gender:${normGender(r.gender) || '?'})`).join(' vs. ');
      L.push(`| ${i+1} | ${g.kind} \`${g.key}\` | ${list} | — |`);
    });
  }
  L.push('');

  // Orphans
  L.push('## 3. Orphan Healthie Links');
  L.push('');
  if (orphans.length === 0) {
    L.push('_None detected._');
  } else {
    L.push('Local row has `healthie_client_id` set but no matching `healthie_clients` link row. Healthie user likely archived/inactive.');
    L.push('');
    L.push('| Patient | Email | Healthie ID | Gender | Local Status |');
    L.push('|---|---|---|---|---|');
    orphans.forEach(o => {
      L.push(`| ${o.full_name || '—'} | ${o.email || '—'} | \`${o.healthie_client_id}\` | ${normGender(o.gender) || '?'} | ${o.status || '—'} |`);
    });
  }
  L.push('');

  // Unclassified proposals
  L.push(`## 4. Proposed Classification — Unclassified Rows Only (${unclassifiedRows.length})`);
  L.push('');
  L.push('**In scope:** patients where `client_type` is NULL or empty (per policy §2 Core Principle #1).');
  L.push('**Out of scope:** all other patients (listed in §5 below, read-only).');
  L.push('**Confidence:** 🟢 HIGH = clear signal. 🟡 MEDIUM = service-line tag. 🔴 LOW = no signal, send to Unclassified for manual review.');
  L.push('');
  L.push('| Dup? | Patient | Gender | Current Type | Proposed Type | Proposed Group | Payment | Service Tags | Conf | Evidence | Known Case |');
  L.push('|------|---------|--------|--------------|---------------|----------------|---------|--------------|------|----------|------------|');
  const icon = { HIGH: '🟢', MEDIUM: '🟡', LOW: '🔴' };
  unclassifiedRows.forEach(r => {
    const nm = (r.full_name || '—').replace(/\|/g, '\\|');
    const gender = normGender(r.gender) || '?';
    const dup = r.isDuplicate ? '⚠️' : '';
    const known = r.known ? `**${r.known.action}** — ${r.known.note}`.replace(/\|/g, '\\|') : '';
    const stags = r.serviceTags.length ? r.serviceTags.join(',') : '—';
    L.push(`| ${dup} | ${nm} | ${gender} | ${r.patient_type} | **${r.proposedType}** | ${r.proposedGroup} | ${r.proposedPayment} | ${stags} | ${icon[r.typeConf]} | ${r.typeEvidence} | ${known} |`);
  });
  L.push('');

  // Classified (reference only)
  const classified = rows.filter(r => !r.isUnclassified);
  L.push(`## 5. Classified Patients — Reference Only (${classified.length})`);
  L.push('');
  L.push('Not in scope. Listed for context only. Per Core Principle #1 these rows are never auto-reclassified.');
  L.push('');
  L.push('<details><summary>Expand to view classified patients</summary>');
  L.push('');
  L.push('| Patient | Gender | Type | Client Type | Group/Clinic | Regimen |');
  L.push('|---|---|---|---|---|---|');
  classified.forEach(r => {
    const nm = (r.full_name || '—').replace(/\|/g, '\\|');
    L.push(`| ${nm} | ${normGender(r.gender) || '?'} | ${r.patient_type} | ${r.client_type || '—'} | ${r.healthie_group_name || r.clinic || '—'} | ${r.regimen || '—'} |`);
  });
  L.push('');
  L.push('</details>');
  L.push('');

  L.push('---');
  L.push('');
  L.push('## Next Steps');
  L.push('1. Resolve **Hard Flags** (§1) — dispense misattribution workflow.');
  L.push('2. Resolve **Confirmed Cases** (§0) — Lyon, Breyer, Gannon, Odom/Tewawina, Bunger.');
  L.push('3. Work **Duplicates** (§2) — staff decides keeper/loser.');
  L.push('4. Fix **Orphan Links** (§3) — relink or archive.');
  L.push('5. Approve **HIGH-confidence Unclassified proposals** (§4) — batch apply.');
  L.push('6. MEDIUM/LOW remain in the Unclassified tab for manual staff review.');

  const outPath = path.join(__dirname, '..', 'docs', 'sot-modules', '26-classification-audit.md');
  fs.writeFileSync(outPath, L.join('\n'));
  console.log(`Wrote ${outPath}`);
  console.log(`  total=${rows.length} unclassified=${unclassifiedRows.length} dups=${dupGroups.length} orphans=${orphans.length} hardFlags=${hardFlagged.length}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

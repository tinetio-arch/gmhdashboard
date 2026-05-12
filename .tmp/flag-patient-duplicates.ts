/**
 * READ-ONLY patient duplicate + empty-row flagging script.
 *
 * Writes NO changes. Produces:
 *   .tmp/patient-dedup-report-<date>.md   (human review)
 *   .tmp/patient-dedup-report-<date>.csv  (spreadsheet)
 *
 * Run:  cd ~/gmhdashboard && npx ts-node .tmp/flag-patient-duplicates.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { query } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, any>;

const normEmail = (e: any) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p: any) => (p ? String(p).replace(/\D/g, '') : '');
const normName = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, ' ') : '');

// Tables that hold data tied to a patient. { table, col, label, kind }
// kind: 'clinical' | 'payment' | 'external' | 'meta'
const REFS: Array<{ table: string; col: string; label: string; kind: string; keyType?: 'uuid' | 'text' | 'healthie' }> = [
  { table: 'healthie_clients', col: 'patient_id', label: 'Healthie mappings', kind: 'external', keyType: 'text' },
  { table: 'healthie_subscriptions', col: 'patient_id', label: 'Healthie subscriptions', kind: 'payment' },
  { table: 'healthie_invoices', col: 'patient_id', label: 'Healthie invoices', kind: 'payment' },
  { table: 'payment_issues', col: 'patient_id', label: 'Payment issues', kind: 'payment' },
  { table: 'payment_transactions', col: 'patient_id', label: 'Payment transactions', kind: 'payment' },
  { table: 'quickbooks_sales_receipts', col: 'patient_id', label: 'QB sales receipts', kind: 'payment' },
  { table: 'quickbooks_payment_transactions', col: 'patient_id', label: 'QB payments', kind: 'payment' },
  { table: 'jane_revenue_snapshots', col: 'patient_id', label: 'Jane revenue snapshots', kind: 'payment' },
  { table: 'peptide_stripe_customers', col: 'patient_id', label: 'Stripe (peptide) customers', kind: 'payment' },
  { table: 'patient_approved_peptides', col: 'patient_id', label: 'Peptide orders', kind: 'clinical' },
  { table: 'pending_peptide_consents', col: 'patient_id', label: 'Pending peptide consents', kind: 'clinical' },
  { table: 'ups_shipments', col: 'patient_id', label: 'UPS shipments', kind: 'clinical' },
  { table: 'scribe_sessions', col: 'patient_id', label: 'Scribe sessions', kind: 'clinical' },
  { table: 'scribe_notes', col: 'patient_id', label: 'Scribe notes', kind: 'clinical' },
  { table: 'lab_orders', col: 'patient_id', label: 'Lab orders', kind: 'clinical' },
  { table: 'dispenses', col: 'patient_id', label: 'Dispenses', kind: 'clinical' },
  { table: 'dea_transactions', col: 'patient_id', label: 'DEA transactions', kind: 'clinical' },
  { table: 'patient_status_activity_log', col: 'patient_id', label: 'Status activity log', kind: 'meta' },
  { table: 'app_access_controls', col: 'patient_id', label: 'App access controls', kind: 'meta' },
  { table: 'kiosk_form_sessions', col: 'patient_id', label: 'Kiosk sessions', kind: 'clinical' },
  { table: 'clinicsync_memberships', col: 'patient_id', label: 'ClinicSync memberships', kind: 'payment' },
  { table: 'patient_qb_mapping', col: 'patient_id', label: 'QB customer mapping', kind: 'external' },
  { table: 'patient_merges', col: 'merged_patient_id', label: 'Prior merges (as merged)', kind: 'meta' },
  { table: 'patient_merges', col: 'primary_patient_id', label: 'Prior merges (as primary)', kind: 'meta' },
];

// Tables keyed by healthie_client_id (TEXT) rather than patients.patient_id
const REFS_BY_HEALTHIE: Array<{ table: string; col: string; label: string; kind: string }> = [
  { table: 'supply_counts', col: 'healthie_patient_id', label: 'Supply counts', kind: 'clinical' },
  { table: 'supply_count_history', col: 'healthie_patient_id', label: 'Supply count history', kind: 'clinical' },
  { table: 'prescription_cache', col: 'healthie_patient_id', label: 'Prescription cache', kind: 'clinical' },
  { table: 'appointment_requests', col: 'patient_healthie_id', label: 'Appointment requests', kind: 'clinical' },
  { table: 'lab_review_queue', col: 'patient_id', label: 'Lab review queue (by text ID)', kind: 'clinical' },
  { table: 'patient_metrics', col: 'patient_id', label: 'Patient metrics (text)', kind: 'clinical' },
  { table: 'patient_service_tags', col: 'patient_id', label: 'Service tags (text)', kind: 'meta' },
];

// Tables keyed by GHL contact
const REFS_BY_GHL: Array<{ table: string; col: string; label: string; kind: string }> = [
  { table: 'ghl_messages', col: 'ghl_contact_id', label: 'GHL messages', kind: 'external' },
];

async function tableExists(tbl: string): Promise<boolean> {
  const r = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
    [tbl]
  );
  return !!r[0]?.exists;
}

async function columnExists(tbl: string, col: string): Promise<boolean> {
  const r = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS exists`,
    [tbl, col]
  );
  return !!r[0]?.exists;
}

async function countFor(tbl: string, col: string, val: string | number): Promise<number> {
  try {
    const r = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${tbl} WHERE ${col} = $1`, [val]);
    return parseInt(r[0]?.n || '0', 10);
  } catch {
    return 0;
  }
}

async function countForText(tbl: string, col: string, val: string): Promise<number> {
  try {
    const r = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${tbl} WHERE ${col}::text = $1`, [val]);
    return parseInt(r[0]?.n || '0', 10);
  } catch {
    return 0;
  }
}

interface Inventory {
  byUuid: Record<string, number>;
  byHealthie: Record<string, number>;
  byGhl: Record<string, number>;
  totals: { clinical: number; payment: number; external: number; meta: number; overall: number };
}

async function buildInventory(p: Row, availRefs: typeof REFS, availHealthieRefs: typeof REFS_BY_HEALTHIE, availGhlRefs: typeof REFS_BY_GHL): Promise<Inventory> {
  const inv: Inventory = {
    byUuid: {},
    byHealthie: {},
    byGhl: {},
    totals: { clinical: 0, payment: 0, external: 0, meta: 0, overall: 0 },
  };

  for (const r of availRefs) {
    const n = await countFor(r.table, r.col, p.patient_id);
    const key = `${r.table}.${r.col} (${r.label})`;
    inv.byUuid[key] = n;
    if (n > 0) {
      (inv.totals as any)[r.kind] += n;
      inv.totals.overall += n;
    }
  }
  if (p.healthie_client_id) {
    for (const r of availHealthieRefs) {
      const n = await countForText(r.table, r.col, String(p.healthie_client_id));
      const key = `${r.table}.${r.col} (${r.label})`;
      inv.byHealthie[key] = n;
      if (n > 0) {
        (inv.totals as any)[r.kind] += n;
        inv.totals.overall += n;
      }
    }
  }
  if (p.ghl_contact_id) {
    for (const r of availGhlRefs) {
      const n = await countForText(r.table, r.col, String(p.ghl_contact_id));
      const key = `${r.table}.${r.col} (${r.label})`;
      inv.byGhl[key] = n;
      if (n > 0) {
        (inv.totals as any)[r.kind] += n;
        inv.totals.overall += n;
      }
    }
  }
  return inv;
}

function populatedFieldCount(p: Row): number {
  const fields = ['full_name', 'email', 'phone_primary', 'dob', 'gender', 'address_line1', 'city',
    'state', 'postal_code', 'healthie_client_id', 'ghl_contact_id', 'status_key',
    'payment_method_key', 'client_type_key', 'regimen', 'clinic', 'patient_type'];
  return fields.reduce((acc, f) => acc + (p[f] != null && String(p[f]).trim() !== '' ? 1 : 0), 0);
}

function isEmpty(p: Row): boolean {
  const nameBlank = !p.full_name || String(p.full_name).trim() === '';
  const allContactBlank = !p.email && !p.phone_primary && !p.healthie_client_id && !p.ghl_contact_id;
  return nameBlank || allContactBlank;
}

function fmtRow(p: Row): string {
  return `${p.patient_id} | name="${p.full_name || ''}" | email="${p.email || ''}" | phone="${p.phone_primary || ''}" | dob=${p.dob || ''} | healthie=${p.healthie_client_id || ''} | ghl=${p.ghl_contact_id || ''} | type=${p.patient_type || ''} | status=${p.status_key || ''} | added=${p.date_added || ''}`;
}

async function main() {
  console.log('[flag] Loading all patients...');
  const patients = await query<Row>(`SELECT * FROM patients ORDER BY date_added NULLS LAST`);
  console.log(`[flag] Loaded ${patients.length} patient rows`);

  // Pre-filter available ref tables so missing tables don't kill the run
  const availRefs: typeof REFS = [];
  for (const r of REFS) {
    if (await tableExists(r.table) && await columnExists(r.table, r.col)) availRefs.push(r);
  }
  const availHealthieRefs: typeof REFS_BY_HEALTHIE = [];
  for (const r of REFS_BY_HEALTHIE) {
    if (await tableExists(r.table) && await columnExists(r.table, r.col)) availHealthieRefs.push(r);
  }
  const availGhlRefs: typeof REFS_BY_GHL = [];
  for (const r of REFS_BY_GHL) {
    if (await tableExists(r.table) && await columnExists(r.table, r.col)) availGhlRefs.push(r);
  }
  console.log(`[flag] Ref tables available: ${availRefs.length} by uuid, ${availHealthieRefs.length} by healthie_id, ${availGhlRefs.length} by ghl_id`);

  // Group by each dedup key
  const byHealthie = new Map<string, Row[]>();
  const byEmail = new Map<string, Row[]>();
  const byPhone = new Map<string, Row[]>();
  const byNameDob = new Map<string, Row[]>();
  const byGhl = new Map<string, Row[]>();

  for (const p of patients) {
    if (p.healthie_client_id) {
      const k = String(p.healthie_client_id);
      if (!byHealthie.has(k)) byHealthie.set(k, []);
      byHealthie.get(k)!.push(p);
    }
    const e = normEmail(p.email);
    if (e) {
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e)!.push(p);
    }
    const ph = normPhone(p.phone_primary);
    if (ph && ph.length >= 10) {
      if (!byPhone.has(ph)) byPhone.set(ph, []);
      byPhone.get(ph)!.push(p);
    }
    const n = normName(p.full_name);
    if (n && p.dob) {
      const k = `${n}|${p.dob}`;
      if (!byNameDob.has(k)) byNameDob.set(k, []);
      byNameDob.get(k)!.push(p);
    }
    if (p.ghl_contact_id) {
      const k = String(p.ghl_contact_id);
      if (!byGhl.has(k)) byGhl.set(k, []);
      byGhl.get(k)!.push(p);
    }
  }

  // Collect all patients involved in any duplicate group, or empty
  const involved = new Map<string, { reasons: Set<string>; groups: Array<{ key: string; value: string; members: string[] }> }>();
  const recordGroup = (label: string, value: string, members: Row[]) => {
    if (members.length < 2) return;
    const memberIds = members.map(m => m.patient_id);
    for (const m of members) {
      if (!involved.has(m.patient_id)) involved.set(m.patient_id, { reasons: new Set(), groups: [] });
      involved.get(m.patient_id)!.reasons.add(label);
      involved.get(m.patient_id)!.groups.push({ key: label, value, members: memberIds });
    }
  };
  for (const [k, v] of byHealthie) recordGroup('same healthie_client_id', k, v);
  for (const [k, v] of byEmail) recordGroup('same email', k, v);
  for (const [k, v] of byPhone) recordGroup('same phone', k, v);
  for (const [k, v] of byNameDob) recordGroup('same name+dob', k, v);
  for (const [k, v] of byGhl) recordGroup('same ghl_contact_id', k, v);

  const empties = patients.filter(isEmpty);
  for (const p of empties) {
    if (!involved.has(p.patient_id)) involved.set(p.patient_id, { reasons: new Set(), groups: [] });
    involved.get(p.patient_id)!.reasons.add('empty row');
  }

  console.log(`[flag] Empty rows: ${empties.length}`);
  console.log(`[flag] Patients involved in any flag: ${involved.size}`);

  // Build inventories for involved patients
  const inventories = new Map<string, Inventory>();
  const patientById = new Map(patients.map(p => [p.patient_id, p]));
  let done = 0;
  for (const id of involved.keys()) {
    const p = patientById.get(id)!;
    inventories.set(id, await buildInventory(p, availRefs, availHealthieRefs, availGhlRefs));
    done++;
    if (done % 25 === 0) console.log(`[flag]   inventory ${done}/${involved.size}`);
  }

  // Build markdown report
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(process.cwd(), '.tmp', `patient-dedup-report-${date}.md`);
  const csvPath = path.join(process.cwd(), '.tmp', `patient-dedup-report-${date}.csv`);

  const md: string[] = [];
  md.push(`# Patient Dedup & Empty-Row Report — ${date}`);
  md.push('');
  md.push(`**Read-only.** No data was modified. Review findings below; ask Claude to act on anything specific.`);
  md.push('');
  md.push(`- Total patients: **${patients.length}**`);
  md.push(`- Flagged (empty or in a duplicate group): **${involved.size}**`);
  md.push(`- Empty rows: **${empties.length}**`);
  md.push('');

  // Duplicate groups
  const seenGroupKeys = new Set<string>();
  const groupBuckets: Record<string, Array<{ value: string; members: Row[] }>> = {
    'same healthie_client_id': [],
    'same email': [],
    'same phone': [],
    'same name+dob': [],
    'same ghl_contact_id': [],
  };
  const pushGroup = (label: string, map: Map<string, Row[]>) => {
    for (const [k, v] of map) if (v.length >= 2) groupBuckets[label].push({ value: k, members: v });
  };
  pushGroup('same healthie_client_id', byHealthie);
  pushGroup('same email', byEmail);
  pushGroup('same phone', byPhone);
  pushGroup('same name+dob', byNameDob);
  pushGroup('same ghl_contact_id', byGhl);

  for (const label of Object.keys(groupBuckets)) {
    md.push(`## Duplicate groups — ${label}`);
    md.push('');
    const buckets = groupBuckets[label];
    if (buckets.length === 0) { md.push('_None._'); md.push(''); continue; }
    md.push(`Found **${buckets.length}** groups.`);
    md.push('');
    for (const { value, members } of buckets) {
      const gk = `${label}::${value}`;
      if (seenGroupKeys.has(gk)) continue;
      seenGroupKeys.add(gk);

      // Score each member: populated fields + dependent rows
      const scored = members.map(m => {
        const inv = inventories.get(m.patient_id)!;
        return { m, inv, score: populatedFieldCount(m) * 10 + inv.totals.overall };
      }).sort((a, b) => b.score - a.score);
      const keeper = scored[0].m;

      md.push(`### \`${value}\`  (${members.length} rows)`);
      md.push('');
      md.push(`**Suggested keeper (most data):** \`${keeper.patient_id}\` — "${keeper.full_name || '(no name)'}"`);
      md.push('');
      md.push('| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |');
      md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const s of scored) {
        const role = s.m.patient_id === keeper.patient_id ? '**KEEP?**' : 'dup?';
        md.push(`| ${role} | \`${s.m.patient_id}\` | ${s.m.full_name || ''} | ${s.m.email || ''} | ${s.m.phone_primary || ''} | ${s.m.dob || ''} | ${s.m.healthie_client_id || ''} | ${s.m.ghl_contact_id || ''} | ${s.m.patient_type || ''} | ${s.m.status_key || ''} | ${populatedFieldCount(s.m)} | ${s.inv.totals.clinical} | ${s.inv.totals.payment} | ${s.inv.totals.external} | ${s.inv.totals.meta} |`);
      }
      md.push('');
      md.push('<details><summary>Per-row dependent-data inventory</summary>');
      md.push('');
      for (const s of scored) {
        md.push(`**\`${s.m.patient_id}\`**`);
        const lines: string[] = [];
        for (const [k, n] of Object.entries(s.inv.byUuid)) if (n > 0) lines.push(`  - ${k}: ${n}`);
        for (const [k, n] of Object.entries(s.inv.byHealthie)) if (n > 0) lines.push(`  - [by healthie_id] ${k}: ${n}`);
        for (const [k, n] of Object.entries(s.inv.byGhl)) if (n > 0) lines.push(`  - [by ghl_id] ${k}: ${n}`);
        if (lines.length === 0) md.push('  _no dependent data_');
        else md.push(lines.join('\n'));
        md.push('');
      }
      md.push('</details>');
      md.push('');
    }
  }

  md.push('## Empty rows (no name, or no contact info at all)');
  md.push('');
  if (empties.length === 0) md.push('_None._');
  else {
    md.push('| patient_id | name | email | phone | healthie_id | ghl_id | date_added | populated_fields | dep_rows_total |');
    md.push('|---|---|---|---|---|---|---|---|---|');
    for (const p of empties) {
      const inv = inventories.get(p.patient_id)!;
      md.push(`| \`${p.patient_id}\` | ${p.full_name || ''} | ${p.email || ''} | ${p.phone_primary || ''} | ${p.healthie_client_id || ''} | ${p.ghl_contact_id || ''} | ${p.date_added || ''} | ${populatedFieldCount(p)} | ${inv.totals.overall} |`);
    }
  }
  md.push('');

  fs.writeFileSync(mdPath, md.join('\n'));
  console.log(`[flag] Wrote ${mdPath}`);

  // CSV: one row per flagged patient
  const csvHeader = ['patient_id', 'reasons', 'full_name', 'email', 'phone_primary', 'dob', 'healthie_client_id', 'ghl_contact_id', 'patient_type', 'status_key', 'date_added', 'populated_fields', 'dep_clinical', 'dep_payment', 'dep_external', 'dep_meta', 'dep_total', 'duplicate_group_peers'];
  const csvLines = [csvHeader.join(',')];
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const [id, meta] of involved) {
    const p = patientById.get(id)!;
    const inv = inventories.get(id)!;
    const peers = Array.from(new Set(meta.groups.flatMap(g => g.members.filter(m => m !== id)))).join(';');
    csvLines.push([
      id, Array.from(meta.reasons).join('; '), p.full_name, p.email, p.phone_primary,
      p.dob, p.healthie_client_id, p.ghl_contact_id, p.patient_type, p.status_key, p.date_added,
      populatedFieldCount(p), inv.totals.clinical, inv.totals.payment, inv.totals.external, inv.totals.meta, inv.totals.overall, peers,
    ].map(esc).join(','));
  }
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`[flag] Wrote ${csvPath}`);

  console.log('[flag] Done. READ-ONLY — nothing was modified.');
  process.exit(0);
}

main().catch(err => {
  console.error('[flag] FAILED:', err);
  process.exit(1);
});

/**
 * Exceptions Queue — read-only surfacing of data-integrity issues that need staff review.
 *
 * Per docs/sot-modules/25-patient-classification-and-dashboard.md §7.3 (dedup policy:
 * never auto-merge) + §7.6 (dispense misattribution) + §8.6.9 (ABXTAC lifecycle).
 *
 * Categories:
 *   - Duplicate candidates (same email, phone, Healthie ID, GHL contact, name+DOB)
 *   - Orphan Healthie links (patient row points at inactive/missing Healthie user)
 *   - TRT hard flags (non-male patients with dispense history — misattribution risk)
 *   - ABXTAC lifecycle (payment_hold, inactive — needs review)
 *   - Unclassified count (Member/Visit without client_type assigned)
 *
 * Nothing is mutated; this is a staff visibility layer.
 */

import { query } from '@/lib/db';

export type DuplicateGroup = {
  kind: 'email' | 'phone' | 'healthie_id' | 'ghl_contact' | 'name_dob';
  match_value: string;
  patients: Array<{
    patient_id: string;
    full_name: string;
    email: string | null;
    phone_primary: string | null;
    dob: string | null;
    gender: string | null;
    healthie_client_id: string | null;
    dispense_count: number;
    membership_count: number;
    client_type: string | null;
  }>;
};

export type OrphanLink = {
  patient_id: string;
  full_name: string;
  email: string | null;
  healthie_client_id: string;
  status_key: string | null;
  gender: string | null;
};

export type TrtHardFlag = {
  patient_id: string;
  full_name: string;
  gender: string | null;
  dispense_count: number;
  last_dispense_date: string | null;
};

export type AbxtacLifecycleFlag = {
  patient_id: string;
  full_name: string;
  email: string | null;
  healthie_client_id: string | null;
  tier: string;
  membership_status: string;
  tier_expires_at: string | null;
};

export type ExceptionsSummary = {
  duplicates: DuplicateGroup[];
  orphans: OrphanLink[];
  trtHardFlags: TrtHardFlag[];
  abxtacLifecycle: AbxtacLifecycleFlag[];
  unclassifiedCount: number;
  generatedAt: string;
};

function normEmail(e: string | null): string | null {
  return e ? e.trim().toLowerCase() || null : null;
}
function normPhone(p: string | null): string | null {
  const d = (p || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? '1' + d : d;
}
function normName(n: string | null): string | null {
  return n ? n.trim().toLowerCase().replace(/\s+/g, ' ') || null : null;
}
function sameDob(rows: Array<{ dob: string | null }>): boolean {
  const dobs = new Set(rows.map(r => r.dob ? String(r.dob).slice(0, 10) : ''));
  return dobs.size === 1;
}

export async function fetchExceptions(): Promise<ExceptionsSummary> {
  // Pull every patient with the fields we need for dedup + flagging.
  const rows = await query<{
    patient_id: string;
    full_name: string | null;
    email: string | null;
    phone_primary: string | null;
    dob: string | null;
    gender: string | null;
    healthie_client_id: string | null;
    ghl_contact_id: string | null;
    client_type: string | null;
    dispense_count: string;
    membership_count: string;
  }>(`
    SELECT
      p.patient_id::text AS patient_id,
      p.full_name, p.email, p.phone_primary, p.dob::text AS dob, p.gender,
      p.healthie_client_id, p.ghl_contact_id, p.client_type,
      (SELECT COUNT(*)::text FROM dispenses d WHERE d.patient_id = p.patient_id) AS dispense_count,
      (SELECT COUNT(*)::text FROM clinicsync_memberships m WHERE m.patient_id = p.patient_id) AS membership_count
    FROM patients p
  `);

  // Dedup buckets
  const byEmail = new Map<string, typeof rows>();
  const byPhone = new Map<string, typeof rows>();
  const byHealthie = new Map<string, typeof rows>();
  const byGhl = new Map<string, typeof rows>();
  const byNameDob = new Map<string, typeof rows>();

  for (const r of rows) {
    const e = normEmail(r.email);
    if (e) (byEmail.get(e) || byEmail.set(e, []).get(e)!).push(r);
    const ph = normPhone(r.phone_primary);
    if (ph) (byPhone.get(ph) || byPhone.set(ph, []).get(ph)!).push(r);
    if (r.healthie_client_id) {
      (byHealthie.get(r.healthie_client_id) || byHealthie.set(r.healthie_client_id, []).get(r.healthie_client_id)!).push(r);
    }
    if (r.ghl_contact_id) {
      (byGhl.get(r.ghl_contact_id) || byGhl.set(r.ghl_contact_id, []).get(r.ghl_contact_id)!).push(r);
    }
    const nn = normName(r.full_name);
    const dobKey = r.dob ? String(r.dob).slice(0, 10) : '';
    if (nn && dobKey) {
      const k = `${nn}|${dobKey}`;
      (byNameDob.get(k) || byNameDob.set(k, []).get(k)!).push(r);
    }
  }

  const dupGroups: DuplicateGroup[] = [];
  const seenKeys = new Set<string>();

  const addGroup = (kind: DuplicateGroup['kind'], value: string, groupRows: typeof rows) => {
    if (groupRows.length < 2) return;
    // Family-member exclusion: email/phone collisions with different DOBs are not duplicates
    if ((kind === 'email' || kind === 'phone') && !sameDob(groupRows)) return;
    const groupKey = `${kind}:${groupRows.map(r => r.patient_id).sort().join(',')}`;
    if (seenKeys.has(groupKey)) return;
    seenKeys.add(groupKey);
    dupGroups.push({
      kind,
      match_value: value,
      patients: groupRows.map(r => ({
        patient_id: r.patient_id,
        full_name: r.full_name || '(unnamed)',
        email: r.email,
        phone_primary: r.phone_primary,
        dob: r.dob ? String(r.dob).slice(0, 10) : null,
        gender: r.gender,
        healthie_client_id: r.healthie_client_id,
        dispense_count: parseInt(r.dispense_count, 10),
        membership_count: parseInt(r.membership_count, 10),
        client_type: r.client_type
      }))
    });
  };

  for (const [k, gr] of byEmail) addGroup('email', k, gr);
  for (const [k, gr] of byPhone) addGroup('phone', k, gr);
  for (const [k, gr] of byHealthie) addGroup('healthie_id', k, gr);
  for (const [k, gr] of byGhl) addGroup('ghl_contact', k, gr);
  for (const [k, gr] of byNameDob) addGroup('name_dob', k, gr);

  // Orphan Healthie links
  const orphanRows = await query<{
    patient_id: string; full_name: string | null; email: string | null;
    healthie_client_id: string; status_key: string | null; gender: string | null;
  }>(`
    SELECT p.patient_id::text AS patient_id, p.full_name, p.email, p.healthie_client_id,
           p.status_key, p.gender
    FROM patients p
    LEFT JOIN healthie_clients hc ON hc.healthie_client_id = p.healthie_client_id
    WHERE p.healthie_client_id IS NOT NULL AND hc.healthie_client_id IS NULL
    ORDER BY p.full_name
  `);
  const orphans: OrphanLink[] = orphanRows.map(r => ({
    patient_id: r.patient_id,
    full_name: r.full_name || '(unnamed)',
    email: r.email,
    healthie_client_id: r.healthie_client_id,
    status_key: r.status_key,
    gender: r.gender
  }));

  // TRT hard flags — EXPLICITLY female/other with TRT dispense history.
  // NULL gender is NOT flagged — most patients have unset gender but ARE male;
  // flagging null would produce too many false positives to be useful.
  // Only an explicit female/other + dispenses indicates a real misattribution risk.
  const trtFlagsRows = await query<{
    patient_id: string; full_name: string | null; gender: string | null;
    dispense_count: string; last_dispense_date: string | null;
  }>(`
    SELECT
      p.patient_id::text AS patient_id,
      p.full_name,
      p.gender,
      COUNT(d.*)::text AS dispense_count,
      MAX(d.dispense_date)::text AS last_dispense_date
    FROM patients p
    JOIN dispenses d ON d.patient_id = p.patient_id
    WHERE LOWER(COALESCE(p.gender, '')) IN ('female', 'f', 'other')
    GROUP BY p.patient_id, p.full_name, p.gender
    HAVING COUNT(d.*) > 0
    ORDER BY p.full_name
  `);
  const trtHardFlags: TrtHardFlag[] = trtFlagsRows.map(r => ({
    patient_id: r.patient_id,
    full_name: r.full_name || '(unnamed)',
    gender: r.gender,
    dispense_count: parseInt(r.dispense_count, 10),
    last_dispense_date: r.last_dispense_date ? String(r.last_dispense_date).slice(0, 10) : null
  }));

  // ABXTAC lifecycle flags — anything not 'active'
  const abxtacRows = await query<{
    patient_id: string; full_name: string | null; email: string | null;
    healthie_client_id: string | null; tier: string; membership_status: string;
    tier_expires_at: string | null;
  }>(`
    SELECT
      COALESCE(p.patient_id::text, '') AS patient_id,
      p.full_name,
      COALESCE(p.email, a.email) AS email,
      p.healthie_client_id,
      a.tier,
      a.membership_status,
      a.tier_expires_at::text AS tier_expires_at
    FROM abxtac_customer_access a
    LEFT JOIN patients p ON p.healthie_client_id = a.healthie_patient_id
    WHERE a.membership_status IN ('payment_hold', 'inactive')
    ORDER BY a.membership_status, p.full_name
  `);
  const abxtacLifecycle: AbxtacLifecycleFlag[] = abxtacRows.map(r => ({
    patient_id: r.patient_id,
    full_name: r.full_name || '(unknown)',
    email: r.email,
    healthie_client_id: r.healthie_client_id,
    tier: r.tier,
    membership_status: r.membership_status,
    tier_expires_at: r.tier_expires_at ? String(r.tier_expires_at).slice(0, 10) : null
  }));

  // Unclassified count
  const [{ unclassified_count }] = await query<{ unclassified_count: string }>(`
    SELECT COUNT(*)::text AS unclassified_count
    FROM patients
    WHERE client_type IS NULL OR client_type = ''
  `);

  return {
    duplicates: dupGroups,
    orphans,
    trtHardFlags,
    abxtacLifecycle,
    unclassifiedCount: parseInt(unclassified_count, 10),
    generatedAt: new Date().toISOString()
  };
}

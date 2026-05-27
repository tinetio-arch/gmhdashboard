/**
 * patientChart.ts — single-call patient chart assembler.
 *
 * One function: `assemblePatientChart(identifier)` → the whole chart for an
 * AI agent (Phase 1 of the iPad Patient-Chart AI).
 *
 * Sources, in one parallel fan-out:
 *   • Postgres `patients`        — demographics, status, dx (JSONB), lab dates, regimen text, notes
 *   • Postgres `patient_allergies` — local allergies + NKDA marker
 *   • Postgres `dispenses` + `vials` — recent signed TRT
 *   • Postgres `peptide_dispenses` + `peptide_products` — recent peptide fulfillments
 *   • Postgres `scribe_notes`     — recent ICD-10 codes from signed SOAP notes
 *   • Postgres `lab_review_queue` — recent reviewed labs
 *   • Healthie GraphQL            — current meds + allergies
 *
 * Design rules (different from the existing /api/ipad/patient-chart route):
 *   1. PURE READ. No DB writebacks, no Stripe calls, no UI-shape coupling.
 *   2. Per-section timeouts — a slow Healthie call degrades that section only.
 *   3. Distinguish empty-from-API from API-down via `meta.degradedSections`.
 *   4. Accepts either a UUID `patient_id` or a Healthie client ID.
 *   5. Returns `null` when the patient cannot be resolved (caller decides what to do).
 */

import { query } from './db';
import type { HealthieMedication, HealthieAllergy } from './healthie';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PatientChartDemographics = {
  fullName: string | null;
  preferredName: string | null;
  dob: string | null; // raw YYYY-MM-DD; never round-trip through Date
  ageYears: number | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  status: { key: string | null; display: string | null };
  clinic: string | null;
  patientType: string | null;
};

export type DiagnosisEntry = Record<string, unknown>; // shape is JSONB free-form

export type AllergyItem = {
  name: string;
  reaction: string | null;
  severity: string | null;
  source: 'local' | 'healthie';
};

export type TrtDispenseSummary = {
  dispenseId: string;
  dispenseDate: string | null;
  dosePerSyringeMl: number | null;
  syringeCount: number | null;
  totalDispensedMl: number | null;
  prescriber: string | null;
  drugName: string | null;
  vialSource: string | null;
};

export type PeptideDispenseSummary = {
  saleId: string;
  saleDate: string | null;
  productName: string | null;
  quantity: number | null;
  amountCharged: number | null;
  status: string | null;
};

export type ReviewedLabSummary = {
  accession: string | null;
  status: string | null;
  createdAt: string | null;
};

export type PatientChart = {
  patientId: string;
  healthieClientId: string | null;
  resolvedFrom: 'uuid' | 'healthie_client_id';

  demographics: PatientChartDemographics;

  problems: {
    confirmed: DiagnosisEntry[];
    removed: DiagnosisEntry[];
    recentIcd10FromScribe: string[];
  };

  regimen: {
    summary: string | null; // patients.regimen free-text
    medications: HealthieMedication[];
    recentTrtDispenses: TrtDispenseSummary[];
    recentPeptideDispenses: PeptideDispenseSummary[];
  };

  allergies: {
    nkda: boolean;
    items: AllergyItem[];
  };

  labs: {
    lastLabDate: string | null;
    nextLabDate: string | null;
    status: string | null;
    recentReviewed: ReviewedLabSummary[];
  };

  notes: {
    general: string | null;
    interestingFacts: string | null;
  };

  meta: {
    assembledAt: string;
    healthieAvailable: boolean;
    degradedSections: string[];
  };
};

export type AssembleOptions = {
  healthieTimeoutMs?: number;
};

// ─── Internal helpers ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PatientRow = {
  patient_id: string;
  full_name: string | null;
  preferred_name: string | null;
  dob: string | null;
  gender: string | null;
  email: string | null;
  phone_primary: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  status_key: string | null;
  status_display: string | null;
  clinic: string | null;
  patient_type: string | null;
  regimen: string | null;
  confirmed_diagnoses: DiagnosisEntry[] | null;
  removed_diagnoses: DiagnosisEntry[] | null;
  last_lab_date: string | null;
  next_lab_date: string | null;
  lab_status: string | null;
  notes: string | null;
  interesting_facts: string | null;
};

const PATIENT_SELECT = `
  SELECT
    p.patient_id,
    p.full_name,
    p.preferred_name,
    p.dob,
    p.gender,
    p.email,
    p.phone_primary,
    p.address_line1,
    p.address_line2,
    p.city,
    p.state,
    p.postal_code,
    p.country,
    p.status_key,
    psl.display_name        AS status_display,
    p.clinic,
    p.patient_type,
    p.regimen,
    p.confirmed_diagnoses,
    p.removed_diagnoses,
    p.last_lab_date,
    p.next_lab_date,
    p.lab_status,
    p.notes,
    p.interesting_facts
  FROM patients p
  LEFT JOIN patient_status_lookup psl ON psl.status_key = p.status_key
`;

/**
 * Resolve a caller-supplied identifier (UUID or Healthie client ID) to the
 * canonical `patients` row plus the active `healthie_client_id`.
 */
async function resolvePatient(identifier: string): Promise<
  { patient: PatientRow; healthieClientId: string | null; resolvedFrom: 'uuid' | 'healthie_client_id' } | null
> {
  const isUuid = UUID_RE.test(identifier);

  // 1. Direct UUID lookup
  if (isUuid) {
    const rows = await query<PatientRow>(`${PATIENT_SELECT} WHERE p.patient_id = $1::uuid LIMIT 1`, [identifier]);
    if (rows[0]) {
      const hc = await activeHealthieClientId(rows[0].patient_id);
      return { patient: rows[0], healthieClientId: hc, resolvedFrom: 'uuid' };
    }
    return null;
  }

  // 2. Healthie client ID — check the canonical healthie_clients link table first
  const linkRows = await query<{ patient_id: string }>(
    `SELECT patient_id
       FROM healthie_clients
      WHERE healthie_client_id = $1
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1`,
    [identifier]
  );
  let patientUuid = linkRows[0]?.patient_id ?? null;

  // 3. Fallback to the denormalized column on patients (older rows)
  if (!patientUuid) {
    const fallback = await query<{ patient_id: string }>(
      `SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
      [identifier]
    );
    patientUuid = fallback[0]?.patient_id ?? null;
  }

  if (!patientUuid) return null;

  const rows = await query<PatientRow>(`${PATIENT_SELECT} WHERE p.patient_id = $1::uuid LIMIT 1`, [patientUuid]);
  if (!rows[0]) return null;

  return { patient: rows[0], healthieClientId: identifier, resolvedFrom: 'healthie_client_id' };
}

async function activeHealthieClientId(patientId: string): Promise<string | null> {
  const rows = await query<{ healthie_client_id: string }>(
    `SELECT healthie_client_id
       FROM healthie_clients
      WHERE patient_id = $1
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1`,
    [patientId]
  );
  return rows[0]?.healthie_client_id ?? null;
}

/**
 * Race a promise against a timeout. On failure or timeout, log the section
 * label, push it onto `degraded`, and return `fallback`.
 *
 * Why we track `degraded`: lib/healthie.ts (FIX 2026-05-20) now throws on
 * failure instead of swallowing to []. That distinction is the whole point —
 * the AI should know "Healthie was down" vs "patient genuinely has no
 * allergies."
 */
function guard<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs: number,
  degraded: string[]
): Promise<T> {
  return Promise.race<T>([
    promise.catch((err) => {
      console.error(`[patientChart] ${label} failed, degrading:`, err?.message || err);
      degraded.push(label);
      return fallback;
    }),
    new Promise<T>((resolve) =>
      setTimeout(() => {
        console.warn(`[patientChart] ${label} timed out after ${timeoutMs}ms, degrading`);
        degraded.push(label);
        resolve(fallback);
      }, timeoutMs)
    ),
  ]);
}

/**
 * Direct Healthie GraphQL call.
 *
 * We hit Healthie directly here instead of going through lib/healthie.ts's
 * `getMedications` / `getAllergies` because those wrappers declare wrong
 * GraphQL types (`String` instead of `ID`) and reference a root-level
 * `allergySensitivities` field that no longer exists. The shapes below match
 * the proven queries in app/api/ipad/patient-chart/route.ts. Fixing the
 * upstream wrappers is a separate task — this file is the assembler.
 */
async function healthieGraphQL<T>(
  gql: string,
  variables: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
  const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
  if (!HEALTHIE_API_KEY) throw new Error('HEALTHIE_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(HEALTHIE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${HEALTHIE_API_KEY}`,
        AuthorizationSource: 'API',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: gql, variables }),
      signal: controller.signal,
      cache: 'no-store',
    } as RequestInit);
    if (!res.ok) throw new Error(`Healthie HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`Healthie GraphQL: ${json.errors.map((e: any) => e.message).join(', ')}`);
    }
    return json.data as T;
  } finally {
    clearTimeout(timer);
  }
}

const HEALTHIE_MEDS_QUERY = `
  query Meds($patientId: ID) {
    medications(patient_id: $patientId) {
      id
      name
      dosage
      frequency
      route
      directions
      start_date
      end_date
      normalized_status
      created_at
      updated_at
    }
  }
`;

const HEALTHIE_ALLERGIES_QUERY = `
  query Allergies($userId: ID) {
    user(id: $userId) {
      allergy_sensitivities {
        id
        name
        reaction
        severity
      }
    }
  }
`;

/**
 * Whole-year age from a YYYY-MM-DD dob. We deliberately do not pass dob through
 * `new Date()` for display — same Arizona-DST reasoning as lib/db.ts type 1082
 * override — but a calendar-math age is fine because we never re-emit it as a
 * string.
 */
function computeAgeYears(dob: string | null): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [, y, mo, d] = m;
  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  let age = ty - Number(y);
  if (tm < Number(mo) || (tm === Number(mo) && td < Number(d))) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function mergeAllergies(
  local: { name: string | null; reaction: string | null; severity: string | null; is_nkda: boolean | null }[],
  healthie: HealthieAllergy[]
): { nkda: boolean; items: AllergyItem[] } {
  // NKDA from the local table is a hard signal — clinical staff explicitly
  // marked "no known drug allergies." Honor it and drop any other entries.
  const nkdaEntry = local.find((a) => a.is_nkda);
  if (nkdaEntry) {
    return { nkda: true, items: [] };
  }

  const seen = new Set<string>();
  const items: AllergyItem[] = [];

  for (const a of local) {
    const name = (a.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, reaction: a.reaction, severity: a.severity, source: 'local' });
  }
  for (const a of healthie) {
    const name = (a.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, reaction: a.reaction ?? null, severity: a.severity ?? null, source: 'healthie' });
  }

  return { nkda: false, items };
}

function normalizeDiagnoses(raw: unknown): DiagnosisEntry[] {
  if (Array.isArray(raw)) return raw as DiagnosisEntry[];
  return [];
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Assemble the whole patient chart in one call.
 *
 * Returns `null` if the identifier resolves to no patient (caller decides
 * 404 vs. "not found in DB but is a valid Healthie ID" handling).
 */
export async function assemblePatientChart(
  identifier: string,
  options: AssembleOptions = {}
): Promise<PatientChart | null> {
  const HEALTHIE_TIMEOUT = options.healthieTimeoutMs ?? 5_000;
  const degraded: string[] = [];
  const assembledAt = new Date().toISOString();

  const resolved = await resolvePatient(identifier);
  if (!resolved) return null;

  const { patient, healthieClientId, resolvedFrom } = resolved;

  const healthieAvailable = !!(healthieClientId && process.env.HEALTHIE_API_KEY);
  if (healthieClientId && !process.env.HEALTHIE_API_KEY) {
    degraded.push('healthie_client_unconfigured');
  }

  // Fan out everything in parallel. Each Postgres call is small + indexed; the
  // Healthie calls carry their own per-section timeout via `guard`.
  const [
    medications,
    healthieAllergies,
    localAllergies,
    trtDispenses,
    peptideDispenses,
    recentScribeIcd10,
    recentLabs,
  ] = await Promise.all([
    healthieAvailable && healthieClientId
      ? guard(
          healthieGraphQL<{ medications: HealthieMedication[] }>(
            HEALTHIE_MEDS_QUERY,
            { patientId: healthieClientId },
            HEALTHIE_TIMEOUT
          ).then((d) => d?.medications ?? []),
          [] as HealthieMedication[],
          'healthie.medications',
          HEALTHIE_TIMEOUT,
          degraded
        )
      : Promise.resolve([] as HealthieMedication[]),

    healthieAvailable && healthieClientId
      ? guard(
          healthieGraphQL<{ user: { allergy_sensitivities: HealthieAllergy[] } | null }>(
            HEALTHIE_ALLERGIES_QUERY,
            { userId: healthieClientId },
            HEALTHIE_TIMEOUT
          ).then((d) => d?.user?.allergy_sensitivities ?? []),
          [] as HealthieAllergy[],
          'healthie.allergies',
          HEALTHIE_TIMEOUT,
          degraded
        )
      : Promise.resolve([] as HealthieAllergy[]),

    query<{ name: string | null; reaction: string | null; severity: string | null; is_nkda: boolean | null }>(
      `SELECT name, reaction, severity, is_nkda
         FROM patient_allergies
        WHERE patient_id = $1::uuid
          AND COALESCE(status, 'Active') = 'Active'
        ORDER BY is_nkda DESC, created_at DESC`,
      [patient.patient_id]
    ).catch((err) => {
      console.error('[patientChart] patient_allergies failed:', err?.message || err);
      degraded.push('local.patient_allergies');
      return [];
    }),

    query<{
      dispense_id: string;
      dispense_date: string | null;
      dose_per_syringe_ml: string | number | null;
      syringe_count: number | null;
      total_dispensed_ml: string | number | null;
      prescriber: string | null;
      dea_drug_name: string | null;
      vial_source: string | null;
    }>(
      `SELECT
         d.dispense_id,
         d.dispense_date,
         d.dose_per_syringe_ml,
         d.syringe_count,
         d.total_dispensed_ml,
         d.prescriber,
         v.dea_drug_name,
         v.external_id AS vial_source
       FROM dispenses d
       LEFT JOIN vials v ON v.vial_id = d.vial_id
       WHERE d.patient_id = $1::uuid
         AND d.signature_status = 'signed'
       ORDER BY d.dispense_date DESC NULLS LAST
       LIMIT 5`,
      [patient.patient_id]
    ).catch((err) => {
      console.error('[patientChart] dispenses failed:', err?.message || err);
      degraded.push('local.dispenses');
      return [];
    }),

    healthieClientId
      ? query<{
          sale_id: string;
          sale_date: string | null;
          product_name: string | null;
          quantity: number | null;
          amount_charged: string | number | null;
          status: string | null;
        }>(
          `SELECT
             pd.sale_id,
             pd.sale_date,
             pp.name AS product_name,
             pd.quantity,
             pd.amount_charged,
             pd.status
           FROM peptide_dispenses pd
           LEFT JOIN peptide_products pp ON pp.product_id = pd.product_id
           WHERE pd.healthie_client_id = $1
           ORDER BY pd.sale_date DESC NULLS LAST
           LIMIT 5`,
          [healthieClientId]
        ).catch((err) => {
          console.error('[patientChart] peptide_dispenses failed:', err?.message || err);
          degraded.push('local.peptide_dispenses');
          return [];
        })
      : Promise.resolve([]),

    query<{ icd10_codes: unknown }>(
      `SELECT sn.icd10_codes
         FROM scribe_sessions ss
         JOIN scribe_notes sn ON sn.session_id = ss.session_id
        WHERE (ss.patient_id = $1::text OR ss.patient_id = $2::text)
          AND sn.icd10_codes IS NOT NULL
          AND jsonb_array_length(sn.icd10_codes) > 0
        ORDER BY ss.created_at DESC
        LIMIT 5`,
      [patient.patient_id, healthieClientId ?? '']
    ).catch((err) => {
      console.error('[patientChart] scribe icd10 failed:', err?.message || err);
      degraded.push('local.scribe_notes');
      return [];
    }),

    query<{ accession: string | null; status: string | null; created_at: string | null }>(
      `SELECT accession, status, created_at
         FROM lab_review_queue
        WHERE patient_id = $1::text
           OR healthie_id = $2::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 5`,
      [patient.patient_id, healthieClientId ?? '']
    ).catch((err) => {
      console.error('[patientChart] lab_review_queue failed:', err?.message || err);
      degraded.push('local.lab_review_queue');
      return [];
    }),
  ]);

  // De-dup ICD-10 codes across recent notes, newest first. `icd10_codes` is
  // a JSONB array — historically either of:
  //   ["I10", "E11.9"]               — flat strings (legacy)
  //   [{ "code": "I10", "description": "..." }, ...]  — object form (current)
  // Be defensive and accept both shapes.
  const icdSeen = new Set<string>();
  const recentIcd10FromScribe: string[] = [];
  for (const row of recentScribeIcd10) {
    const arr = Array.isArray(row.icd10_codes) ? row.icd10_codes : [];
    for (const entry of arr) {
      const raw =
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && 'code' in entry
            ? String((entry as { code: unknown }).code ?? '')
            : '';
      const c = raw.trim().toUpperCase();
      if (!c || icdSeen.has(c)) continue;
      icdSeen.add(c);
      recentIcd10FromScribe.push(c);
    }
  }

  const allergies = mergeAllergies(localAllergies, healthieAllergies);

  return {
    patientId: patient.patient_id,
    healthieClientId,
    resolvedFrom,

    demographics: {
      fullName: patient.full_name,
      preferredName: patient.preferred_name,
      dob: patient.dob,
      ageYears: computeAgeYears(patient.dob),
      gender: patient.gender,
      email: patient.email,
      phone: patient.phone_primary,
      address: {
        line1: patient.address_line1,
        line2: patient.address_line2,
        city: patient.city,
        state: patient.state,
        postalCode: patient.postal_code,
        country: patient.country,
      },
      status: { key: patient.status_key, display: patient.status_display },
      clinic: patient.clinic,
      patientType: patient.patient_type,
    },

    problems: {
      confirmed: normalizeDiagnoses(patient.confirmed_diagnoses),
      removed: normalizeDiagnoses(patient.removed_diagnoses),
      recentIcd10FromScribe,
    },

    regimen: {
      summary: patient.regimen,
      medications,
      recentTrtDispenses: trtDispenses.map((d) => ({
        dispenseId: d.dispense_id,
        dispenseDate: d.dispense_date,
        dosePerSyringeMl: d.dose_per_syringe_ml == null ? null : Number(d.dose_per_syringe_ml),
        syringeCount: d.syringe_count,
        totalDispensedMl: d.total_dispensed_ml == null ? null : Number(d.total_dispensed_ml),
        prescriber: d.prescriber,
        drugName: d.dea_drug_name,
        vialSource: d.vial_source,
      })),
      recentPeptideDispenses: peptideDispenses.map((p) => ({
        saleId: p.sale_id,
        saleDate: p.sale_date,
        productName: p.product_name,
        quantity: p.quantity,
        amountCharged: p.amount_charged == null ? null : Number(p.amount_charged),
        status: p.status,
      })),
    },

    allergies,

    labs: {
      lastLabDate: patient.last_lab_date,
      nextLabDate: patient.next_lab_date,
      status: patient.lab_status,
      recentReviewed: recentLabs.map((l) => ({
        accession: l.accession,
        status: l.status,
        createdAt: l.created_at,
      })),
    },

    notes: {
      general: patient.notes,
      interestingFacts: patient.interesting_facts,
    },

    meta: {
      assembledAt,
      healthieAvailable,
      degradedSections: degraded,
    },
  };
}

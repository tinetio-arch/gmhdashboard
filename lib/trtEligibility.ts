/**
 * TRT Last-Pickup & Refill Eligibility — single source of truth.
 *
 * Per docs/sot-modules/25-patient-classification-and-dashboard.md §8.7.
 *
 * USED BY:
 *   - app/api/headless/dispense-eligibility/route.ts  (mobile app banner)
 *   - app/patients/PatientTable.tsx                   (replaces client-side setMonth(+2))
 *   - app/api/inventory/transactions/route.ts         (warning modal in staff dispense flow — future)
 *
 * RULE: server computes; never trust client calculations.
 */

import { query } from '@/lib/db';

export type EligibilityState =
  | 'eligible'        // today >= eligibility_date
  | 'eligible-grace'  // grace_start <= today < eligibility_date (ok to pick up early)
  | 'not-yet'         // today < grace_start (warning fires on dispense)
  | 'first-dispense'  // no prior dispense history
  | 'n/a';            // patient not eligible for TRT (wrong gender, etc.)

export type EligibilityResult = {
  applicable: boolean;
  state: EligibilityState;
  lastDispenseDate: string | null;   // ISO YYYY-MM-DD
  nextEligibleDate: string | null;   // ISO YYYY-MM-DD
  graceStartDate: string | null;     // ISO YYYY-MM-DD (14 days before nextEligible)
  daysUntilEligible: number | null;  // negative if past eligibility
  daysUntilGrace: number | null;     // negative if already in grace window
  syringeCount: number | null;       // from last dispense
  doseMl: number | null;             // from last dispense
  cadenceDays: number;               // from patient.dose_frequency_days or default
  cadenceSource: 'patient' | 'default';
  reason: string;                    // human-readable for logs/tooltips
};

const DEFAULT_CADENCE_DAYS = 3.5;   // twice-weekly (modern TRT standard)
const GRACE_WINDOW_DAYS = 14;        // universal — not configurable per policy §8.7.4

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromMs: number, toMs: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toMs - fromMs) / msPerDay);
}

function normGender(g: string | null | undefined): 'M' | 'F' | null {
  const s = (g || '').trim().toLowerCase();
  if (['m', 'male'].includes(s)) return 'M';
  if (['f', 'female'].includes(s)) return 'F';
  return null;
}

/**
 * Compute refill eligibility from a patient's dispense history.
 *
 * Scope rules:
 *   - Only patients with gender = M are "applicable". Per §3.6.a, TRT is never
 *     dispensed to non-male patients — so females/nulls return state = 'n/a'.
 *   - No prior dispense → first-dispense state (no warning, no banner).
 *   - Otherwise: eligibility = last_dispense_date + (syringe_count × cadence_days).
 *     Grace window opens 14 days before eligibility_date.
 */
export async function computeDispenseEligibility(
  patientId: string,
  today: Date = new Date()
): Promise<EligibilityResult> {
  const [patient] = await query<{
    patient_id: string;
    gender: string | null;
    dose_frequency_days: string | null;
  }>(
    `SELECT patient_id::text AS patient_id, gender, dose_frequency_days::text AS dose_frequency_days
     FROM patients WHERE patient_id = $1::uuid LIMIT 1`,
    [patientId]
  );

  if (!patient) {
    return {
      applicable: false,
      state: 'n/a',
      lastDispenseDate: null,
      nextEligibleDate: null,
      graceStartDate: null,
      daysUntilEligible: null,
      daysUntilGrace: null,
      syringeCount: null,
      doseMl: null,
      cadenceDays: DEFAULT_CADENCE_DAYS,
      cadenceSource: 'default',
      reason: 'patient_not_found'
    };
  }

  const gender = normGender(patient.gender);
  if (gender !== 'M') {
    return {
      applicable: false,
      state: 'n/a',
      lastDispenseDate: null,
      nextEligibleDate: null,
      graceStartDate: null,
      daysUntilEligible: null,
      daysUntilGrace: null,
      syringeCount: null,
      doseMl: null,
      cadenceDays: DEFAULT_CADENCE_DAYS,
      cadenceSource: 'default',
      reason: gender === 'F' ? 'female_not_eligible_for_trt' : 'gender_unset'
    };
  }

  const cadencePatient = patient.dose_frequency_days ? Number(patient.dose_frequency_days) : null;
  const cadenceDays = cadencePatient && cadencePatient > 0 ? cadencePatient : DEFAULT_CADENCE_DAYS;
  const cadenceSource: 'patient' | 'default' = cadencePatient && cadencePatient > 0 ? 'patient' : 'default';

  // Prefer dispenses WITH syringe data. Vial-transfer records (whole vial to
  // patient, no syringe_count recorded) get skipped here — their eligibility
  // signal lives in the most recent prefilled-dose dispense.
  const [lastDispense] = await query<{
    dispense_date: string;
    syringe_count: string | null;
    dose_per_syringe_ml: string | null;
  }>(
    `SELECT dispense_date::text AS dispense_date, syringe_count::text AS syringe_count,
            dose_per_syringe_ml::text AS dose_per_syringe_ml
     FROM dispenses
     WHERE patient_id = $1 AND syringe_count IS NOT NULL AND syringe_count > 0
     ORDER BY dispense_date DESC, created_at DESC NULLS LAST
     LIMIT 1`,
    [patientId]
  );

  if (!lastDispense) {
    return {
      applicable: true,
      state: 'first-dispense',
      lastDispenseDate: null,
      nextEligibleDate: null,
      graceStartDate: null,
      daysUntilEligible: null,
      daysUntilGrace: null,
      syringeCount: null,
      doseMl: null,
      cadenceDays,
      cadenceSource,
      reason: 'no_prior_dispense'
    };
  }

  const syringeCount = lastDispense.syringe_count ? Number(lastDispense.syringe_count) : null;
  const doseMl = lastDispense.dose_per_syringe_ml ? Number(lastDispense.dose_per_syringe_ml) : null;

  if (!syringeCount || syringeCount <= 0) {
    return {
      applicable: true,
      state: 'first-dispense',
      lastDispenseDate: lastDispense.dispense_date.slice(0, 10),
      nextEligibleDate: null,
      graceStartDate: null,
      daysUntilEligible: null,
      daysUntilGrace: null,
      syringeCount: null,
      doseMl,
      cadenceDays,
      cadenceSource,
      reason: 'last_dispense_missing_syringe_count'
    };
  }

  const lastDispenseDate = new Date(lastDispense.dispense_date);
  const daysOfSupply = syringeCount * cadenceDays;
  const eligibilityDate = new Date(lastDispenseDate.getTime() + daysOfSupply * 24 * 60 * 60 * 1000);
  const graceStartDate = new Date(eligibilityDate.getTime() - GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const daysUntilEligible = daysBetween(todayStart, eligibilityDate.getTime());
  const daysUntilGrace = daysBetween(todayStart, graceStartDate.getTime());

  let state: EligibilityState;
  let reason: string;
  if (daysUntilEligible <= 0) {
    state = 'eligible';
    reason = `eligible ${Math.abs(daysUntilEligible)}d past due date`;
  } else if (daysUntilGrace <= 0) {
    state = 'eligible-grace';
    reason = `grace window: eligible in ${daysUntilEligible}d, early pickup ok`;
  } else {
    state = 'not-yet';
    reason = `not yet — grace opens in ${daysUntilGrace}d, eligible in ${daysUntilEligible}d`;
  }

  return {
    applicable: true,
    state,
    lastDispenseDate: isoDate(lastDispenseDate),
    nextEligibleDate: isoDate(eligibilityDate),
    graceStartDate: isoDate(graceStartDate),
    daysUntilEligible,
    daysUntilGrace,
    syringeCount,
    doseMl,
    cadenceDays,
    cadenceSource,
    reason
  };
}

/**
 * Bulk fetch eligibility for every patient in one pass.
 * Returns a Map<patient_id, EligibilityResult>.
 *
 * Used by the /ops/patients page to display per-row eligibility without
 * making N queries. Only applicable patients (gender = M with dispense history
 * or first-dispense eligible) get meaningful values; everyone else is state = 'n/a'.
 */
export async function fetchBulkDispenseEligibility(
  today: Date = new Date()
): Promise<Map<string, EligibilityResult>> {
  // Single CTE: every patient + their most recent dispense (if any)
  const rows = await query<{
    patient_id: string;
    gender: string | null;
    dose_frequency_days: string | null;
    last_dispense_date: string | null;
    last_syringe_count: string | null;
    last_dose_ml: string | null;
  }>(`
    SELECT
      p.patient_id::text AS patient_id,
      p.gender,
      p.dose_frequency_days::text AS dose_frequency_days,
      d.dispense_date::text AS last_dispense_date,
      d.syringe_count::text AS last_syringe_count,
      d.dose_per_syringe_ml::text AS last_dose_ml
    FROM patients p
    LEFT JOIN LATERAL (
      -- Prefer dispenses WITH syringe data; skip vial-transfer records
      -- (whole-vial-to-patient transactions have NULL syringe_count/dose).
      SELECT dispense_date, syringe_count, dose_per_syringe_ml, created_at
      FROM dispenses
      WHERE patient_id = p.patient_id AND syringe_count IS NOT NULL AND syringe_count > 0
      ORDER BY dispense_date DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1
    ) d ON TRUE
  `);

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const map = new Map<string, EligibilityResult>();

  for (const r of rows) {
    const gender = normGender(r.gender);
    if (gender !== 'M') {
      map.set(r.patient_id, {
        applicable: false,
        state: 'n/a',
        lastDispenseDate: null,
        nextEligibleDate: null,
        graceStartDate: null,
        daysUntilEligible: null,
        daysUntilGrace: null,
        syringeCount: null,
        doseMl: null,
        cadenceDays: DEFAULT_CADENCE_DAYS,
        cadenceSource: 'default',
        reason: gender === 'F' ? 'female_not_eligible_for_trt' : 'gender_unset'
      });
      continue;
    }

    const cadencePatient = r.dose_frequency_days ? Number(r.dose_frequency_days) : null;
    const cadenceDays = cadencePatient && cadencePatient > 0 ? cadencePatient : DEFAULT_CADENCE_DAYS;
    const cadenceSource: 'patient' | 'default' = cadencePatient && cadencePatient > 0 ? 'patient' : 'default';

    const syringeCount = r.last_syringe_count ? Number(r.last_syringe_count) : null;
    const doseMl = r.last_dose_ml ? Number(r.last_dose_ml) : null;

    if (!r.last_dispense_date || !syringeCount || syringeCount <= 0) {
      map.set(r.patient_id, {
        applicable: true,
        state: 'first-dispense',
        lastDispenseDate: r.last_dispense_date ? r.last_dispense_date.slice(0, 10) : null,
        nextEligibleDate: null,
        graceStartDate: null,
        daysUntilEligible: null,
        daysUntilGrace: null,
        syringeCount: syringeCount || null,
        doseMl,
        cadenceDays,
        cadenceSource,
        reason: r.last_dispense_date ? 'last_dispense_missing_syringe_count' : 'no_prior_dispense'
      });
      continue;
    }

    const lastDispenseDate = new Date(r.last_dispense_date);
    const daysOfSupply = syringeCount * cadenceDays;
    const eligibilityDate = new Date(lastDispenseDate.getTime() + daysOfSupply * 24 * 60 * 60 * 1000);
    const graceStartDate = new Date(eligibilityDate.getTime() - GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const daysUntilEligible = daysBetween(todayStart, eligibilityDate.getTime());
    const daysUntilGrace = daysBetween(todayStart, graceStartDate.getTime());

    let state: EligibilityState;
    let reason: string;
    if (daysUntilEligible <= 0) {
      state = 'eligible';
      reason = `eligible ${Math.abs(daysUntilEligible)}d past due`;
    } else if (daysUntilGrace <= 0) {
      state = 'eligible-grace';
      reason = `grace window (${daysUntilEligible}d until official)`;
    } else {
      state = 'not-yet';
      reason = `not yet — grace in ${daysUntilGrace}d`;
    }

    map.set(r.patient_id, {
      applicable: true,
      state,
      lastDispenseDate: isoDate(lastDispenseDate),
      nextEligibleDate: isoDate(eligibilityDate),
      graceStartDate: isoDate(graceStartDate),
      daysUntilEligible,
      daysUntilGrace,
      syringeCount,
      doseMl,
      cadenceDays,
      cadenceSource,
      reason
    });
  }

  return map;
}

/** Convert the bulk map to a plain object (serializable for client props). */
export async function fetchBulkDispenseEligibilityAsObject(): Promise<Record<string, EligibilityResult>> {
  const map = await fetchBulkDispenseEligibility();
  return Object.fromEntries(map);
}

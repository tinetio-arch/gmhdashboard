/**
 * patientStack — unified per-patient dosing/Stack engine.
 *
 * Two item types share one stack:
 *   - 'testosterone' — due math REUSES computeDispenseEligibility from
 *     lib/trtEligibility. The engine reads dispenses.syringe_count ×
 *     patients.dose_frequency_days (default 3.5d) to compute
 *     lastDispenseDate / nextEligibleDate / cadenceDays / syringeCount / doseMl.
 *     vial_size_ml on the stack row is display metadata only — the engine
 *     already does syringe-count depletion.
 *
 *   - 'peptide' — due math is local: amount_remaining = vial_size_ml − sum
 *     of logged injections (peptide_injection_log). next_due fires when
 *     amount_remaining < ~1 week of doses (7 / cadence_days × dose).
 *
 * Consumers: GET /api/patients/[id]/stack, the patient mobile app, iPad.
 */

import { query } from './db';
import { computeDispenseEligibility, type EligibilityResult } from './trtEligibility';

/**
 * Canonical FDA disclaimer shown on the patient Stack screen.
 *
 * SINGLE source of truth — every consumer (GET /api/patients/[id]/stack,
 * the patient mobile app, the iPad Stack overview, the FDA-ack flow that
 * stamps patient_peptide_stack.fda_ack_at) renders this exact text. Edit
 * here, ship once, and the wording updates everywhere. Do NOT duplicate
 * this string anywhere else — import this constant instead.
 *
 * Approved verbatim by Phil on 2026-05-27.
 */
export const STACK_FDA_DISCLAIMER =
  "Most peptides shown here have not been evaluated or approved by the FDA " +
  "for these uses. The dose displayed is your provider's individualized " +
  "recommendation as part of a wellness program — it is not a substitute " +
  "for professional medical advice. Use only as directed, do not adjust your " +
  "dose without consulting your provider, and stop use and contact the office " +
  "if you experience any adverse reaction.";

export type StackItemType = 'peptide' | 'testosterone';
export type StackStatus = 'active' | 'pending' | 'paused' | 'discontinued';
export type ReminderMethod = 'push' | 'sms' | 'email';

export interface StackRow {
  stack_id: string;
  patient_id: string;
  healthie_id: string | null;
  item_type: StackItemType;
  product_ref: string | null;
  product_sku: string;
  display_name: string;
  recommended_dose: number | null;
  dose_unit: string | null;
  frequency_code: string | null;
  inject_days: string[] | null;
  cadence_days: number | null;
  anchor_date: string | null;
  status: StackStatus;
  vial_size_ml: number;
  syringes_dispensed: number;
  amount_remaining: number | null;
  next_due_date: string | null;
  reminder_enabled: boolean;
  reminder_time: string | null;
  reminder_method: ReminderMethod;
  recommended_by: string | null;
  recommended_at: string | null;
  dose_history: DoseHistoryEntry[];
  source_order_id: string | null;
  fda_ack_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DoseHistoryEntry {
  at: string;            // ISO timestamp
  by: string | null;     // user_id
  by_name: string | null;
  action: 'set' | 'adjust' | 'pause' | 'resume' | 'discontinue' | 'reminder_update' | 'schedule_update';
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  note: string | null;
}

/**
 * Computed view of a stack item. Adds derived supply/due fields without
 * touching the stored row — safe to call on every read.
 */
export interface StackItemComputed extends StackRow {
  computed: {
    // Common
    item_type: StackItemType;
    next_due_date: string | null;
    days_until_due: number | null;       // negative if past due
    reorder_needed: boolean;             // remaining < ~1 week of doses

    // Peptide-only
    amount_remaining: number | null;     // vial_size_ml − Σ logged
    amount_unit: string | null;          // mirrors dose_unit (mg/mcg/mL/iu)
    injections_logged: number | null;
    last_injection_at: string | null;
    doses_remaining_estimate: number | null;

    // Testosterone-only — full eligibility envelope from the existing engine
    trt_eligibility: EligibilityResult | null;
  };
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapRow(r: any): StackRow {
  return {
    stack_id: r.stack_id,
    patient_id: r.patient_id,
    healthie_id: r.healthie_id,
    item_type: r.item_type,
    product_ref: r.product_ref,
    product_sku: r.product_sku,
    display_name: r.display_name,
    recommended_dose: r.recommended_dose !== null ? Number(r.recommended_dose) : null,
    dose_unit: r.dose_unit,
    frequency_code: r.frequency_code,
    inject_days: r.inject_days,
    cadence_days: r.cadence_days !== null ? Number(r.cadence_days) : null,
    anchor_date: r.anchor_date,
    status: r.status,
    vial_size_ml: Number(r.vial_size_ml),
    syringes_dispensed: Number(r.syringes_dispensed),
    amount_remaining: r.amount_remaining !== null ? Number(r.amount_remaining) : null,
    next_due_date: r.next_due_date,
    reminder_enabled: r.reminder_enabled,
    reminder_time: r.reminder_time,
    reminder_method: r.reminder_method,
    recommended_by: r.recommended_by,
    recommended_at: r.recommended_at,
    dose_history: Array.isArray(r.dose_history) ? r.dose_history : [],
    source_order_id: r.source_order_id,
    fda_ack_at: r.fda_ack_at,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

// ---------------------------------------------------------------------------
// TRT path — reuse computeDispenseEligibility
// ---------------------------------------------------------------------------

async function computeTrtItem(row: StackRow): Promise<StackItemComputed> {
  // The single source of truth for TRT refill timing. Handles:
  //   - cadence (patient.dose_frequency_days || 3.5)
  //   - syringe-count depletion (syringeCount × cadenceDays days of supply)
  //   - 14-day grace window
  //   - gender applicability gate
  const eligibility = await computeDispenseEligibility(row.patient_id);

  const today = new Date();
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let daysUntilDue: number | null = null;
  if (eligibility.nextEligibleDate) {
    const dueMs = new Date(eligibility.nextEligibleDate).getTime();
    daysUntilDue = Math.floor((dueMs - todayMs) / (24 * 60 * 60 * 1000));
  }

  // Reorder warning fires whenever we're within (or past) the 14-day grace.
  const reorderNeeded =
    eligibility.state === 'eligible' ||
    eligibility.state === 'eligible-grace' ||
    (daysUntilDue !== null && daysUntilDue <= 7);

  return {
    ...row,
    computed: {
      item_type: 'testosterone',
      next_due_date: eligibility.nextEligibleDate,
      days_until_due: daysUntilDue,
      reorder_needed: reorderNeeded,
      amount_remaining: null,
      amount_unit: null,
      injections_logged: null,
      last_injection_at: null,
      doses_remaining_estimate: eligibility.syringeCount,
      trt_eligibility: eligibility
    }
  };
}

// ---------------------------------------------------------------------------
// Peptide path — local supply math from peptide_injection_log
// ---------------------------------------------------------------------------

async function computePeptideItem(row: StackRow): Promise<StackItemComputed> {
  const [agg] = await query<{
    total_dose: string | null;
    n: string;
    last_at: string | null;
  }>(
    `SELECT
        COALESCE(SUM(dose_amount), 0)::text AS total_dose,
        COUNT(*)::text AS n,
        MAX(injected_at)::text AS last_at
       FROM peptide_injection_log
      WHERE stack_id = $1`,
    [row.stack_id]
  );

  const totalLogged = agg && agg.total_dose ? Number(agg.total_dose) : 0;
  const n = agg ? Number(agg.n) : 0;

  // amount_remaining = vial_size_ml − Σ(dose × injections).
  // NOTE: vial_size_ml is mL; dose may be mg/mcg/mL/iu. When dose_unit !== 'mL'
  // the subtraction is "doses worth of supply" rather than literal mL — this
  // mirrors how the existing peptide_dispenses pipeline counts vials, not mL.
  // For the spec's "amount_remaining = vial_size − (injections × dose)" we
  // treat both as in the same unit on the stack row; UI surfaces dose_unit so
  // the patient sees mg/mcg as written.
  const amountRemaining = Math.max(0, row.vial_size_ml - totalLogged);

  // Doses-remaining estimate (only when we have a per-injection dose).
  let dosesRemaining: number | null = null;
  if (row.recommended_dose && row.recommended_dose > 0) {
    dosesRemaining = Math.floor(amountRemaining / row.recommended_dose);
  }

  // Next due = anchor + (n+1)*cadence (rolled forward to today if missed).
  let nextDueDate: string | null = null;
  let daysUntilDue: number | null = null;
  if (row.cadence_days && row.cadence_days > 0) {
    const anchor = row.anchor_date ? new Date(row.anchor_date) : new Date(row.created_at);
    const cadMs = row.cadence_days * 24 * 60 * 60 * 1000;
    const nextMs = anchor.getTime() + (n + 1) * cadMs;
    nextDueDate = new Date(nextMs).toISOString().slice(0, 10);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    daysUntilDue = Math.floor((nextMs - todayStart) / (24 * 60 * 60 * 1000));
  }

  // Reorder when < ~1 week of doses remains. Without cadence/dose, fall back
  // to "amount_remaining < 1/4 vial" as a sensible warning floor.
  let reorderNeeded = false;
  if (dosesRemaining !== null && row.cadence_days && row.cadence_days > 0) {
    const dosesPerWeek = 7 / row.cadence_days;
    reorderNeeded = dosesRemaining < dosesPerWeek;
  } else {
    reorderNeeded = amountRemaining < row.vial_size_ml * 0.25;
  }

  return {
    ...row,
    computed: {
      item_type: 'peptide',
      next_due_date: nextDueDate,
      days_until_due: daysUntilDue,
      reorder_needed: reorderNeeded,
      amount_remaining: amountRemaining,
      amount_unit: row.dose_unit,
      injections_logged: n,
      last_injection_at: agg?.last_at ?? null,
      doses_remaining_estimate: dosesRemaining,
      trt_eligibility: null
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Compute one item's supply/due fields. Dispatches by item_type. */
export async function computeStackItem(row: StackRow): Promise<StackItemComputed> {
  return row.item_type === 'testosterone'
    ? computeTrtItem(row)
    : computePeptideItem(row);
}

/** Fetch + compute every stack row for a patient. */
export async function fetchPatientStack(patientId: string): Promise<StackItemComputed[]> {
  const rows = await query<any>(
    `SELECT * FROM patient_peptide_stack
      WHERE patient_id = $1
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        item_type,
        display_name`,
    [patientId]
  );
  const mapped = rows.map(mapRow);
  return Promise.all(mapped.map(computeStackItem));
}

/** Fetch + compute a single stack row by id. Returns null if not found. */
export async function fetchStackItem(stackId: string): Promise<StackItemComputed | null> {
  const [row] = await query<any>(
    `SELECT * FROM patient_peptide_stack WHERE stack_id = $1 LIMIT 1`,
    [stackId]
  );
  if (!row) return null;
  return computeStackItem(mapRow(row));
}

/** Append-only push to dose_history. Caller passes the prev/next snapshot. */
export function buildHistoryEntry(input: {
  action: DoseHistoryEntry['action'];
  by: string | null;
  by_name: string | null;
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  note?: string | null;
}): DoseHistoryEntry {
  return {
    at: new Date().toISOString(),
    by: input.by,
    by_name: input.by_name,
    action: input.action,
    prev: input.prev,
    next: input.next,
    note: input.note ?? null
  };
}

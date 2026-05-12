/**
 * Patient onboarding/engagement signals.
 *
 * Per docs/sot-modules/25-patient-classification-and-dashboard.md §5.
 *
 * Phase 5a: 4 signals computable entirely from local DB (no Healthie calls):
 *   - 📱 App (first_app_login)
 *   - 🔬 Labs (existing computeLabStatus)
 *   - 📅 Last Visit (scribe_sessions)
 *   - ✍️ Consents (pending_peptide_consents; future: patient_consents)
 *
 * The 📋 Intake signal requires Healthie formAnswerGroups and will be added in Phase 5b
 * via a nightly cache refresh.
 */

import { query } from '@/lib/db';

export type SignalState = 'good' | 'warn' | 'bad' | 'na' | 'none';

export type AppSignal = {
  state: SignalState;
  firstLogin: string | null;
  label: string;
};

export type LabsSignal = {
  state: SignalState;
  label: string;
};

export type LastVisitSignal = {
  state: SignalState;
  daysAgo: number | null;
  lastVisit: string | null;
  label: string;
};

export type ConsentsSignal = {
  state: SignalState;
  pendingCount: number;
  signedCount: number;
  label: string;
};

export type IntakeSignal = {
  state: SignalState;
  label: string;
  finished: number | null;
  total: number | null;
  staleHours: number | null;  // how old the cached value is
};

export type PatientSignals = {
  patient_id: string;
  app: AppSignal;
  labs: LabsSignal;
  lastVisit: LastVisitSignal;
  consents: ConsentsSignal;
  intake: IntakeSignal;
};

type Row = {
  patient_id: string;
  patient_type: string | null;
  first_app_login: string | null;
  last_lab_date: string | null;
  next_lab_date: string | null;
  last_scribe_at: string | null;
  consents_signed: string;
  consents_pending: string;
  intake_state: string | null;
  intake_finished: string | null;
  intake_total: string | null;
  intake_fetched_at: string | null;
};

function computeApp(r: Row): AppSignal {
  // App login is expected for Member + Intermittent patients. Visit patients = N/A.
  const type = (r.patient_type || '').toLowerCase();
  const expected = type === 'member' || type === 'intermittent';

  if (r.first_app_login) {
    return { state: 'good', firstLogin: r.first_app_login, label: 'Logged into app' };
  }
  if (!expected) {
    return { state: 'na', firstLogin: null, label: 'Not required for Visit patients' };
  }
  return { state: 'bad', firstLogin: null, label: 'Not yet logged into mobile app' };
}

function computeLabs(r: Row): LabsSignal {
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const parseD = (v: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const next = parseD(r.next_lab_date);
  if (next) {
    const daysUntil = Math.floor((next.getTime() - todayStart.getTime()) / msPerDay);
    if (daysUntil < 0) return { state: 'bad', label: `Labs overdue by ${Math.abs(daysUntil)}d` };
    if (daysUntil <= 30) return { state: 'warn', label: `Labs due in ${daysUntil}d` };
    return { state: 'good', label: `Labs current (next in ${daysUntil}d)` };
  }
  const last = parseD(r.last_lab_date);
  if (last) {
    const daysSince = Math.floor((todayStart.getTime() - last.getTime()) / msPerDay);
    if (daysSince > 180) return { state: 'bad', label: `Last lab ${daysSince}d ago (overdue)` };
    return { state: 'good', label: `Last lab ${daysSince}d ago` };
  }
  return { state: 'none', label: 'No lab data' };
}

function computeLastVisit(r: Row): LastVisitSignal {
  if (!r.last_scribe_at) {
    return { state: 'none', daysAgo: null, lastVisit: null, label: 'No scribe visits recorded' };
  }
  const d = new Date(r.last_scribe_at);
  if (Number.isNaN(d.getTime())) {
    return { state: 'none', daysAgo: null, lastVisit: null, label: 'No scribe visits recorded' };
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysAgo = Math.floor((Date.now() - d.getTime()) / msPerDay);
  const iso = d.toISOString().slice(0, 10);
  if (daysAgo <= 90) return { state: 'good', daysAgo, lastVisit: iso, label: `Seen ${daysAgo}d ago` };
  if (daysAgo <= 180) return { state: 'warn', daysAgo, lastVisit: iso, label: `Seen ${daysAgo}d ago (stale)` };
  return { state: 'bad', daysAgo, lastVisit: iso, label: `Seen ${daysAgo}d ago (very stale)` };
}

function computeIntake(r: Row): IntakeSignal {
  // Phase 5b: reads from patient_signals_cache (populated by nightly
  // refresh-intake-signals cron). If no cache row, shows 'none' (gray).
  if (!r.intake_state) {
    return { state: 'none', label: 'Intake: (not yet cached)', finished: null, total: null, staleHours: null };
  }
  const finished = r.intake_finished ? Number(r.intake_finished) : null;
  const total = r.intake_total ? Number(r.intake_total) : null;
  const fetchedAt = r.intake_fetched_at ? new Date(r.intake_fetched_at) : null;
  const staleHours = fetchedAt ? Math.floor((Date.now() - fetchedAt.getTime()) / (60 * 60 * 1000)) : null;
  const state = (r.intake_state as SignalState);
  let label: string;
  if (state === 'good') label = `Intake complete${finished && total ? ` (${finished}/${total} forms)` : ''}`;
  else if (state === 'warn') label = `Intake in progress${finished && total ? ` (${finished}/${total} forms)` : ''}`;
  else if (state === 'bad') label = 'Intake not started';
  else label = 'Intake: no data';
  return { state, label, finished, total, staleHours };
}

function computeConsents(r: Row): ConsentsSignal {
  const signed = parseInt(r.consents_signed || '0', 10);
  const pending = parseInt(r.consents_pending || '0', 10);
  if (pending > 0) {
    return { state: 'warn', pendingCount: pending, signedCount: signed, label: `${pending} consent(s) pending signature` };
  }
  if (signed > 0) {
    return { state: 'good', pendingCount: 0, signedCount: signed, label: `${signed} consent(s) signed` };
  }
  return { state: 'none', pendingCount: 0, signedCount: 0, label: 'No consents recorded' };
}

/**
 * Bulk fetch signals for every patient in one DB round-trip.
 * Returns a Map<patient_id, PatientSignals>.
 */
export async function fetchBulkPatientSignals(): Promise<Map<string, PatientSignals>> {
  const rows = await query<Row>(`
    SELECT
      p.patient_id::text AS patient_id,
      p.patient_type,
      p.first_app_login::text AS first_app_login,
      p.last_lab_date::text AS last_lab_date,
      p.next_lab_date::text AS next_lab_date,
      (SELECT MAX(created_at)::text FROM scribe_sessions s WHERE s.patient_id = p.patient_id::text) AS last_scribe_at,
      (SELECT COUNT(*)::text FROM pending_peptide_consents c
         WHERE c.patient_id = p.patient_id AND c.status = 'signed') AS consents_signed,
      (SELECT COUNT(*)::text FROM pending_peptide_consents c
         WHERE c.patient_id = p.patient_id AND c.status = 'pending') AS consents_pending,
      psc.intake_state,
      psc.intake_forms_finished::text AS intake_finished,
      psc.intake_forms_total::text AS intake_total,
      psc.intake_fetched_at::text AS intake_fetched_at
    FROM patients p
    LEFT JOIN patient_signals_cache psc ON psc.patient_id = p.patient_id
  `);

  const map = new Map<string, PatientSignals>();
  for (const r of rows) {
    map.set(r.patient_id, {
      patient_id: r.patient_id,
      app: computeApp(r),
      labs: computeLabs(r),
      lastVisit: computeLastVisit(r),
      consents: computeConsents(r),
      intake: computeIntake(r)
    });
  }
  return map;
}

export async function fetchBulkPatientSignalsAsObject(): Promise<Record<string, PatientSignals>> {
  const map = await fetchBulkPatientSignals();
  return Object.fromEntries(map);
}

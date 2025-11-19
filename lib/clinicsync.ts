import type { PoolClient } from 'pg';
import { getPool, query } from './db';

type ClinicSyncPayload = Record<string, any>;

type ClinicSyncUpsertOptions = {
  source?: 'webhook' | 'sync' | string;
  skipWebhookLog?: boolean;
};

type SanitizedMembership = {
  clinicsyncPatientId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  dob: string | null;
  balanceOwing: number;
  amountDue: number;
  memberSince: string | null;
  contractEndDate: string | null;
  nextPaymentDue: string | null;
  lastPaymentAt: string | null;
  membershipPlan: string | null;
  membershipStatus: string | null;
  membershipTier: string | null;
  discharged: boolean;
  rawPayload: ClinicSyncPayload;
  eventType: string;
};

type PatientMatch = {
  patientId: string;
  matchMethod: 'id' | 'email' | 'phone' | 'name' | 'manual';
  confidence: number;
};

const PAYMENT_HOLD_THRESHOLD = Number(process.env.CLINICSYNC_PAYMENT_THRESHOLD ?? 1);

export async function upsertClinicSyncPatient(
  payload: ClinicSyncPayload,
  options?: ClinicSyncUpsertOptions
): Promise<{ patientId: string | null; matchMethod?: string }> {
  const sanitized = normalizePayload(payload, options?.source);
  if (!sanitized.clinicsyncPatientId) {
    throw new Error('ClinicSync payload missing patient identifier.');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!options?.skipWebhookLog) {
      await client.query(
        `INSERT INTO clinicsync_webhook_events (event_type, clinicsync_patient_id, payload)
         VALUES ($1, $2, $3)`,
        [sanitized.eventType, sanitized.clinicsyncPatientId, JSON.stringify(payload)]
      );
    }

    const match = await resolvePatientMatch(client, sanitized);

    if (match && match.matchMethod !== 'id') {
      await ensureMapping(client, match.patientId, sanitized.clinicsyncPatientId, match.matchMethod, match.confidence);
    }

    await upsertClinicSyncMembership(client, sanitized, match?.patientId ?? null);

    if (match?.patientId) {
      await upsertMembershipSummary(client, match.patientId, sanitized);
      await applyMembershipImpact(client, match.patientId, sanitized);
    }

    await client.query('COMMIT');
    return { patientId: match?.patientId ?? null, matchMethod: match?.matchMethod };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reprocessClinicSyncMemberships(): Promise<void> {
  const rows = await query<{
    clinicsync_patient_id: string;
    patient_id: string | null;
    membership_plan: string | null;
    membership_status: string | null;
    membership_tier: string | null;
    balance_owing: string | null;
    amount_due: string | null;
    last_payment_at: string | null;
    next_payment_due: string | null;
    service_start_date: string | null;
    contract_end_date: string | null;
    raw_payload: any;
  }>(`SELECT * FROM clinicsync_memberships`);

  for (const row of rows) {
    const sanitized: SanitizedMembership = {
      clinicsyncPatientId: row.clinicsync_patient_id,
      fullName: row.raw_payload?.name ?? row.raw_payload?.patient_name ?? null,
      email: row.raw_payload?.email ?? null,
      phone: row.raw_payload?.mobile_phone ?? null,
      altPhone: row.raw_payload?.home_phone ?? null,
      dob: row.raw_payload?.dob ?? null,
      balanceOwing: toNumber(row.balance_owing),
      amountDue: toNumber(row.amount_due),
      memberSince: normalizeDate(row.service_start_date),
      contractEndDate: normalizeDate(row.contract_end_date),
      nextPaymentDue: normalizeDate(row.next_payment_due),
      lastPaymentAt: normalizeDate(row.last_payment_at),
      membershipPlan: row.membership_plan,
      membershipStatus: row.membership_status,
      membershipTier: row.membership_tier,
      discharged: Boolean(row.raw_payload?.discharged),
      rawPayload: row.raw_payload ?? {},
      eventType: 'sync.reprocess'
    };

    if (!row.patient_id) {
      continue;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await upsertMembershipSummary(client, row.patient_id, sanitized);
      await applyMembershipImpact(client, row.patient_id, sanitized);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('ClinicSync reprocess error:', error);
    } finally {
      client.release();
    }
  }
}

function normalizePayload(payload: ClinicSyncPayload, source?: string): SanitizedMembership {
  const clinicsyncPatientId =
    stringValue(payload.patient_number) ||
    stringValue(payload.id) ||
    stringValue(payload.patient_id) ||
    '';

  const membershipStatus =
    stringValue(payload.membership_status) ||
    stringValue(payload.status) ||
    (payload.discharged ? 'discharged' : 'active');

  const balanceOwing =
    toNumber(payload.amount_owing) ||
    toNumber(payload.balance) ||
    toNumber(payload.total_remaining_balance);

  const amountDue =
    toNumber(payload.amount_due) ||
    toNumber(payload.total_payment_amount) ||
    balanceOwing;

  return {
    clinicsyncPatientId,
    fullName: stringValue(
      payload.name ||
        payload.patient_name ||
        [payload.first_name ?? payload.preferred_first_name, payload.last_name].filter(Boolean).join(' ')
    ),
    email: stringValue(payload.email),
    phone: stringValue(payload.mobile_phone || payload.home_phone || payload.work_phone),
    altPhone: stringValue(payload.work_phone || payload.home_phone),
    dob: normalizeDate(payload.dob),
    balanceOwing,
    amountDue,
    memberSince: normalizeDate(payload.member_since),
    contractEndDate:
      normalizeDate(
        payload.contract_end ??
          payload.contract_end_date ??
          payload.membership_contract_end ??
          payload.membership_end ??
          payload.membership_end_date ??
          payload?.membership?.contract_end_date ??
          payload?.membership?.membership_end ??
          payload?.membership?.end_at
      ) || null,
    nextPaymentDue: normalizeDate(payload.next_payment_due ?? payload.next_payment_due_date),
    lastPaymentAt: normalizeDate(
      payload.last_payment_date ?? payload.last_payment_reminder ?? payload.last_payment_at
    ),
    membershipPlan:
      stringValue(payload.membership_plan) ||
      stringValue(payload.program_name) ||
      stringValue(payload.treatment_name),
    membershipStatus,
    membershipTier: stringValue(payload.membership_tier || payload.patient_type),
    discharged: Boolean(payload.discharged),
    rawPayload: payload,
    eventType: source ? `clinicsync.${source}` : 'clinicsync.webhook'
  };
}

async function resolvePatientMatch(
  client: PoolClient,
  membership: SanitizedMembership
): Promise<PatientMatch | null> {
  if (!membership.clinicsyncPatientId) {
    return null;
  }

  const byId = await client.query<{ patient_id: string }>(
    `SELECT patient_id FROM patient_clinicsync_mapping WHERE clinicsync_patient_id = $1`,
    [membership.clinicsyncPatientId]
  );
  if ((byId.rowCount ?? 0) > 0) {
    return { patientId: byId.rows[0].patient_id, matchMethod: 'id', confidence: 1 };
  }

  if (membership.email) {
    const emailMatch = await client.query<{ patient_id: string }>(
      `SELECT patient_id
         FROM patients
        WHERE LOWER(email) = LOWER($1)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [membership.email]
    );
    if ((emailMatch.rowCount ?? 0) > 0) {
      return { patientId: emailMatch.rows[0].patient_id, matchMethod: 'email', confidence: 0.95 };
    }
  }

  const normalizedPhone = normalizePhone(membership.phone) || normalizePhone(membership.altPhone);
  if (normalizedPhone) {
    const phoneMatch = await client.query<{ patient_id: string }>(
      `SELECT patient_id
         FROM patients
        WHERE regexp_replace(COALESCE(phone_primary, ''), '\\D', '', 'g') = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [normalizedPhone]
    );
    if ((phoneMatch.rowCount ?? 0) > 0) {
      return { patientId: phoneMatch.rows[0].patient_id, matchMethod: 'phone', confidence: 0.9 };
    }
  }

  if (membership.fullName && membership.dob) {
    const nameDobMatch = await client.query<{ patient_id: string }>(
      `SELECT patient_id
         FROM patients
        WHERE LOWER(full_name) = LOWER($1)
          AND dob = $2
        LIMIT 1`,
      [membership.fullName, membership.dob]
    );
    if ((nameDobMatch.rowCount ?? 0) > 0) {
      return { patientId: nameDobMatch.rows[0].patient_id, matchMethod: 'name', confidence: 0.85 };
    }
  }

  return null;
}

async function ensureMapping(
  client: PoolClient,
  patientId: string,
  clinicsyncPatientId: string,
  method: PatientMatch['matchMethod'],
  confidence: number
) {
  await client.query(
    `INSERT INTO patient_clinicsync_mapping (patient_id, clinicsync_patient_id, match_method, match_confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clinicsync_patient_id) DO UPDATE SET
       patient_id = EXCLUDED.patient_id,
       match_method = EXCLUDED.match_method,
       match_confidence = EXCLUDED.match_confidence,
       updated_at = NOW()`,
    [patientId, clinicsyncPatientId, method, confidence]
  );
}

async function upsertClinicSyncMembership(
  client: PoolClient,
  membership: SanitizedMembership,
  patientId: string | null
) {
  await client.query(
    `INSERT INTO clinicsync_memberships (
        clinicsync_patient_id,
        patient_id,
        membership_plan,
        membership_status,
        membership_tier,
        balance_owing,
        amount_due,
        last_payment_at,
        next_payment_due,
        service_start_date,
        contract_end_date,
        is_active,
        raw_payload
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
     )
     ON CONFLICT (clinicsync_patient_id) DO UPDATE SET
        patient_id = COALESCE(EXCLUDED.patient_id, clinicsync_memberships.patient_id),
        membership_plan = EXCLUDED.membership_plan,
        membership_status = EXCLUDED.membership_status,
        membership_tier = EXCLUDED.membership_tier,
        balance_owing = EXCLUDED.balance_owing,
        amount_due = EXCLUDED.amount_due,
        last_payment_at = EXCLUDED.last_payment_at,
        next_payment_due = EXCLUDED.next_payment_due,
        service_start_date = EXCLUDED.service_start_date,
        contract_end_date = EXCLUDED.contract_end_date,
        is_active = EXCLUDED.is_active,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()`,
    [
      membership.clinicsyncPatientId,
      patientId,
      membership.membershipPlan,
      membership.membershipStatus,
      membership.membershipTier,
      membership.balanceOwing || null,
      membership.amountDue || null,
      membership.lastPaymentAt,
      membership.nextPaymentDue,
      membership.memberSince,
      membership.contractEndDate,
      !membership.discharged,
      JSON.stringify(membership.rawPayload)
    ]
  );
}

async function upsertMembershipSummary(
  client: PoolClient,
  patientId: string,
  membership: SanitizedMembership
) {
  await client.query(
    `INSERT INTO memberships (
        patient_id,
        program_name,
        status,
        fee_amount,
        balance_owed,
        next_charge_date,
        last_charge_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (patient_id) DO UPDATE SET
        program_name = COALESCE(EXCLUDED.program_name, memberships.program_name),
        status = COALESCE(EXCLUDED.status, memberships.status),
        balance_owed = COALESCE(EXCLUDED.balance_owed, memberships.balance_owed),
        next_charge_date = COALESCE(EXCLUDED.next_charge_date, memberships.next_charge_date),
        last_charge_date = COALESCE(EXCLUDED.last_charge_date, memberships.last_charge_date),
        fee_amount = COALESCE(EXCLUDED.fee_amount, memberships.fee_amount),
        updated_at = NOW()`,
    [
      patientId,
      membership.membershipPlan,
      membership.membershipStatus,
      null,
      membership.balanceOwing || membership.amountDue || null,
      membership.nextPaymentDue,
      membership.lastPaymentAt
    ]
  );
}

async function applyMembershipImpact(
  client: PoolClient,
  patientId: string,
  membership: SanitizedMembership
) {
  await client.query(
    `UPDATE patients
        SET service_start_date = COALESCE($2, service_start_date),
            contract_end_date = COALESCE($3, contract_end_date),
            membership_owes = $4,
            updated_at = NOW()
      WHERE patient_id = $1`,
    [patientId, membership.memberSince, membership.contractEndDate, membership.balanceOwing || null]
  );

  const holdType = determineHoldType(membership);
  if (!holdType) {
    return;
  }

  const patientStatusResult = await client.query<{ status_key: string | null }>(
    `SELECT status_key FROM patients WHERE patient_id = $1`,
    [patientId]
  );
  const currentStatus = patientStatusResult.rows[0]?.status_key ?? null;

  const targetStatus = holdType === 'payment' ? 'hold_payment_research' : 'hold_contract_renewal';
  const issueType = holdType === 'payment' ? 'membership_delinquent' : 'contract_expired';
  const daysOverdue =
    holdType === 'contract' && membership.contractEndDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(membership.contractEndDate).getTime()) / (1000 * 60 * 60 * 24)
          )
        )
      : null;

  await upsertPaymentIssue(
    client,
    patientId,
    issueType,
    targetStatus,
    membership.balanceOwing || membership.amountDue || null,
    daysOverdue,
    currentStatus
  );

  if (currentStatus !== targetStatus) {
    await client.query(
      `UPDATE patients
          SET status_key = $2,
              alert_status = (
                SELECT display_name FROM patient_status_lookup WHERE status_key = $2
              ),
              updated_at = NOW()
        WHERE patient_id = $1`,
      [patientId, targetStatus]
    );
  }
}

async function upsertPaymentIssue(
  client: PoolClient,
  patientId: string,
  issueType: string,
  targetStatus: string,
  amountOwed: number | null,
  daysOverdue: number | null,
  previousStatus: string | null
) {
  const existing = await client.query<{ issue_id: string }>(
    `SELECT issue_id
       FROM payment_issues
      WHERE patient_id = $1
        AND issue_type = $2
        AND resolved_at IS NULL
      LIMIT 1`,
    [patientId, issueType]
  );

  if ((existing.rowCount ?? 0) > 0) {
    await client.query(
      `UPDATE payment_issues
          SET amount_owed = $2,
              days_overdue = $3,
              updated_at = NOW()
        WHERE issue_id = $1`,
      [existing.rows[0].issue_id, amountOwed, daysOverdue]
    );
    return;
  }

  await client.query(
    `INSERT INTO payment_issues (
        patient_id,
        issue_type,
        issue_severity,
        amount_owed,
        days_overdue,
        previous_status_key,
        status_changed_to,
        auto_updated
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
    [
      patientId,
      issueType,
      issueType === 'membership_delinquent' ? 'critical' : 'warning',
      amountOwed,
      daysOverdue,
      previousStatus,
      targetStatus
    ]
  );
}

function determineHoldType(membership: SanitizedMembership): 'payment' | 'contract' | null {
  const statusToken = membership.membershipStatus?.toLowerCase() ?? '';
  const paymentDelinquent =
    membership.balanceOwing > PAYMENT_HOLD_THRESHOLD ||
    ['delinquent', 'past_due', 'payment_issue'].includes(statusToken);

  if (paymentDelinquent) {
    return 'payment';
  }

  const contractExpired =
    membership.contractEndDate !== null &&
    new Date(membership.contractEndDate).getTime() < Date.now();
  const contractStatus = ['expired', 'cancelled', 'discharged'].includes(statusToken);

  if (contractExpired || contractStatus || membership.discharged) {
    return 'contract';
  }

  return null;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString().split('T')[0];
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString().split('T')[0];
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) {
      return 0;
    }
    const parsed = Number.parseFloat(cleaned);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}



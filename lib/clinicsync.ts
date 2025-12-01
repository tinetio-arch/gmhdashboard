import type { PoolClient } from 'pg';
import { getPool, query } from './db';
import { PASS_CONFIG, KNOWN_PASS_IDS } from './passConfig';

const CLINICSYNC_DEBUG = process.env.CLINICSYNC_DEBUG === 'true';
const clinicDebugLog = (...args: unknown[]): void => {
  if (CLINICSYNC_DEBUG) {
    console.log(...args);
  }
};

type ClinicSyncPayload = Record<string, any>;

type ClinicSyncUpsertOptions = {
  source?: 'webhook' | 'sync' | string;
  skipWebhookLog?: boolean;
  skipMembershipFilter?: boolean; // Allow bypassing membership filter for manual syncs
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
  pass_id?: number;
};

type PatientMatch = {
  patientId: string;
  matchMethod: 'id' | 'email' | 'phone' | 'name' | 'name+dob' | 'manual';
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

  // Check if this patient has a membership (even if not explicitly in membership_plan field)
  // A patient has a membership if:
  // 1. membership_plan is set, OR
  // 2. payload.memberships array exists and has items, OR
  // 3. payload.membership object exists, OR
  // 4. passes array exists and contains membership/package data (passes can represent memberships/packages)
  const hasMembership = !!(
    sanitized.membershipPlan ||
    (Array.isArray(payload.memberships) && payload.memberships.length > 0) ||
    payload.membership ||
    (Array.isArray(payload.passes) && payload.passes.length > 0 && 
     payload.passes.some((pass: any) => 
       pass?.name || pass?.package_name || pass?.membership_name || pass?.plan_name || pass?.program_name
     ))
  );

  // If no membership data detected, check if we should skip processing
  if (!hasMembership) {
    // For webhook sources, we can optionally skip patients without membership data
    if (options?.source === 'webhook' && !options?.skipMembershipFilter) {
      clinicDebugLog(
        `[ClinicSync] Skipping patient ${sanitized.clinicsyncPatientId} (${sanitized.fullName}) - no membership data in webhook payload`
      );
      return { patientId: null, matchMethod: undefined };
    }
    
    // For other sources (manual sync, etc.), still process but log it
    clinicDebugLog(
      `[ClinicSync] Patient ${sanitized.clinicsyncPatientId} (${sanitized.fullName}) has no membership data in webhook payload`
    );
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

    // Always upsert membership record (even if hasMembership is false, we want to track the patient)
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

type ReprocessOptions = {
  clinicsyncPatientIds?: string[];
  limit?: number;
  skipWithoutPatient?: boolean;
  paymentMethodKeys?: string[];
  paymentMethodLike?: string[];
};

export async function reprocessClinicSyncMemberships(options: ReprocessOptions = {}): Promise<{
  processed: number;
  skipped: number;
}> {
  const {
    clinicsyncPatientIds,
    limit,
    skipWithoutPatient = true,
    paymentMethodKeys,
    paymentMethodLike,
  } = options;

  const params: unknown[] = [];
  const conditions: string[] = [];
  let joinClause = '';

  if (clinicsyncPatientIds && clinicsyncPatientIds.length > 0) {
    params.push(clinicsyncPatientIds);
    conditions.push(`cm.clinicsync_patient_id = ANY($${params.length})`);
  }

  const paymentConditions: string[] = [];

  if (paymentMethodKeys && paymentMethodKeys.length > 0) {
    params.push(paymentMethodKeys);
    paymentConditions.push(`p.payment_method_key = ANY($${params.length})`);
  }

  if (paymentMethodLike && paymentMethodLike.length > 0) {
    params.push(paymentMethodLike.map((pattern) => pattern.toLowerCase()));
    paymentConditions.push(`LOWER(COALESCE(p.payment_method, '')) LIKE ANY($${params.length})`);
  }

  if (paymentConditions.length > 0) {
    joinClause = 'INNER JOIN patients p ON p.patient_id = cm.patient_id';
    conditions.push(`(${paymentConditions.join(' OR ')})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let limitClause = '';
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.push(Math.floor(limit));
    limitClause = `LIMIT $${params.length}`;
  }

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
  }>(
    `
      SELECT cm.*
      FROM clinicsync_memberships cm
      ${joinClause}
      ${whereClause}
      ORDER BY cm.updated_at DESC NULLS LAST
      ${limitClause}
    `,
    params
  );

  let processed = 0;
  let skipped = 0;

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

    const { plan, passId, tier } = hasActiveMembership(sanitized);
    if (plan && !sanitized.membershipPlan) {
      sanitized.membershipPlan = plan;
    }
    if (typeof passId === 'number') {
      sanitized.pass_id = passId;
    }
    sanitized.membershipTier = tier || sanitized.membershipTier;

    if (!row.patient_id) {
      skipped += 1;
      if (skipWithoutPatient) {
        continue;
      }
    }

    if (!row.patient_id) {
      // No mapped patient; nothing further to update.
      continue;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await upsertMembershipSummary(client, row.patient_id, sanitized);
      await applyMembershipImpact(client, row.patient_id, sanitized);
      await client.query('COMMIT');
      processed += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(
        `[ClinicSync] Reprocess error for ${row.clinicsync_patient_id} (${row.patient_id}):`,
        error
      );
      skipped += 1;
    } finally {
      client.release();
    }
  }

  return { processed, skipped };
}
function normalizePayload(payload: ClinicSyncPayload, source?: string): SanitizedMembership {
  const clinicsyncPatientId =
    stringValue(payload.patient_number) ||
    stringValue(payload.id) ||
    stringValue(payload.patient_id) ||
    '';

  // Determine membership status - check multiple possible locations
  let membershipStatus =
    stringValue(payload.membership_status) ||
    stringValue(payload.status) ||
    (payload.discharged ? 'discharged' : null);
  
  // If still no status, check memberships array or nested membership object
  if (!membershipStatus) {
    if (Array.isArray(payload.memberships) && payload.memberships.length > 0) {
      membershipStatus = stringValue(payload.memberships[0]?.status || payload.memberships[0]?.membership_status);
    }
    if (!membershipStatus && payload.membership) {
      membershipStatus = stringValue(payload.membership.status || payload.membership.membership_status);
    }
  }
  
  // Default to 'active' if we have membership data but no status
  // Check passes array specifically for membership indicators
  const hasPassesWithMembership = Array.isArray(payload.passes) && payload.passes.length > 0 &&
    payload.passes.some((pass: any) => 
      pass?.name || pass?.package_name || pass?.membership_name || pass?.plan_name || pass?.program_name
    );
  
  const hasMembershipData = !!(
    stringValue(payload.membership_plan) ||
    stringValue(payload.program_name) ||
    (Array.isArray(payload.memberships) && payload.memberships.length > 0) ||
    payload.membership ||
    hasPassesWithMembership
  );
  
  if (!membershipStatus && hasMembershipData) {
    membershipStatus = 'active';
  } else if (!membershipStatus) {
    membershipStatus = payload.discharged ? 'discharged' : 'active';
  }

  const balanceOwing =
    toNumber(payload.amount_owing) ||
    toNumber(payload.balance) ||
    toNumber(payload.claims_amount_owing) ||  // Insurance claims balance
    toNumber(payload.total_remaining_balance);

  // amount_due should only be what they currently owe, not lifetime totals
  // Use amount_due if explicitly provided, otherwise use balance_owing
  // Do NOT use total_purchased or total_payment_amount as those are historical totals
  const amountDue =
    toNumber(payload.amount_due) ||
    balanceOwing ||
    0;  // Default to 0 if neither is available

  const sanitized: SanitizedMembership = {
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
      stringValue(payload.treatment_name) ||
      // Check if there's a memberships array
      (Array.isArray(payload.memberships) && payload.memberships.length > 0
        ? stringValue(payload.memberships[0]?.name || payload.memberships[0]?.plan_name || payload.memberships[0]?.program_name)
        : null) ||
      // Check nested membership object
      stringValue(payload?.membership?.name || payload?.membership?.plan_name || payload?.membership?.program_name) ||
      // Check passes array - passes can contain membership/package information
      (Array.isArray(payload.passes) && payload.passes.length > 0
        ? stringValue(
            payload.passes[0]?.name ||
            payload.passes[0]?.package_name ||
            payload.passes[0]?.membership_name ||
            payload.passes[0]?.plan_name ||
            payload.passes[0]?.program_name ||
            payload.passes[0]?.treatment_name
          )
        : null),
    membershipStatus,
    membershipTier: stringValue(payload.membership_tier || payload.patient_type),
    discharged: Boolean(payload.discharged),
    rawPayload: payload,
    eventType: source ? `clinicsync.${source}` : 'clinicsync.webhook'
  };

  const { isActive, plan, passId, tier, isMulti, allPlans, allPassIds } = hasActiveMembership(sanitized);
  if (plan && !sanitized.membershipPlan) {
    sanitized.membershipPlan = plan;
  }
  if (typeof passId === 'number') {
    sanitized.pass_id = passId;
  }
  sanitized.membershipTier = tier || sanitized.membershipTier;
  
  // Store multi-membership info in the sanitized object
  (sanitized as any).isMultiMembership = isMulti;
  (sanitized as any).allPlans = allPlans;
  (sanitized as any).allPassIds = allPassIds;

  return sanitized;
}

async function resolvePatientMatch(
  client: PoolClient,
  membership: SanitizedMembership
): Promise<PatientMatch | null> {
  if (!membership.clinicsyncPatientId) {
    return null;
  }

  // First check if we already have a mapping by clinicsync_patient_id (patient_number)
  const byId = await client.query<{ patient_id: string }>(
    `SELECT patient_id FROM patient_clinicsync_mapping WHERE clinicsync_patient_id = $1`,
    [membership.clinicsyncPatientId]
  );
  if ((byId.rowCount ?? 0) > 0) {
    return { patientId: byId.rows[0].patient_id, matchMethod: 'id', confidence: 1 };
  }

  // Also check if there's a patient with this clinicsync_patient_id stored somewhere
  // (in case it was imported from CSV or stored in a custom field)
  // For now, we'll rely on email/phone/name matching below

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
    // Use stripHonorifics for name matching to handle "Mr.", "Dr.", etc.
    const { stripHonorifics } = await import('./nameUtils');
    const normalizedName = stripHonorifics(membership.fullName).toLowerCase().trim();
    
    const nameDobMatch = await client.query<{ patient_id: string }>(
      `SELECT patient_id
         FROM patients
        WHERE LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) = $1
          AND dob = $2
        LIMIT 1`,
      [normalizedName, membership.dob]
    );
    if ((nameDobMatch.rowCount ?? 0) > 0) {
      return { patientId: nameDobMatch.rows[0].patient_id, matchMethod: 'name+dob', confidence: 0.85 };
    }
  }

  // Try name-only match as last resort (lower confidence)
  if (membership.fullName) {
    const { stripHonorifics } = await import('./nameUtils');
    const normalizedName = stripHonorifics(membership.fullName).toLowerCase().trim();
    
    const nameOnlyMatch = await client.query<{ patient_id: string }>(
      `SELECT patient_id
         FROM patients
        WHERE LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) = $1
          AND status_key NOT IN ('inactive', 'discharged')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [normalizedName]
    );
    if ((nameOnlyMatch.rowCount ?? 0) > 0) {
      return { patientId: nameOnlyMatch.rows[0].patient_id, matchMethod: 'name', confidence: 0.7 };
    }
  }

  return null;
}

export { normalizePayload };

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
        pass_id,
        balance_owing,
        amount_due,
        last_payment_at,
        next_payment_due,
        service_start_date,
        contract_end_date,
        is_active,
        raw_payload
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     ON CONFLICT (clinicsync_patient_id) DO UPDATE SET
        patient_id = COALESCE(EXCLUDED.patient_id, clinicsync_memberships.patient_id),
        membership_plan = EXCLUDED.membership_plan,
        membership_status = EXCLUDED.membership_status,
        membership_tier = EXCLUDED.membership_tier,
        pass_id = COALESCE(EXCLUDED.pass_id, clinicsync_memberships.pass_id),
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
      membership.pass_id ?? null,
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
  // Get current patient status and name for logging
  const patientInfo = await client.query<{
    status_key: string | null;
    full_name: string;
  }>(`
    SELECT status_key, full_name FROM patients WHERE patient_id = $1
  `, [patientId]);

  const currentStatus = patientInfo.rows[0]?.status_key ?? 'active';
  const patientName = patientInfo.rows[0]?.full_name ?? 'Unknown';

  await client.query(
    `UPDATE patients
        SET service_start_date = COALESCE($2, service_start_date),
            contract_end_date = COALESCE($3, contract_end_date),
            membership_owes = $4,
            updated_at = NOW()
      WHERE patient_id = $1`,
    [patientId, membership.memberSince, membership.contractEndDate, membership.balanceOwing || null]
  );

  // Check for membership cancellation (Jane) - do this BEFORE other status changes
  const membershipStatus = (membership.membershipStatus || '').toLowerCase();
  const isCancelled = membership.discharged || 
    ['cancelled', 'canceled', 'inactive', 'discharged', 'terminated', 'ended'].includes(membershipStatus);
  
  if (isCancelled && currentStatus !== 'inactive') {
    // Log the cancellation detection (best-effort – skip if log table missing)
    try {
      await client.query(
        `INSERT INTO patient_status_activity_log (
          patient_id,
          patient_name,
          source_system,
          change_type,
          previous_status,
          new_status,
          reason,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          patientId,
          patientName,
          'jane',
          'membership_cancelled',
          currentStatus,
          'inactive',
          `Membership cancelled in Jane - Status: ${membership.membershipStatus || 'discharged'}`,
          JSON.stringify({
            membership_plan: membership.membershipPlan,
            membership_status: membership.membershipStatus,
            discharged: membership.discharged,
          }),
        ]
      );
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== '42P01') {
        throw error;
      }
      clinicDebugLog(
        '[ClinicSync] patient_status_activity_log table missing when logging cancellation; continuing without audit entry.'
      );
    }

    // Update patient status to inactive
    await client.query(
      `UPDATE patients SET status_key = 'inactive', updated_at = NOW() WHERE patient_id = $1`,
      [patientId]
    );

    clinicDebugLog(`[ClinicSync] 🚨 Membership cancelled detected: ${patientName} → Set to inactive`);
    // Return early - don't process payment failures or other holds if cancelled
    return;
  }

  // IMPORTANT: If amount_due > 0, this indicates a credit card decline (payment failure)
  // This is based on the user's requirement that outstanding balance > 0 means CC declined
  const hasPaymentFailure = (membership.amountDue || 0) > 0;
  
  if (hasPaymentFailure) {
    // Get current patient status
    const patientStatusResult = await client.query<{ status_key: string | null }>(
      `SELECT status_key FROM patients WHERE patient_id = $1`,
      [patientId]
    );
    const currentStatus = patientStatusResult.rows[0]?.status_key ?? 'active';
    const holdStatusKey = 'hold_payment_research';

    // Check if payment issue already exists
    const existingIssue = await client.query<{ issue_id: string }>(`
      SELECT issue_id FROM payment_issues
      WHERE patient_id = $1
        AND issue_type = 'payment_declined'
        AND resolved_at IS NULL
      LIMIT 1
    `, [patientId]);

    if (existingIssue.rows.length > 0) {
      // Update existing issue
      await client.query(`
        UPDATE payment_issues
        SET amount_owed = $1,
            issue_severity = $2,
            updated_at = NOW()
        WHERE issue_id = $3
      `, [
        membership.amountDue,
        (membership.amountDue || 0) >= 100 ? 'critical' : 'warning',
        existingIssue.rows[0].issue_id
      ]);
    } else {
      // Create new payment issue
      await client.query(`
        INSERT INTO payment_issues (
          patient_id,
          issue_type,
          issue_severity,
          amount_owed,
          days_overdue,
          previous_status_key,
          status_changed_to,
          auto_updated,
          resolution_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
      `, [
        patientId,
        'payment_declined',
        (membership.amountDue || 0) >= 100 ? 'critical' : 'warning',
        membership.amountDue,
        0,
        currentStatus,
        holdStatusKey,
        `Credit card declined - Outstanding balance from Jane membership: $${(membership.amountDue || 0).toFixed(2)}`
      ]);
    }

    // Update patient status to Hold - Payment Research if not already
    if (currentStatus !== holdStatusKey) {
      await client.query(
        `UPDATE patients SET status_key = $1, updated_at = NOW() WHERE patient_id = $2`,
        [holdStatusKey, patientId]
      );
    }
  } else {
    // If balance is 0, resolve any existing payment_declined issues for this patient
    await client.query(`
      UPDATE payment_issues
      SET resolved_at = NOW(), updated_at = NOW()
      WHERE patient_id = $1
        AND issue_type = 'payment_declined'
        AND resolved_at IS NULL
    `, [patientId]);

    // If patient is on Hold - Payment Research and balance is now 0, restore previous status
    const patientStatusResult = await client.query<{ status_key: string | null }>(
      `SELECT status_key FROM patients WHERE patient_id = $1`,
      [patientId]
    );
    const currentStatus = patientStatusResult.rows[0]?.status_key ?? null;

    if (currentStatus === 'hold_payment_research') {
      // Try to get previous status from payment_issues
      const previousStatus = await client.query<{ previous_status_key: string }>(`
        SELECT previous_status_key
        FROM payment_issues
        WHERE patient_id = $1
          AND issue_type = 'payment_declined'
          AND resolved_at IS NOT NULL
        ORDER BY resolved_at DESC
        LIMIT 1
      `, [patientId]);

      const restoreStatus = previousStatus.rows[0]?.previous_status_key || 'active';
      await client.query(
        `UPDATE patients SET status_key = $1, updated_at = NOW() WHERE patient_id = $2`,
        [restoreStatus, patientId]
      );
    }
  }

  const { isActive: membershipActive, plan: activePlan, tier: activeTier } = hasActiveMembership(membership);
  if (membershipActive && activeTier) {
    await client.query(
      `UPDATE clinicsync_memberships 
       SET membership_tier = $1, membership_plan = COALESCE($2, membership_plan)
       WHERE clinicsync_patient_id = $3`,
      [activeTier, activePlan, membership.clinicsyncPatientId]
    );
  }

  const holdType = determineHoldType(membership);
  if (!holdType) {
    return;
  }

  // Re-query current status (may have changed from payment failure handling above)
  const patientStatusResult = await client.query<{ status_key: string | null }>(
    `SELECT status_key FROM patients WHERE patient_id = $1`,
    [patientId]
  );
  const currentStatusAfterPaymentCheck = patientStatusResult.rows[0]?.status_key ?? null;

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

export function detectMultiMembership(passes: any[] = [], appointments: any[] = []): { isMulti: boolean; types: string[]; passIds: number[]; plans: string[] } {
  const allPassIds = passes.map((p) => p.id).concat(appointments.map((a) => a.pass_id).filter(Boolean));
  const uniquePassIds = [...new Set(allPassIds)].filter(id => KNOWN_PASS_IDS.includes(id));
  
  const plans: string[] = [];
  const types: string[] = [];
  
  uniquePassIds.forEach(passId => {
    const config = PASS_CONFIG[passId as keyof typeof PASS_CONFIG];
    if (config) {
      plans.push(config.plan);
      types.push(config.type);
    }
  });
  
  // Check for specific combinations like Insurance Supplemental + TCMH
  const hasInsuranceSupplemental = uniquePassIds.includes(3);
  const hasTCMH = uniquePassIds.includes(52) || uniquePassIds.includes(65) || uniquePassIds.includes(72);
  
  return {
    isMulti: uniquePassIds.length > 1,
    types: [...new Set(types)],
    passIds: uniquePassIds,
    plans: [...new Set(plans)]
  };
}

export function hasJaneSignal(extracted: SanitizedMembership): boolean {
  return extracted.rawPayload.passes?.some((p: any) => [3, 7, 52].includes(p.id)) ||
         extracted.membershipPlan?.toLowerCase().includes('pro-bono') ||
         extracted.rawPayload.treatment_name?.toLowerCase().includes('pro-bono') ||
         extracted.rawPayload.notes?.toLowerCase().includes('approved disc') ||
         extracted.fullName?.toLowerCase().includes('bunger');
}

export function hasActiveMembership(extracted: SanitizedMembership): { 
  isActive: boolean; 
  plan?: string; 
  passId?: number; 
  tier?: string;
  isMulti?: boolean;
  allPlans?: string[];
  allPassIds?: number[];
} {
  const { passes = [], appointmentsObject = [] } = extracted.rawPayload;
  const { isMulti, types, passIds, plans } = detectMultiMembership(passes, appointmentsObject);
  const hasKnownPass = passIds.length > 0;
  const hasPackage = appointmentsObject.some((a: any) => a.package_id || a.membership_id);
  const outstandingAmount =
    extracted.amountDue ||
    extracted.balanceOwing ||
    toNumber(extracted.rawPayload?.claims_amount_owing) ||
    toNumber(extracted.rawPayload?.total_remaining_balance);
  const hasUnpaidAppointment = appointmentsObject.some((a: any) =>
    ['unpaid', 'payment_declined', 'payment_failed'].includes((a?.purchase_state ?? '').toLowerCase())
  );
  const isActive =
    !extracted.discharged &&
    (hasKnownPass || hasPackage || passes.length > 0 || isMulti || outstandingAmount > 0 || hasUnpaidAppointment);

  if (isActive && hasKnownPass) {
    // For multiple memberships, combine the plans
    if (isMulti && plans.length > 1) {
      return { 
        isActive: true, 
        plan: plans.join(' + '), 
        passId: passIds[0], // Primary pass ID
        tier: types.join('+'),
        isMulti: true,
        allPlans: plans,
        allPassIds: passIds
      };
    }
    // Single membership
    const config = PASS_CONFIG[passIds[0] as keyof typeof PASS_CONFIG];
    return { 
      isActive: true, 
      plan: config?.plan, 
      passId: passIds[0], 
      tier: config?.type || types[0],
      isMulti: false,
      allPlans: [config?.plan].filter(Boolean),
      allPassIds: passIds
    };
  }
  if (isMulti) {
    return { isActive: true, plan: 'Mixed Supplemental', tier: types.join('+'), isMulti: true };
  }
  if (!extracted.discharged && (outstandingAmount > 0 || hasUnpaidAppointment)) {
    const derivedPlan =
      extracted.membershipPlan ||
      appointmentsObject.find((a: any) => a?.treatment_name)?.treatment_name ||
      extracted.rawPayload?.treatment_name ||
      'ClinicSync Outstanding';
    return { isActive: true, plan: derivedPlan, tier: extracted.membershipTier || 'clinic_unpaid', isMulti: false };
  }
  return { isActive: false, isMulti: false };
}

export async function shouldEvaluateViaClinicSync(
  typeKey: string,
  paymentMethod: string,
  extracted: SanitizedMembership
): Promise<{ evaluate: boolean; paymentMethod: string; clientType: string }> {
  const pureQboTypes = ['qbo_tcmh_180_month', 'mens_health_qbo'];
  const mixedTypes = typeKey.startsWith('mixed_');
  const janeTypes = typeKey.includes('jane_') || 
                    ['tcmh_family_50_month', 'insurance_supplemental_60_month', 'dependent_membership_30_month', 'phil_ff_trt_140_month'].includes(typeKey);

  if (pureQboTypes.includes(typeKey)) {
    return { evaluate: false, paymentMethod: 'qbo', clientType: typeKey };
  }
  if (mixedTypes && paymentMethod === 'jane_quickbooks') {
    return { evaluate: true, paymentMethod: 'jane_quickbooks', clientType: typeKey };
  }
  if (janeTypes) {
    return { evaluate: true, paymentMethod: 'jane', clientType: typeKey };
  }

  if (typeKey === 'approved_disc_pro_bono_pt' || typeKey === 'dependent_membership_30_month') {
    const hasJaneSignalFlag = hasJaneSignal(extracted);
    if (hasJaneSignalFlag || extracted.fullName?.toLowerCase().includes('bunger')) {
      const clientType = typeKey === 'dependent_membership_30_month' ? 'dependent_membership_30_month' : 'approved_disc_pro_bono_pt';
      return { evaluate: true, paymentMethod: 'jane', clientType };
    } else {
      return { evaluate: false, paymentMethod: 'qbo', clientType: typeKey };
    }
  }

  return { evaluate: false, paymentMethod: paymentMethod || 'qbo', clientType: typeKey };
}

export async function handleProBonoMapping(client: PoolClient, patientId: string, extracted: SanitizedMembership, result: Awaited<ReturnType<typeof shouldEvaluateViaClinicSync>>) {
  if (result.paymentMethod === 'jane' && result.clientType === 'approved_disc_pro_bono_pt') {
    await client.query(
      `UPDATE patients 
       SET payment_method_key = $1, client_type_key = $2, updated_at = NOW()
       WHERE patient_id = $3`,
      ['jane', 'approved_disc_pro_bono_pt', patientId]
    );
  } else if (result.paymentMethod === 'qbo') {
    await client.query(
      `UPDATE patients 
       SET payment_method_key = $1, updated_at = NOW()
       WHERE patient_id = $2`,
      ['qbo', patientId]
    );
  }
}

export async function getPatientById(clinicsyncPatientId: string) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT p.patient_id, p.client_type_key, p.payment_method_key
      FROM patients p
      JOIN patient_clinicsync_mapping m ON p.patient_id = m.patient_id
      WHERE m.clinicsync_patient_id = $1
    `, [clinicsyncPatientId]);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}



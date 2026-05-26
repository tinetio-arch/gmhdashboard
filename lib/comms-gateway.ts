import { createHash } from 'crypto';

import { createGHLClient } from './ghl';
import { loadTokensForPatient, sendPushMessages, type PushCategory } from './expoPush';
import { messagingService } from './messaging';
import { patientsService, type PatientProfile } from './patients';
import {
  countSentInLastHours,
  findByIdempotencyKey,
  findRecentByPatientEvent,
  insertLedgerRow,
  isUniqueViolation,
  updateLedgerRow,
  type AccountKey,
  type LedgerChannel,
  type LedgerRow,
  type LedgerStatus,
} from './comms-ledger';

/**
 * Patient communications gateway — `notifyPatient` is the single entrypoint
 * for sending any outbound message to a patient.
 *
 * Phase 1 deliverable (project: untangling-healthie-communications-from-healthie).
 * This file does NOT migrate existing call sites — that happens in later phases.
 *
 * Responsibilities:
 *   1. Resolve channel by priority (preferredChannel → push → SMS → email),
 *      skipping any channel the patient can't receive on.
 *   2. Enforce idempotency: same `idempotencyKey` returns the prior outcome
 *      without re-sending.
 *   3. Enforce soft dedup: same (patient, event.name) within a rolling window
 *      returns `suppressed`.
 *   4. Enforce a per-patient daily cap (default 6 sends / 24h, overridable
 *      via `COMMS_PATIENT_DAILY_CAP`). Critical events bypass with
 *      `event.bypassCap: true`.
 *   5. Write every decision (sent / suppressed / skipped / failed) to the
 *      `patient_communications` ledger.
 */

export type PatientRef = string | PatientProfile;
export type GatewayChannel = 'push' | 'sms' | 'email';

export interface CommsEvent {
  /** Semantic event name, e.g. `appointment_reminder_24h`, `lab_result_available`.
   *  Stored in `patient_communications.event_type`. */
  name: string;
  /** Push opt-in bucket. Used for token-filter; also informs the push payload. */
  category: PushCategory;
  /** When > 0, the gateway skips if any non-failed row for this (patient, event.name)
   *  exists within the window. Default 0 (off). */
  dedupWindowMinutes?: number;
  /** Hard idempotency key. If absent, derived from event.name + patient + payload hash.
   *  Stored in `patient_communications.idempotency_key`. */
  idempotencyKey?: string;
  /** Skip the per-patient daily cap. Reserve for transactional / safety-critical events
   *  (lab results, password reset, payment receipts). */
  bypassCap?: boolean;
  /** Force a specific channel. Still skipped if the patient can't receive on it. */
  preferredChannel?: GatewayChannel;
  /** GHL sub-account routing key, mirrors ghl_messages.account_key. */
  accountKey?: AccountKey;
  /** Optional template key for downstream analytics. */
  templateKey?: string;
  /** Optional template variables (the substitutions the caller already applied). */
  templateVariables?: Record<string, unknown>;
}

export interface CommsPayload {
  /** Default title (used as push title and as email subject if not overridden). */
  title?: string;
  /** Default body (used by every channel that doesn't supply its own override). */
  body: string;
  /** Default push `data` payload. */
  data?: Record<string, unknown>;
  push?: {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  sms?: {
    body?: string;
    attachments?: string[];
  };
  email?: {
    subject?: string;
    body?: string;
  };
}

export interface NotifyOptions {
  /** Caller subsystem — required for audit, stored in `source` (e.g. 'cron', 'dashboard',
   *  'webhook:healthie', 'jarvis'). */
  source: string;
  /** Override the default cap (sends per rolling 24h). */
  dailyCap?: number;
  /** Override the rolling-cap window (hours). Default 24. */
  capWindowHours?: number;
  /** Actor (staff user id) that initiated the send. */
  actorId?: string;
  /** Caller-supplied correlation id (e.g. trace id, request id). */
  requestId?: string;
  /** Override the patient's clinic if the caller knows it (avoids extra lookup). */
  clinic?: string;
}

export type NotifyStatus =
  | 'sent'
  | 'suppressed_dedup'
  | 'suppressed_cap'
  | 'suppressed_optout'
  | 'no_channel'
  | 'failed';

export interface NotifyResult {
  status: NotifyStatus;
  channel: GatewayChannel | null;
  /** patient_communications.id (BIGSERIAL, returned as string from node-pg). */
  ledgerId: string;
  providerMessageId?: string | null;
  failureReason?: string | null;
  /** True if this call was a no-op replay of a prior identical send (idempotency hit). */
  idempotent: boolean;
}

const DEFAULT_CAP_WINDOW_HOURS = 24;
const FALLBACK_DAILY_CAP = 6;

const CHANNEL_PRIORITY: GatewayChannel[] = ['push', 'sms', 'email'];

function envDailyCap(): number {
  const raw = process.env.COMMS_PATIENT_DAILY_CAP;
  if (!raw) return FALLBACK_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : FALLBACK_DAILY_CAP;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function deriveIdempotencyKey(
  patientId: string,
  event: CommsEvent,
  payload: CommsPayload
): string {
  const hash = createHash('sha256')
    .update(`${event.name}|${patientId}|${stableStringify(payload)}`)
    .digest('hex')
    .slice(0, 32);
  return `auto:${event.name}:${patientId}:${hash}`;
}

async function resolvePatient(ref: PatientRef): Promise<PatientProfile> {
  if (typeof ref !== 'string') return ref;
  const patient = await patientsService.getById(ref);
  if (!patient) throw new Error(`comms-gateway: patient ${ref} not found`);
  return patient;
}

interface ChannelEligibility {
  push: boolean;
  sms: boolean;
  email: boolean;
  pushTokens: Awaited<ReturnType<typeof loadTokensForPatient>>;
}

async function evaluateChannels(
  patient: PatientProfile,
  category: PushCategory
): Promise<ChannelEligibility> {
  const pushTokens = patient.healthieClientId
    ? await loadTokensForPatient(patient.healthieClientId, category)
    : [];

  return {
    push: pushTokens.length > 0,
    sms: Boolean(patient.ghlContactId && patient.phone),
    email: Boolean(patient.email),
    pushTokens,
  };
}

function pickChannel(
  preferred: GatewayChannel | undefined,
  eligibility: ChannelEligibility
): GatewayChannel | null {
  if (preferred && eligibility[preferred]) return preferred;
  for (const ch of CHANNEL_PRIORITY) {
    if (eligibility[ch]) return ch;
  }
  return null;
}

function pickBody(channel: GatewayChannel, payload: CommsPayload): string {
  const channelBody = payload[channel]?.body;
  const body = (channelBody ?? payload.body ?? '').trim();
  if (!body) throw new Error(`comms-gateway: empty body for channel ${channel}`);
  return body;
}

function pickTitle(payload: CommsPayload): string {
  return (payload.push?.title ?? payload.title ?? '').trim();
}

function pickEmailSubject(payload: CommsPayload): string {
  const subj = (payload.email?.subject ?? payload.title ?? '').trim();
  if (!subj) {
    throw new Error('comms-gateway: email requires a subject (payload.email.subject or payload.title)');
  }
  return subj;
}

async function sendViaPush(
  event: CommsEvent,
  payload: CommsPayload,
  eligibility: ChannelEligibility,
  ledgerRowId: string
): Promise<{ providerMessageId: string | null; failureReason: string | null; ok: boolean }> {
  const title = pickTitle(payload) || event.name;
  const body = pickBody('push', payload);
  const data = { ...(payload.data ?? {}), ...(payload.push?.data ?? {}), commsLedgerId: ledgerRowId };

  const messages = eligibility.pushTokens.map((tok) => ({
    target: { expoToken: tok.expo_token, healthieClientId: tok.healthie_client_id },
    category: event.category,
    dedupeKey: `comms:${ledgerRowId}`,
    title,
    body,
    data,
  }));

  const result = await sendPushMessages(messages);
  if (result.sent > 0) {
    return { providerMessageId: null, failureReason: null, ok: true };
  }
  if (result.skippedDuplicate > 0 && result.failed === 0) {
    return { providerMessageId: null, failureReason: 'push_send_log dedup hit', ok: true };
  }
  return {
    providerMessageId: null,
    failureReason: `push send failed (attempted=${result.attempted} sent=0 failed=${result.failed} deviceNotRegistered=${result.deviceNotRegistered})`,
    ok: false,
  };
}

async function sendViaSms(
  patient: PatientProfile,
  payload: CommsPayload
): Promise<{ providerMessageId: string | null; failureReason: string | null; ok: boolean }> {
  const body = pickBody('sms', payload);
  const ghl = createGHLClient();
  if (!ghl) return { providerMessageId: null, failureReason: 'GHL client not configured', ok: false };
  if (!patient.ghlContactId) {
    return { providerMessageId: null, failureReason: 'patient has no ghl_contact_id', ok: false };
  }
  try {
    const res = await ghl.sendSms(patient.ghlContactId, body, payload.sms?.attachments);
    return { providerMessageId: res?.id ?? null, failureReason: null, ok: true };
  } catch (err) {
    return {
      providerMessageId: null,
      failureReason: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

async function sendViaEmail(
  patient: PatientProfile,
  payload: CommsPayload
): Promise<{ providerMessageId: string | null; failureReason: string | null; ok: boolean }> {
  const subject = pickEmailSubject(payload);
  const body = pickBody('email', payload);
  try {
    const receipt = await messagingService.sendPatientMessage(patient.patientId, {
      channel: 'email',
      subject,
      body,
    });
    return {
      providerMessageId: receipt.providerMessageId ?? receipt.id ?? null,
      failureReason: receipt.failureReason ?? null,
      ok: receipt.status === 'sent' || receipt.status === 'queued',
    };
  } catch (err) {
    return {
      providerMessageId: null,
      failureReason: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

function gatewayChannelToLedger(channel: GatewayChannel): LedgerChannel {
  return channel;
}

function gatewayChannelProvider(channel: GatewayChannel): string {
  if (channel === 'push') return 'expo';
  if (channel === 'sms') return 'ghl';
  return 'ses';
}

function ledgerRowToNotifyResult(row: LedgerRow): NotifyResult {
  // Re-derive the gateway status from the ledger status. We can't perfectly recover
  // suppress-reason from a stored row when the schema collapses it into one 'suppressed';
  // we stored the reason in raw_metadata.suppress_reason at write time.
  let status: NotifyStatus;
  const reason = (row.raw_metadata?.suppress_reason as string | undefined) ?? '';
  if (row.status === 'sent' || row.status === 'delivered') status = 'sent';
  else if (row.status === 'failed') status = 'failed';
  else if (row.status === 'skipped') status = 'no_channel';
  else if (row.status === 'suppressed') {
    if (reason === 'dedup') status = 'suppressed_dedup';
    else if (reason === 'cap') status = 'suppressed_cap';
    else if (reason === 'optout') status = 'suppressed_optout';
    else status = 'suppressed_dedup';
  } else status = 'failed';

  const channel: GatewayChannel | null =
    row.channel === 'push' || row.channel === 'sms' || row.channel === 'email'
      ? (row.channel as GatewayChannel)
      : null;

  return {
    status,
    channel,
    ledgerId: row.id,
    providerMessageId: row.external_id,
    failureReason: row.error_message,
    idempotent: true,
  };
}

/**
 * Send (or suppress) one outbound communication to a patient.
 *
 * @example
 * await notifyPatient(patientId, {
 *   name: 'appointment_reminder_24h',
 *   category: 'appointments',
 *   dedupWindowMinutes: 720,
 * }, {
 *   title: 'Appointment tomorrow',
 *   body: 'Hi Alex, reminder of your appointment tomorrow at 9:00 AM.',
 *   email: { subject: 'Your appointment tomorrow' },
 * }, {
 *   source: 'cron:appointment-reminders',
 * });
 */
export async function notifyPatient(
  patientRef: PatientRef,
  event: CommsEvent,
  payload: CommsPayload,
  options: NotifyOptions
): Promise<NotifyResult> {
  if (!event?.name) throw new Error('comms-gateway: event.name is required');
  if (!event?.category) throw new Error('comms-gateway: event.category is required');
  if (!options?.source) throw new Error('comms-gateway: options.source is required (e.g. "cron:appt-reminders")');
  if (!payload?.body?.trim() && !payload.push?.body && !payload.sms?.body && !payload.email?.body) {
    throw new Error('comms-gateway: payload requires a body (top-level or per-channel)');
  }

  const patient = await resolvePatient(patientRef);
  const idempotencyKey = event.idempotencyKey ?? deriveIdempotencyKey(patient.patientId, event, payload);

  // 1. Hard idempotency.
  const prior = await findByIdempotencyKey(idempotencyKey);
  if (prior) return ledgerRowToNotifyResult(prior);

  // 2. Soft dedup (per patient + event.name).
  const dedupWindow = event.dedupWindowMinutes ?? 0;
  if (dedupWindow > 0) {
    const recent = await findRecentByPatientEvent(patient.patientId, event.name, dedupWindow);
    if (recent) {
      const row = await insertLedgerRow({
        patient_id: patient.patientId,
        healthie_client_id: patient.healthieClientId ?? null,
        ghl_contact_id: patient.ghlContactId ?? null,
        clinic: options.clinic ?? null,
        account_key: event.accountKey ?? null,
        source: options.source,
        event_type: event.name,
        channel: 'other',
        status: 'suppressed',
        idempotency_key: idempotencyKey,
        triggered_by_user_id: options.actorId ?? null,
        request_id: options.requestId ?? null,
        template_key: event.templateKey ?? null,
        template_variables: event.templateVariables ?? null,
        raw_metadata: {
          suppress_reason: 'dedup',
          dedup_window_minutes: dedupWindow,
          suppressed_by_row_id: recent.id,
        },
      });
      return { status: 'suppressed_dedup', channel: null, ledgerId: row.id, idempotent: false };
    }
  }

  // 3. Per-patient daily cap.
  if (!event.bypassCap) {
    const cap = options.dailyCap ?? envDailyCap();
    const windowHours = options.capWindowHours ?? DEFAULT_CAP_WINDOW_HOURS;
    const recentCount = await countSentInLastHours(patient.patientId, windowHours);
    if (recentCount >= cap) {
      const row = await insertLedgerRow({
        patient_id: patient.patientId,
        healthie_client_id: patient.healthieClientId ?? null,
        ghl_contact_id: patient.ghlContactId ?? null,
        clinic: options.clinic ?? null,
        account_key: event.accountKey ?? null,
        source: options.source,
        event_type: event.name,
        channel: 'other',
        status: 'suppressed',
        idempotency_key: idempotencyKey,
        triggered_by_user_id: options.actorId ?? null,
        request_id: options.requestId ?? null,
        template_key: event.templateKey ?? null,
        template_variables: event.templateVariables ?? null,
        raw_metadata: {
          suppress_reason: 'cap',
          cap,
          window_hours: windowHours,
          recent_count: recentCount,
        },
      });
      return { status: 'suppressed_cap', channel: null, ledgerId: row.id, idempotent: false };
    }
  }

  // 4. Channel resolution.
  const eligibility = await evaluateChannels(patient, event.category);
  const channel = pickChannel(event.preferredChannel, eligibility);
  if (!channel) {
    const row = await insertLedgerRow({
      patient_id: patient.patientId,
      healthie_client_id: patient.healthieClientId ?? null,
      ghl_contact_id: patient.ghlContactId ?? null,
      clinic: options.clinic ?? null,
      account_key: event.accountKey ?? null,
      source: options.source,
      event_type: event.name,
      channel: 'other',
      status: 'skipped',
      idempotency_key: idempotencyKey,
      triggered_by_user_id: options.actorId ?? null,
      request_id: options.requestId ?? null,
      template_key: event.templateKey ?? null,
      template_variables: event.templateVariables ?? null,
      raw_metadata: {
        skip_reason: 'no_channel',
        push_tokens: 0,
        has_ghl_contact: Boolean(patient.ghlContactId),
        has_phone: Boolean(patient.phone),
        has_email: Boolean(patient.email),
      },
    });
    return { status: 'no_channel', channel: null, ledgerId: row.id, idempotent: false };
  }

  // 5. Insert queued row (UNIQUE on idempotency_key makes this race-safe).
  const subject = channel === 'email' ? pickEmailSubject(payload) : null;
  const body = pickBody(channel, payload);
  const title = pickTitle(payload) || null;
  const recipientPhone = channel === 'sms' ? patient.phone ?? null : null;
  const recipientEmail = channel === 'email' ? patient.email ?? null : null;

  let pending: LedgerRow;
  try {
    pending = await insertLedgerRow({
      patient_id: patient.patientId,
      healthie_client_id: patient.healthieClientId ?? null,
      ghl_contact_id: patient.ghlContactId ?? null,
      clinic: options.clinic ?? null,
      account_key: event.accountKey ?? null,
      source: options.source,
      event_type: event.name,
      channel: gatewayChannelToLedger(channel),
      status: 'queued',
      idempotency_key: idempotencyKey,
      triggered_by_user_id: options.actorId ?? null,
      request_id: options.requestId ?? null,
      template_key: event.templateKey ?? null,
      template_variables: event.templateVariables ?? null,
      provider: gatewayChannelProvider(channel),
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
      subject,
      body,
      raw_metadata: { title },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const replay = await findByIdempotencyKey(idempotencyKey);
      if (replay) return ledgerRowToNotifyResult(replay);
    }
    throw err;
  }

  // 6. Send via chosen channel.
  let outcome: { providerMessageId: string | null; failureReason: string | null; ok: boolean };
  try {
    if (channel === 'push') {
      outcome = await sendViaPush(event, payload, eligibility, pending.id);
    } else if (channel === 'sms') {
      outcome = await sendViaSms(patient, payload);
    } else {
      outcome = await sendViaEmail(patient, payload);
    }
  } catch (err) {
    outcome = {
      providerMessageId: null,
      failureReason: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }

  // 7. Finalize ledger.
  const nowIso = new Date().toISOString();
  const finalLedgerStatus: LedgerStatus = outcome.ok ? 'sent' : 'failed';
  await updateLedgerRow(pending.id, {
    status: finalLedgerStatus,
    external_id: outcome.providerMessageId,
    error_message: outcome.failureReason,
    sent_at: outcome.ok ? nowIso : null,
    failed_at: outcome.ok ? null : nowIso,
  });

  return {
    status: outcome.ok ? 'sent' : 'failed',
    channel,
    ledgerId: pending.id,
    providerMessageId: outcome.providerMessageId,
    failureReason: outcome.failureReason,
    idempotent: false,
  };
}

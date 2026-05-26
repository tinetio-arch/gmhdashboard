import { query } from './db';
import type { AccountKey } from './comms-ledger';
import type { CommsEvent, GatewayChannel } from './comms-gateway';

/**
 * clinic_reminder_settings — read API + event builder.
 *
 * Phase 2 of project "untangling-healthie-communications-from-healthie"
 * (dispatch row 20260526-192906-2008). Companion to the migration
 * `20260526_clinic_reminder_settings.sql`.
 *
 * Purpose
 *   Centralize the reminder-cadence standard so every future writer (Phase 2
 *   ABXTAC slice, Phase 3 push-cron migration, Phase 4 rollout) reads from one
 *   place and emits a consistent CommsEvent into `notifyPatient()`.
 *
 *   The current behavior of Healthie's native reminders (5d SMS + 24h SMS +
 *   24h email = 3 sends per appointment) is what we're replacing. The standard
 *   is a SINGLE reminder at 24h, on the best channel the gateway picks
 *   (push → SMS → email), with an explicit per-appointment idempotency_key so
 *   cron retries can't double-fire.
 *
 *   This file does NOT send anything. It returns config and builds the event
 *   spec that callers pass to `notifyPatient()`.
 */

export interface ClinicReminderSettings {
  accountKey: AccountKey;
  enabled: boolean;
  hoursBefore: number;
  eventType: string;
  preferredChannel: GatewayChannel | null;
  dedupWindowMinutes: number;
  notes: string | null;
}

interface ClinicReminderRow {
  account_key: AccountKey;
  enabled: boolean;
  hours_before: number;
  event_type: string;
  preferred_channel: GatewayChannel | null;
  dedup_window_minutes: number;
  notes: string | null;
}

function rowToSettings(row: ClinicReminderRow): ClinicReminderSettings {
  return {
    accountKey: row.account_key,
    enabled: row.enabled,
    hoursBefore: row.hours_before,
    eventType: row.event_type,
    preferredChannel: row.preferred_channel,
    dedupWindowMinutes: row.dedup_window_minutes,
    notes: row.notes,
  };
}

/**
 * Fetch the cadence config for one clinic. Returns null when no row exists
 * (which means the migration hasn't seeded that account_key — treat as
 * "reminders disabled for this clinic").
 */
export async function getClinicReminderSettings(
  accountKey: AccountKey
): Promise<ClinicReminderSettings | null> {
  const rows = await query<ClinicReminderRow>(
    `SELECT account_key, enabled, hours_before, event_type,
            preferred_channel, dedup_window_minutes, notes
       FROM clinic_reminder_settings
      WHERE account_key = $1`,
    [accountKey]
  );
  return rows[0] ? rowToSettings(rows[0]) : null;
}

/** Same as the single getter but returns all rows keyed by account_key. */
export async function getAllClinicReminderSettings(): Promise<
  Record<AccountKey, ClinicReminderSettings>
> {
  const rows = await query<ClinicReminderRow>(
    `SELECT account_key, enabled, hours_before, event_type,
            preferred_channel, dedup_window_minutes, notes
       FROM clinic_reminder_settings`
  );
  const out = {} as Record<AccountKey, ClinicReminderSettings>;
  for (const row of rows) out[row.account_key] = rowToSettings(row);
  return out;
}

export interface BuildReminderEventArgs {
  /** Healthie appointment id (or any natural per-appointment key). */
  appointmentId: string | number;
  /** Per-patient overrides applied by the caller — usually NULL. */
  overrides?: {
    bypassCap?: boolean;
    templateKey?: string;
    templateVariables?: Record<string, unknown>;
  };
}

/**
 * Construct the CommsEvent a writer feeds to `notifyPatient()`. Encodes the
 * cadence standard so every reminder writer is consistent:
 *
 *   - `event.name`            = settings.eventType (e.g. `appointment_reminder_24h`)
 *   - `event.category`        = 'appointments' (push opt-in bucket)
 *   - `event.idempotencyKey`  = `appt:<appointmentId>:reminder<hours>h`
 *                               — matches the Phase 1 ledger comment convention
 *                                 (`appt:<id>:reminder24h`) so a Phase-1 row and a
 *                                 Phase-2 retry collapse to the same ledger entry.
 *   - `event.dedupWindowMinutes` = settings.dedupWindowMinutes (defaults to 1440)
 *   - `event.accountKey`      = the clinic
 *   - `event.preferredChannel`= settings.preferredChannel or omitted
 *
 * Throws if `settings.enabled` is false — callers should check `enabled` themselves
 * and short-circuit BEFORE calling this. (Throwing here is a backstop, not a
 * primary check.)
 */
export function buildAppointmentReminderEvent(
  settings: ClinicReminderSettings,
  args: BuildReminderEventArgs
): CommsEvent {
  if (!settings.enabled) {
    throw new Error(
      `clinic-reminder-settings: reminders disabled for ${settings.accountKey}; ` +
        `callers must check settings.enabled before building an event`
    );
  }

  const event: CommsEvent = {
    name: settings.eventType,
    category: 'appointments',
    idempotencyKey: `appt:${args.appointmentId}:reminder${settings.hoursBefore}h`,
    dedupWindowMinutes: settings.dedupWindowMinutes,
    accountKey: settings.accountKey,
    templateKey: args.overrides?.templateKey,
    templateVariables: args.overrides?.templateVariables,
    bypassCap: args.overrides?.bypassCap,
  };

  if (settings.preferredChannel) {
    event.preferredChannel = settings.preferredChannel;
  }

  return event;
}

/**
 * Decide whether an appointment with this start time is inside the reminder
 * window for the given cadence. Writers run this on each candidate appointment
 * to skip those outside the window.
 *
 * Window = [hoursBefore - tolerance, hoursBefore + tolerance], where the
 * default tolerance is 90 minutes — wide enough to absorb a 15-min cron cadence
 * plus retry jitter, narrow enough to keep "24h" feeling like 24h.
 *
 * The explicit idempotency_key (`appt:<id>:reminder<hours>h`) carries the
 * dedup guarantee — the window is just the trigger filter.
 */
export function isWithinReminderWindow(
  appointmentStartMs: number,
  hoursBefore: number,
  toleranceMinutes = 90,
  nowMs: number = Date.now()
): boolean {
  const targetMs = appointmentStartMs - hoursBefore * 60 * 60 * 1000;
  const tolMs = toleranceMinutes * 60 * 1000;
  return nowMs >= targetMs - tolMs && nowMs <= targetMs + tolMs;
}

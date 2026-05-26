import { query } from './db';

/**
 * Per-patient comms profile — the single read signal that drives channel
 * selection in lib/comms-gateway.ts (notifyPatient).
 *
 * Schema authored by sibling Phase-1 task (claude-task-28599a90):
 *   migrations/20260526_patient_comms_preferences.sql
 *
 * This file is the ONLY place in the gateway that talks to the
 * v_patient_comms_profile view / patient_comms_preferences table. If the
 * schema evolves, only this file needs updating.
 *
 * SAFETY rules baked in (per Phil 2026-05-26 design call):
 *   1. Clinical/lab content is NEVER auto-sent. Critical labs are phone-only,
 *      human-to-human. The BYPASSABLE_CATEGORIES map is the gate — only
 *      transactional categories (billing/payment failures) may bypass opt-out.
 *      Any clinical category MUST NOT appear in that map.
 *   2. Read-only API. No writers in Phase 1. The iPad edit UI comes later
 *      with the Comms tab.
 *   3. Whole gateway stack is gated off real patients until Phil signs off
 *      on testing. Phase 1 is read-only so it cannot trigger sends.
 *
 * Sibling-built gateway will swap from its current
 *   loadTokensForPatient + ad-hoc phone/email checks
 * to
 *   const profile = await getPatientCommsProfile(patient.patientId);
 *   if (profile.isSuppressed(channel, category)) ...
 * in a later phase.
 */

export type CommsChannel = 'push' | 'sms' | 'email' | 'voice';

export type CommsCategory =
  | 'billing'
  | 'results'
  | 'messages'
  | 'promotions'
  | 'appointments'
  | 'announcements';

/**
 * Categories that may be sent even when the patient has opted out of the
 * category (NOT the channel — channel opt-outs are always respected).
 *
 * RULE: only transactional categories with no clinical content. Phil
 * 2026-05-26: lab/clinical results are PHONE-ONLY and out of scope for the
 * automated gateway entirely. Do NOT add 'results' here.
 *
 * This set is intentionally conservative. Add to it ONLY after explicit
 * approval from Phil for a specific new category that is non-clinical.
 */
export const BYPASSABLE_CATEGORIES: ReadonlySet<CommsCategory> = new Set<CommsCategory>([
  'billing', // failed payments, expiring cards — operationally critical, non-clinical
]);

export interface AppState {
  installed: boolean;
  activeDeviceCount: number;
  lastSeenAt: Date | null;
  lastHeartbeatAt: Date | null;
  versionMax: string | null;
}

export interface ChannelEligibility {
  /** Can we physically reach the patient on this channel? (phone/email/token presence) */
  reachable: boolean;
  /** Has the patient opted out of this channel? */
  optedOut: boolean;
  /** reachable AND NOT optedOut */
  eligible: boolean;
}

export interface CommsProfile {
  patientId: string;
  healthieClientId: string | null;
  ghlContactId: string | null;
  phonePrimary: string | null;
  email: string | null;
  clinic: string | null;

  appState: AppState;
  channels: Record<CommsChannel, ChannelEligibility>;
  /** True = patient is willing to receive this category */
  allowsCategory: Record<CommsCategory, boolean>;

  prefsNotes: string | null;
  prefsUpdatedAt: Date | null;
  prefsUpdatedBy: string | null;

  /**
   * Should the gateway suppress a send on this (channel, category)?
   * Suppress when:
   *   - The channel is not eligible (unreachable OR opted out), OR
   *   - The patient has opted out of the category AND the category is not
   *     in BYPASSABLE_CATEGORIES.
   */
  isSuppressed(channel: CommsChannel, category: CommsCategory): boolean;

  /** Inverse of isSuppressed — convenience for caller readability. */
  canSend(channel: CommsChannel, category: CommsCategory): boolean;
}

interface ProfileRow {
  patient_id: string;
  healthie_client_id: string | null;
  ghl_contact_id: string | null;
  phone_primary: string | null;
  email: string | null;
  clinic: string | null;

  app_installed: boolean;
  active_device_count: number;
  push_last_seen_at: Date | null;
  push_last_heartbeat_at: Date | null;
  app_version_max: string | null;

  push_reachable: boolean;
  sms_reachable: boolean;
  email_reachable: boolean;
  voice_reachable: boolean;

  push_optout: boolean;
  sms_optout: boolean;
  email_optout: boolean;
  voice_optout: boolean;

  push_eligible: boolean;
  sms_eligible: boolean;
  email_eligible: boolean;
  voice_eligible: boolean;

  allow_billing: boolean;
  allow_results: boolean;
  allow_messages: boolean;
  allow_promotions: boolean;
  allow_appointments: boolean;
  allow_announcements: boolean;

  prefs_notes: string | null;
  prefs_updated_at: Date | null;
  prefs_updated_by: string | null;
}

const PROFILE_COLUMNS = `
  patient_id, healthie_client_id, ghl_contact_id, phone_primary, email, clinic,
  app_installed, active_device_count, push_last_seen_at, push_last_heartbeat_at, app_version_max,
  push_reachable, sms_reachable, email_reachable, voice_reachable,
  push_optout, sms_optout, email_optout, voice_optout,
  push_eligible, sms_eligible, email_eligible, voice_eligible,
  allow_billing, allow_results, allow_messages, allow_promotions, allow_appointments, allow_announcements,
  prefs_notes, prefs_updated_at, prefs_updated_by
`.trim();

function shapeProfile(row: ProfileRow): CommsProfile {
  const channels: Record<CommsChannel, ChannelEligibility> = {
    push: {
      reachable: row.push_reachable,
      optedOut: row.push_optout,
      eligible: row.push_eligible,
    },
    sms: {
      reachable: row.sms_reachable,
      optedOut: row.sms_optout,
      eligible: row.sms_eligible,
    },
    email: {
      reachable: row.email_reachable,
      optedOut: row.email_optout,
      eligible: row.email_eligible,
    },
    voice: {
      reachable: row.voice_reachable,
      optedOut: row.voice_optout,
      eligible: row.voice_eligible,
    },
  };

  const allowsCategory: Record<CommsCategory, boolean> = {
    billing: row.allow_billing,
    results: row.allow_results,
    messages: row.allow_messages,
    promotions: row.allow_promotions,
    appointments: row.allow_appointments,
    announcements: row.allow_announcements,
  };

  const profile: CommsProfile = {
    patientId: row.patient_id,
    healthieClientId: row.healthie_client_id,
    ghlContactId: row.ghl_contact_id,
    phonePrimary: row.phone_primary,
    email: row.email,
    clinic: row.clinic,

    appState: {
      installed: row.app_installed,
      activeDeviceCount: Number(row.active_device_count) || 0,
      lastSeenAt: row.push_last_seen_at,
      lastHeartbeatAt: row.push_last_heartbeat_at,
      versionMax: row.app_version_max,
    },
    channels,
    allowsCategory,

    prefsNotes: row.prefs_notes,
    prefsUpdatedAt: row.prefs_updated_at,
    prefsUpdatedBy: row.prefs_updated_by,

    isSuppressed(channel, category) {
      if (!channels[channel].eligible) return true;
      if (allowsCategory[category]) return false;
      return !BYPASSABLE_CATEGORIES.has(category);
    },
    canSend(channel, category) {
      return !profile.isSuppressed(channel, category);
    },
  };

  return profile;
}

/**
 * Read the comms profile for one patient. Returns null if no patient with
 * that id exists. Hits the v_patient_comms_profile view — single SELECT.
 */
export async function getPatientCommsProfile(patientId: string): Promise<CommsProfile | null> {
  const rows = await query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM v_patient_comms_profile WHERE patient_id = $1`,
    [patientId]
  );
  if (rows.length === 0) return null;
  return shapeProfile(rows[0]);
}

/**
 * Batch read for many patients (cron jobs, bulk preview). Returns a Map keyed
 * by patient_id; patients absent from the result are not present in the map.
 */
export async function getPatientCommsProfiles(
  patientIds: string[]
): Promise<Map<string, CommsProfile>> {
  if (patientIds.length === 0) return new Map();
  const rows = await query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM v_patient_comms_profile WHERE patient_id = ANY($1::uuid[])`,
    [patientIds]
  );
  const out = new Map<string, CommsProfile>();
  for (const row of rows) {
    out.set(row.patient_id, shapeProfile(row));
  }
  return out;
}

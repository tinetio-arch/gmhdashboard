import type { AccountKey } from './comms-ledger';
import type { CommsEvent, CommsPayload, GatewayChannel } from './comms-gateway';

/**
 * video_call_join — CommsEvent builder for the "join your video call" comms.
 *
 * Phase 3 of project "untangling-healthie-communications-from-healthie"
 * (dispatch row 20260526-192907-f4ba). Companion to `app/api/video/notify-join/route.ts`.
 *
 * Purpose
 *   When a provider is ready to start (or has started) a telehealth visit,
 *   the patient needs a "join now" prompt with a tappable link. Today Healthie's
 *   native machinery sends this. The Phase-3 goal is to route the same prompt
 *   through `notifyPatient()` so it (a) lands push-first when the patient has the
 *   mobile app, falling back to SMS then email; (b) carries a "secure join link"
 *   in every channel that can display one; (c) is logged to
 *   `patient_communications` for audit; (d) is hard-idempotent per
 *   `appt:<id>:video_join` so a double-tap of the iPad "Start Video" button
 *   collapses to one ledger row.
 *
 *   This helper does NOT send anything and does NOT know the join URL — the
 *   URL is Healthie- or Zoom-generated and is supplied by the caller (the iPad
 *   provider UI already fetches `session_id` + `generated_token` / `zoom_join_url`
 *   via `/api/ipad/patient?action=video_session`).
 */

export interface BuildVideoCallJoinArgs {
  /** Healthie appointment id (or any natural per-appointment key). */
  appointmentId: string | number;
  /**
   * The tappable URL we drop into SMS/email bodies and into the push `data.joinUrl`.
   * Must be absolute http(s) — typically the Healthie-hosted Vonage page or a Zoom
   * `zoom_join_url`. Validation throws on non-http(s) URLs to protect against
   * accidentally sending `null` / `undefined` / `app://` schemes.
   */
  joinUrl: string;
  /** Patient first name for friendly opening line. Optional. */
  patientFirstName?: string;
  /** Provider display name (e.g. "Dr. Whitten"). Defaults to "your provider". */
  providerName?: string;
  /** Clinic routing key — passed through to the ledger for per-brand reporting. */
  accountKey?: AccountKey;
  /** Appt start ISO, optional — surfaced as a template variable for future copy tweaks. */
  apptStartIso?: string;
  /**
   * Pin a specific channel. Default (omitted) = gateway default priority, which is
   * push → SMS → email. Task brief explicitly calls for "push-first" — that IS the
   * default, so most callers should leave this undefined.
   */
  preferredChannel?: GatewayChannel;
  /**
   * Soft-dedup window. Default 5 minutes — short, because the iPad provider may
   * legitimately re-trigger if the patient drops the call and needs a fresh prompt
   * outside the window. The hard idempotency key (`appt:<id>:video_join`) protects
   * against double-tap inside the same trigger.
   */
  dedupWindowMinutes?: number;
  /** Override template_key (e.g. for A/B testing future copy). */
  templateKey?: string;
  /** Override the template_variables stored in the ledger row. */
  templateVariables?: Record<string, unknown>;
}

export interface VideoCallJoinSpec {
  event: CommsEvent;
  payload: CommsPayload;
}

const EVENT_NAME = 'video_call_join';
const DEFAULT_DEDUP_MINUTES = 5;

function assertHttpUrl(url: unknown, field: string): asserts url is string {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error(`video-call-event: ${field} must be an absolute http(s) URL`);
  }
}

/**
 * Construct the CommsEvent + CommsPayload to pass into `notifyPatient()`.
 *
 *   - `event.name`             = `video_call_join`
 *   - `event.category`         = `appointments` (push opt-in bucket)
 *   - `event.idempotencyKey`   = `appt:<appointmentId>:video_join`
 *   - `event.dedupWindowMinutes` = 5 (overridable)
 *   - `event.accountKey`       = caller-supplied (the clinic)
 *
 *   Channels:
 *   - push: title + short body ("provider is ready — tap to join."). The URL is in
 *     `payload.data.joinUrl` so the mobile app can deep-link to its native video
 *     screen rather than opening a browser.
 *   - sms: body includes the URL inline ("Dr X is ready for your video visit. Join: <url>")
 *     because SMS has no other way to carry a tappable link.
 *   - email: longer body with the URL on its own line, signed "Granite Mountain Health".
 */
export function buildVideoCallJoinEvent(args: BuildVideoCallJoinArgs): VideoCallJoinSpec {
  if (args.appointmentId === undefined || args.appointmentId === null || args.appointmentId === '') {
    throw new Error('video-call-event: appointmentId required');
  }
  assertHttpUrl(args.joinUrl, 'joinUrl');

  const provider = (args.providerName ?? '').trim() || 'your provider';
  const firstName = (args.patientFirstName ?? '').trim();

  const titlePush = 'Your video visit is starting';
  const bodyPush = `${provider} is ready — tap to join.`;
  const bodySms =
    `${firstName ? firstName + ', ' : ''}${provider} is ready for your video visit. Join: ${args.joinUrl}`;
  const subjectEmail = `Join your video visit with ${provider}`;
  const bodyEmail =
    `Hi${firstName ? ' ' + firstName : ''},\n\n` +
    `${provider} is ready to start your video visit.\n\n` +
    `Join here: ${args.joinUrl}\n\n` +
    `— Granite Mountain Health`;

  const event: CommsEvent = {
    name: EVENT_NAME,
    category: 'appointments',
    idempotencyKey: `appt:${args.appointmentId}:video_join`,
    dedupWindowMinutes: args.dedupWindowMinutes ?? DEFAULT_DEDUP_MINUTES,
    accountKey: args.accountKey,
    templateKey: args.templateKey ?? `${EVENT_NAME}.v1`,
    templateVariables:
      args.templateVariables ?? {
        appointment_id: String(args.appointmentId),
        provider_name: provider,
        patient_first_name: firstName || null,
        appointment_start: args.apptStartIso ?? null,
        join_url: args.joinUrl,
      },
  };

  if (args.preferredChannel) {
    event.preferredChannel = args.preferredChannel;
  }

  const payload: CommsPayload = {
    title: titlePush,
    body: bodyPush,
    data: {
      type: 'video_call_join',
      appointmentId: String(args.appointmentId),
      joinUrl: args.joinUrl,
    },
    sms: { body: bodySms },
    email: { subject: subjectEmail, body: bodyEmail },
  };

  return { event, payload };
}

/**
 * POST /api/video/notify-join — push-first "join your video call" event.
 *
 * Phase 3 of project "untangling-healthie-communications-from-healthie"
 * (dispatch row 20260526-192907-f4ba). Companion to `lib/video-call-event.ts`.
 *
 * Routes the "join your video call" comms through `notifyPatient()`:
 *   push → SMS → email, hard-idempotent on `appt:<id>:video_join`,
 *   logged to `patient_communications`.
 *
 * Body
 *   {
 *     patient_id:          UUID                       (required)
 *     appointment_id:      string | number            (required, Healthie appt id)
 *     join_url:            string (absolute http/s)   (required — Healthie/Zoom hosted)
 *     patient_first_name:  string                     (optional)
 *     provider_name:       string                     (optional, defaults to "your provider")
 *     account_key:         mensHealth|primaryCare|abxtac  (optional, audit-only)
 *     appt_start_iso:      ISO timestamp              (optional, template var)
 *     preferred_channel:   push|sms|email             (optional; default = gateway priority)
 *   }
 *
 * Returns
 *   { success: true, dry_run: boolean, preview? | gateway? }
 *
 * SAFETY — DRY-RUN BY DEFAULT
 *   `VIDEO_JOIN_NOTIFY_DRY_RUN !== '0'` (default '1') → no `notifyPatient()` call,
 *   no ledger write, no patient contact. Returns the composed preview so callers
 *   (iPad provider UI, future cron) can verify the rendered copy + URL before
 *   Phil flips the flag. Phil's standing Phase-3/4 rule: "entire new comms stack
 *   stays gated off real patients until he signs off on testing".
 *
 *   `VIDEO_JOIN_NOTIFY_ENABLED=0` kills the endpoint entirely (returns 503).
 *
 *   `VIDEO_JOIN_NOTIFY_DRY_RUN=0` flips to live — at that point every send goes
 *   through the gateway's suppression layers (idempotency + dedup + cap) and is
 *   logged to `patient_communications`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { notifyPatient } from '@/lib/comms-gateway';
import type { AccountKey } from '@/lib/comms-ledger';
import { buildVideoCallJoinEvent } from '@/lib/video-call-event';

export const dynamic = 'force-dynamic';

const VALID_ACCOUNT_KEYS = new Set<AccountKey>(['mensHealth', 'primaryCare', 'abxtac']);
const VALID_CHANNELS = new Set(['push', 'sms', 'email']);

interface NotifyJoinBody {
  patient_id?: unknown;
  appointment_id?: unknown;
  join_url?: unknown;
  patient_first_name?: unknown;
  provider_name?: unknown;
  account_key?: unknown;
  appt_start_iso?: unknown;
  preferred_channel?: unknown;
}

function isStringOrNumber(v: unknown): v is string | number {
  return typeof v === 'string' || typeof v === 'number';
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw err;
  }

  if (process.env.VIDEO_JOIN_NOTIFY_ENABLED === '0') {
    return NextResponse.json(
      { error: 'video-join notify disabled by VIDEO_JOIN_NOTIFY_ENABLED=0' },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as NotifyJoinBody;

    if (typeof body.patient_id !== 'string' || !body.patient_id.trim()) {
      return NextResponse.json({ error: 'patient_id required (UUID string)' }, { status: 400 });
    }
    if (!isStringOrNumber(body.appointment_id) || String(body.appointment_id).trim() === '') {
      return NextResponse.json({ error: 'appointment_id required' }, { status: 400 });
    }
    if (typeof body.join_url !== 'string' || !body.join_url.trim()) {
      return NextResponse.json({ error: 'join_url required (absolute http(s) URL)' }, { status: 400 });
    }
    if (
      body.account_key !== undefined &&
      body.account_key !== null &&
      !VALID_ACCOUNT_KEYS.has(body.account_key as AccountKey)
    ) {
      return NextResponse.json(
        { error: `account_key must be one of: ${[...VALID_ACCOUNT_KEYS].join(', ')}` },
        { status: 400 }
      );
    }
    if (
      body.preferred_channel !== undefined &&
      body.preferred_channel !== null &&
      !VALID_CHANNELS.has(body.preferred_channel as string)
    ) {
      return NextResponse.json(
        { error: `preferred_channel must be one of: ${[...VALID_CHANNELS].join(', ')}` },
        { status: 400 }
      );
    }

    let spec;
    try {
      spec = buildVideoCallJoinEvent({
        appointmentId: body.appointment_id as string | number,
        joinUrl: body.join_url,
        patientFirstName: typeof body.patient_first_name === 'string' ? body.patient_first_name : undefined,
        providerName: typeof body.provider_name === 'string' ? body.provider_name : undefined,
        accountKey: body.account_key as AccountKey | undefined,
        apptStartIso: typeof body.appt_start_iso === 'string' ? body.appt_start_iso : undefined,
        preferredChannel: body.preferred_channel as 'push' | 'sms' | 'email' | undefined,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    const dryRun = process.env.VIDEO_JOIN_NOTIFY_DRY_RUN !== '0';

    if (dryRun) {
      console.log('[VideoJoinNotify] DRY-RUN', {
        patient_id: body.patient_id,
        appointment_id: String(body.appointment_id),
        account_key: spec.event.accountKey ?? null,
        event_name: spec.event.name,
        idempotency_key: spec.event.idempotencyKey,
        preferred_channel: spec.event.preferredChannel ?? null,
        title: spec.payload.title,
        push_body: spec.payload.body,
        sms_body: spec.payload.sms?.body,
        email_subject: spec.payload.email?.subject,
        join_url: body.join_url,
      });
      return NextResponse.json({
        success: true,
        dry_run: true,
        preview: {
          event: spec.event,
          payload: spec.payload,
        },
      });
    }

    const result = await notifyPatient(body.patient_id, spec.event, spec.payload, {
      source: 'api:video.notify-join',
      actorId: user.user_id,
    });

    return NextResponse.json({
      success: true,
      dry_run: false,
      gateway: result,
    });
  } catch (err) {
    console.error('[VideoJoinNotify] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createGHLClientForABXTAC } from '@/lib/ghl';
import { healthieGraphQL } from '@/lib/healthieApi';
import { notifyPatient, type CommsEvent, type CommsPayload, type NotifyResult } from '@/lib/comms-gateway';

/**
 * Healthie Appointment Updated Webhook
 *
 * Triggered when: appointment.created / appointment.updated / appointment.deleted
 * events fire in Healthie. Currently subscribed to the latter two; appointment.created
 * deliveries are handled here too if/when subscribed.
 *
 * Two behaviors live in this route:
 *
 *   1. LEGACY (untouched) — GHL custom-field + tag writes that drive existing
 *      ABXTAC GoHighLevel workflows for cancel / reschedule / completion.
 *      This is the current production path and stays put until later phases
 *      retire the GHL workflows.
 *
 *   2. NEW — Phase 2 of `untangling-healthie-communications-from-healthie`
 *      (dispatch row 20260526-192902-133c). Each lifecycle transition also
 *      routes through `notifyPatient()` with branded ABXTAC templates:
 *        - booking confirmed  → `appointment_booking_confirmed`
 *        - rescheduled        → `appointment_rescheduled`
 *        - cancelled          → `appointment_canceled`
 *      Hard idempotency keys (`appt:<id>:booking_confirmed`, etc.) collapse
 *      duplicate Healthie webhook deliveries to a single ledger entry.
 *
 *      Per Phil's standing rule "the entire new comms stack stays gated off
 *      real patients until he signs off on testing", the gateway path is
 *      DRY-RUN by default. Set `ABXTAC_APPT_COMMS_DRY_RUN=0` in `.env.local`
 *      to enable real sends. Dry-run logs the full preview via `console.log`
 *      with `[ABXTAC Appt Comms]` prefix — Phil can `pm2 logs gmh-dashboard
 *      | grep '\[ABXTAC Appt Comms\] DRY-RUN'` to audit before flipping.
 *      `ABXTAC_APPT_COMMS_ENABLED=0` kills the gateway path entirely (legacy
 *      GHL writes still run).
 *
 * Healthie Webhook Setup:
 * 1. Go to Healthie Settings → Developer → Webhooks
 * 2. Add endpoint: https://nowoptimal.com/ops/api/webhooks/healthie/appointment-updated
 * 3. Select events: appointment.created, appointment.updated, appointment.deleted
 */

const ABXTAC_APPOINTMENT_TYPE_ID = process.env.ABXTAC_APPOINTMENT_TYPE_ID || '';
const ARIZONA_TZ = 'America/Phoenix';
const ABXTAC_ACCOUNT_KEY = 'abxtac' as const;

interface AppointmentWebhookPayload {
  event_type?: string;
  resource_id?: string;
  resource?: {
    id: string;
    date?: string;
    pm_status?: string;
    appointment_type_id?: string;
    attendees?: Array<{ id: string; email?: string }>;
    user_id?: string;
    other_party_id?: string;
  };
}

type LifecycleKind = 'booking_confirmed' | 'rescheduled' | 'canceled' | 'completed' | 'other';

function classifyStatus(pmStatus: string | null | undefined, eventType: string | undefined): LifecycleKind {
  if (eventType === 'appointment.deleted') return 'canceled';
  const s = (pmStatus || '').toLowerCase().trim();
  if (s === 'cancelled' || s === 'canceled') return 'canceled';
  if (s === 'rescheduled') return 'rescheduled';
  if (s === 'occurred' || s === 'completed') return 'completed';
  if (s === 'no show' || s === 'noshow' || s === 'no-show') return 'other';
  // empty / 'none' / 'confirmed' / 'pending' / 'pending confirmation' / 'booked' → booking-like
  return 'booking_confirmed';
}

export async function POST(request: NextRequest) {
  try {
    const body: AppointmentWebhookPayload = await request.json();
    const appointmentId = body.resource_id || body.resource?.id;

    if (!appointmentId) {
      return NextResponse.json({ skipped: true, reason: 'no appointment id' });
    }

    // Fetch full appointment details from Healthie
    const apptData = await healthieGraphQL<{
      appointment: {
        id: string;
        date: string;
        pm_status: string;
        appointment_type_id: string;
        user_id: string;
        other_party_id: string;
        attendees: Array<{ id: string; email: string; first_name: string; last_name: string }>;
        provider?: { first_name?: string; last_name?: string } | null;
        appointment_type?: { name?: string } | null;
      } | null;
    }>(`
      query GetAppointment($id: ID) {
        appointment(id: $id) {
          id date pm_status appointment_type_id user_id other_party_id
          attendees { id email first_name last_name }
          provider { first_name last_name }
          appointment_type { name }
        }
      }
    `, { id: appointmentId });

    const appointment = apptData.appointment;
    if (!appointment) {
      return NextResponse.json({ skipped: true, reason: 'appointment not found' });
    }

    // Only process ABXTAC appointments
    if (appointment.appointment_type_id !== ABXTAC_APPOINTMENT_TYPE_ID) {
      return NextResponse.json({ skipped: true, reason: 'not ABXTAC appointment type' });
    }

    // Find the patient (attendee, not the provider)
    const patientHealthieId = appointment.user_id;
    if (!patientHealthieId) {
      return NextResponse.json({ skipped: true, reason: 'no patient on appointment' });
    }

    // Get patient row from dashboard
    const [patient] = await query<{
      patient_id: string;
      ghl_contact_id: string | null;
      email: string | null;
      patient_name: string | null;
    }>(
      `SELECT patient_id::text AS patient_id, ghl_contact_id, email, patient_name
         FROM patients
        WHERE healthie_client_id = $1
        LIMIT 1`,
      [patientHealthieId]
    );

    if (!patient) {
      console.log(`[ABXTAC Webhook] No dashboard patient for Healthie ${patientHealthieId} — skipping`);
      return NextResponse.json({ skipped: true, reason: 'no dashboard patient' });
    }

    const ghl = createGHLClientForABXTAC();
    const status = appointment.pm_status;
    const contactId = patient.ghl_contact_id;
    const lifecycle = classifyStatus(status, body.event_type);

    // Format appointment date/time for templates
    const apptDt = new Date(appointment.date);
    const dateStr = apptDt.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: ARIZONA_TZ,
    });
    const timeStr = apptDt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ARIZONA_TZ,
    });
    const providerName = appointment.provider
      ? `${appointment.provider.first_name || ''} ${appointment.provider.last_name || ''}`.trim() || 'your ABXTAC provider'
      : 'your ABXTAC provider';
    const apptTypeName = appointment.appointment_type?.name || 'ABXTAC consult';
    const firstName = appointment.attendees?.[0]?.first_name || (patient.patient_name || '').split(' ')[0] || 'there';

    // ───────────────────────────────────────────────────────────────
    // LEGACY: GHL custom fields + tags (unchanged production path)
    // ───────────────────────────────────────────────────────────────
    if (ghl && contactId) {
      if (lifecycle === 'canceled') {
        await ghl.updateCustomField(contactId, 'appointment_status', 'Cancelled').catch(() => {});
        await ghl.addTag(contactId, 'Appointment Cancelled');
        console.log(`[ABXTAC Webhook] Appointment ${appointmentId} cancelled — GHL tag added for ${patient.email}`);
      } else if (lifecycle === 'rescheduled') {
        await ghl.updateCustomField(contactId, 'appointment_date', dateStr).catch(() => {});
        await ghl.updateCustomField(contactId, 'appointment_time', timeStr).catch(() => {});
        await ghl.updateCustomField(contactId, 'appointment_status', 'Rescheduled').catch(() => {});
        await ghl.addTag(contactId, 'Appointment Rescheduled');
        console.log(`[ABXTAC Webhook] Appointment ${appointmentId} rescheduled to ${dateStr} ${timeStr} — GHL tag added`);
      } else if (lifecycle === 'completed') {
        await ghl.updateCustomField(contactId, 'appointment_status', 'Completed').catch(() => {});
        await ghl.addTag(contactId, 'Consult Completed');
        console.log(`[ABXTAC Webhook] Appointment ${appointmentId} completed — GHL tag added for post-visit workflow`);
      } else {
        // booking_confirmed / other catch-all
        await ghl.updateCustomField(contactId, 'appointment_status', status || 'Confirmed').catch(() => {});
        console.log(`[ABXTAC Webhook] Appointment ${appointmentId} status: ${status} — GHL custom field updated`);
      }
    }

    // ───────────────────────────────────────────────────────────────
    // NEW: Gateway path — branded ABXTAC comms via notifyPatient()
    // Dry-run by default; legacy GHL above already ran regardless.
    // ───────────────────────────────────────────────────────────────
    let gatewayResult: { lifecycle: LifecycleKind; status: 'skipped' | 'dry_run' | NotifyResult['status']; reason?: string; ledger_id?: string; channel?: string | null } | null = null;

    if (process.env.ABXTAC_APPT_COMMS_ENABLED === '0') {
      gatewayResult = { lifecycle, status: 'skipped', reason: 'gateway path disabled by env' };
    } else if (lifecycle === 'completed' || lifecycle === 'other') {
      gatewayResult = { lifecycle, status: 'skipped', reason: `no comms for lifecycle=${lifecycle}` };
    } else {
      const dryRun = process.env.ABXTAC_APPT_COMMS_DRY_RUN !== '0';
      const built = buildGatewayCall(lifecycle, {
        appointmentId,
        firstName,
        providerName,
        apptTypeName,
        dateStr,
        timeStr,
      });

      if (dryRun) {
        console.log('[ABXTAC Appt Comms] DRY-RUN', JSON.stringify({
          patient_id: patient.patient_id,
          healthie_client_id: patientHealthieId,
          appointment_id: appointmentId,
          appointment_at: appointment.date,
          lifecycle,
          account_key: ABXTAC_ACCOUNT_KEY,
          event_name: built.event.name,
          idempotency_key: built.event.idempotencyKey,
          title: built.payload.title,
          push_body: built.payload.push?.body || built.payload.body,
          sms_body: built.payload.sms?.body || built.payload.body,
          email_subject: built.payload.email?.subject,
        }));
        gatewayResult = { lifecycle, status: 'dry_run' };
      } else {
        try {
          const result = await notifyPatient(
            patient.patient_id,
            built.event,
            built.payload,
            { source: 'webhook:healthie:appointment-updated' }
          );
          gatewayResult = {
            lifecycle,
            status: result.status,
            ledger_id: result.ledgerId,
            channel: result.channel,
          };
          console.log(`[ABXTAC Appt Comms] ${lifecycle} → notifyPatient: status=${result.status} channel=${result.channel} ledger=${result.ledgerId}`);
        } catch (err: any) {
          // Never let gateway failure 500 the webhook — Healthie would retry forever.
          gatewayResult = { lifecycle, status: 'skipped', reason: `gateway error: ${err?.message || err}` };
          console.error(`[ABXTAC Appt Comms] notifyPatient threw for appt ${appointmentId}:`, err?.message || err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      appointment_id: appointmentId,
      status,
      lifecycle,
      gateway: gatewayResult,
    });

  } catch (error: any) {
    console.error('[ABXTAC Webhook] Error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

interface GatewayCallInputs {
  appointmentId: string;
  firstName: string;
  providerName: string;
  apptTypeName: string;
  dateStr: string;
  timeStr: string;
}

function buildGatewayCall(
  lifecycle: 'booking_confirmed' | 'rescheduled' | 'canceled',
  inp: GatewayCallInputs
): { event: CommsEvent; payload: CommsPayload } {
  const { appointmentId, firstName, providerName, apptTypeName, dateStr, timeStr } = inp;
  const templateVariables = {
    first_name: firstName,
    provider_name: providerName,
    appt_type: apptTypeName,
    appt_date: dateStr,
    appt_time: timeStr,
  };

  if (lifecycle === 'booking_confirmed') {
    return {
      event: {
        name: 'appointment_booking_confirmed',
        category: 'appointments',
        idempotencyKey: `appt:${appointmentId}:booking_confirmed`,
        dedupWindowMinutes: 0,
        accountKey: ABXTAC_ACCOUNT_KEY,
        templateKey: 'abxtac_appt_booking_confirmed.v1',
        templateVariables,
      },
      payload: {
        title: 'Your ABXTAC consult is confirmed',
        body: `Your ${apptTypeName} with ${providerName} is confirmed for ${dateStr} at ${timeStr}.`,
        data: { type: 'appointment_booking_confirmed', appointmentId },
        push: {
          title: 'Appointment confirmed',
          body: `${apptTypeName} with ${providerName} on ${dateStr} at ${timeStr}.`,
        },
        sms: {
          body: `Hi ${firstName}, your ABXTAC consult with ${providerName} is confirmed for ${dateStr} at ${timeStr}. Reply STOP to opt out.`,
        },
        email: {
          subject: 'Your ABXTAC consult is confirmed',
          body:
            `Hi ${firstName},\n\n` +
            `Your ABXTAC consult with ${providerName} is confirmed for ${dateStr} at ${timeStr}.\n\n` +
            `You'll receive a separate reminder before your visit. If you need to reschedule, reply to this email or use the link in your portal.\n\n` +
            `— ABXTAC`,
        },
      },
    };
  }

  if (lifecycle === 'rescheduled') {
    // Include date in the key so a second reschedule re-fires; but keep the basic
    // key shape predictable so ops can search for it.
    const dateKey = dateStr.replace(/[^0-9A-Za-z]/g, '').slice(0, 24);
    return {
      event: {
        name: 'appointment_rescheduled',
        category: 'appointments',
        idempotencyKey: `appt:${appointmentId}:rescheduled:${dateKey}`,
        dedupWindowMinutes: 0,
        accountKey: ABXTAC_ACCOUNT_KEY,
        templateKey: 'abxtac_appt_rescheduled.v1',
        templateVariables,
      },
      payload: {
        title: 'Your ABXTAC consult was rescheduled',
        body: `Your ${apptTypeName} has been rescheduled to ${dateStr} at ${timeStr}.`,
        data: { type: 'appointment_rescheduled', appointmentId },
        push: {
          title: 'Appointment rescheduled',
          body: `Now ${dateStr} at ${timeStr} with ${providerName}.`,
        },
        sms: {
          body: `Hi ${firstName}, your ABXTAC consult has been rescheduled to ${dateStr} at ${timeStr}. Reply STOP to opt out.`,
        },
        email: {
          subject: 'Your ABXTAC consult was rescheduled',
          body:
            `Hi ${firstName},\n\n` +
            `Your ABXTAC consult with ${providerName} has been rescheduled to ${dateStr} at ${timeStr}.\n\n` +
            `If this new time doesn't work, reply to this email or use the link in your portal.\n\n` +
            `— ABXTAC`,
        },
      },
    };
  }

  // canceled
  return {
    event: {
      name: 'appointment_canceled',
      category: 'appointments',
      idempotencyKey: `appt:${appointmentId}:canceled`,
      dedupWindowMinutes: 0,
      accountKey: ABXTAC_ACCOUNT_KEY,
      templateKey: 'abxtac_appt_canceled.v1',
      templateVariables,
    },
    payload: {
      title: 'Your ABXTAC consult was cancelled',
      body: `Your ${apptTypeName} on ${dateStr} at ${timeStr} has been cancelled.`,
      data: { type: 'appointment_canceled', appointmentId },
      push: {
        title: 'Appointment cancelled',
        body: `${apptTypeName} on ${dateStr} cancelled.`,
      },
      sms: {
        body: `Hi ${firstName}, your ABXTAC consult on ${dateStr} at ${timeStr} has been cancelled. To rebook, visit abxtac.com or reply to this message. Reply STOP to opt out.`,
      },
      email: {
        subject: 'Your ABXTAC consult was cancelled',
        body:
          `Hi ${firstName},\n\n` +
          `Your ABXTAC consult with ${providerName} on ${dateStr} at ${timeStr} has been cancelled.\n\n` +
          `If this was a mistake or you'd like to rebook, reply to this email or visit abxtac.com.\n\n` +
          `— ABXTAC`,
      },
    },
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createGHLClientForABXTAC } from '@/lib/ghl';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * Healthie Appointment Updated Webhook
 *
 * Triggered when: appointment.updated event fires in Healthie
 * Purpose: Detect cancellation/reschedule for ABXTAC appointments → update GHL tags
 *          so GHL workflows send branded ABXTAC emails/SMS.
 *
 * Healthie Webhook Setup:
 * 1. Go to Healthie Settings → Developer → Webhooks
 * 2. Add endpoint: https://nowoptimal.com/ops/api/webhooks/healthie/appointment-updated
 * 3. Select events: appointment.updated, appointment.deleted
 */

const ABXTAC_GROUP_ID = '82534';
const ABXTAC_APPOINTMENT_TYPE_ID = process.env.ABXTAC_APPOINTMENT_TYPE_ID || '';
const ARIZONA_TZ = 'America/Phoenix';

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
      } | null;
    }>(`
      query GetAppointment($id: ID) {
        appointment(id: $id) {
          id date pm_status appointment_type_id user_id other_party_id
          attendees { id email first_name last_name }
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

    // Get GHL contact ID from dashboard
    const [patient] = await query<{ ghl_contact_id: string | null; email: string }>(
      `SELECT ghl_contact_id, email FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
      [patientHealthieId]
    );

    if (!patient?.ghl_contact_id) {
      console.log(`[ABXTAC Webhook] No GHL contact for Healthie patient ${patientHealthieId} — skipping`);
      return NextResponse.json({ skipped: true, reason: 'no GHL contact linked' });
    }

    const ghl = createGHLClientForABXTAC();
    if (!ghl) {
      return NextResponse.json({ skipped: true, reason: 'GHL not configured' });
    }

    const status = appointment.pm_status;
    const contactId = patient.ghl_contact_id;

    // Format appointment date/time for templates
    const apptDt = new Date(appointment.date);
    const dateStr = apptDt.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: ARIZONA_TZ,
    });
    const timeStr = apptDt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ARIZONA_TZ,
    });

    if (status === 'Cancelled' || status === 'cancelled') {
      // ── CANCELLATION ─────────────────────────────────────────
      await ghl.updateCustomField(contactId, 'appointment_status', 'Cancelled').catch(() => {});
      await ghl.addTag(contactId, 'Appointment Cancelled');
      console.log(`[ABXTAC Webhook] Appointment ${appointmentId} cancelled — GHL tag added for ${patient.email}`);

    } else if (status === 'Rescheduled' || status === 'rescheduled') {
      // ── RESCHEDULE ───────────────────────────────────────────
      await ghl.updateCustomField(contactId, 'appointment_date', dateStr).catch(() => {});
      await ghl.updateCustomField(contactId, 'appointment_time', timeStr).catch(() => {});
      await ghl.updateCustomField(contactId, 'appointment_status', 'Rescheduled').catch(() => {});
      await ghl.addTag(contactId, 'Appointment Rescheduled');
      console.log(`[ABXTAC Webhook] Appointment ${appointmentId} rescheduled to ${dateStr} ${timeStr} — GHL tag added`);

    } else if (status === 'Occurred' || status === 'occurred' || status === 'Completed') {
      // ── COMPLETED ────────────────────────────────────────────
      await ghl.updateCustomField(contactId, 'appointment_status', 'Completed').catch(() => {});
      await ghl.addTag(contactId, 'Consult Completed');
      console.log(`[ABXTAC Webhook] Appointment ${appointmentId} completed — GHL tag added for post-visit workflow`);

    } else {
      // ── OTHER STATUS (confirmed, no-show, etc.) ──────────────
      await ghl.updateCustomField(contactId, 'appointment_status', status).catch(() => {});
      console.log(`[ABXTAC Webhook] Appointment ${appointmentId} status: ${status} — custom field updated`);
    }

    return NextResponse.json({ success: true, appointment_id: appointmentId, status });

  } catch (error: any) {
    console.error('[ABXTAC Webhook] Error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

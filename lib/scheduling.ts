import { healthieGraphQL } from './healthieApi';
import { patientsService } from './patients';

/**
 * Scheduling domain module
 * ------------------------
 * Creates/reschedules/cancels appointments in Healthie EHR.
 *
 * MIGRATED (2026-03-25): Switched from GHL calendar to Healthie GraphQL.
 * GHL is no longer used for scheduling — only for CRM/SMS.
 */

// Default provider: Dr. Aaron Whitten
const DEFAULT_PROVIDER_ID = '12093125';

export type AppointmentDetails = {
  patientId: string;
  /** Healthie appointment_type_id (e.g. '504725' for Initial Male HRT Consult) */
  appointmentTypeId?: string;
  /** Healthie provider ID (defaults to Dr. Whitten 12093125) */
  providerId?: string;
  startAt: string; // ISO8601
  endAt?: string;
  notes?: string;
  location?: string;
  contactType?: string;
};

export type AppointmentRecord = AppointmentDetails & {
  appointmentId: string;
  status: string;
};

export interface SchedulingService {
  schedule(details: AppointmentDetails): Promise<AppointmentRecord>;
  reschedule(appointmentId: string, newDetails: Partial<AppointmentDetails>): Promise<void>;
  cancel(appointmentId: string, reason?: string): Promise<void>;
}

export const schedulingService: SchedulingService = {
  async schedule(details) {
    const patient = await patientsService.getById(details.patientId);
    if (!patient) {
      throw new Error(`Patient ${details.patientId} not found.`);
    }

    // Resolve Healthie client ID
    const healthieClientId = (patient as any).healthie_client_id;
    if (!healthieClientId) {
      throw new Error(`Patient ${details.patientId} has no Healthie client ID. Cannot create appointment.`);
    }

    const providerId = details.providerId || DEFAULT_PROVIDER_ID;

    const data = await healthieGraphQL<{
      createAppointment: {
        appointment: { id: string; date: string } | null;
        messages: Array<{ field: string; message: string }>;
      };
    }>(`
      mutation CreateAppointment(
        $patientId: String!,
        $providerId: String!,
        $typeId: String!,
        $datetime: String!,
        $notes: String,
        $location: String,
        $contactType: String
      ) {
        createAppointment(input: {
          user_id: $patientId,
          other_party_id: $providerId,
          appointment_type_id: $typeId,
          datetime: $datetime,
          notes: $notes,
          location: $location,
          contact_type: $contactType
        }) {
          appointment { id date }
          messages { field message }
        }
      }
    `, {
      patientId: healthieClientId,
      providerId,
      typeId: details.appointmentTypeId || '511073', // Fallback: Migrated Appointment type
      datetime: details.startAt,
      notes: details.notes || null,
      location: details.location || null,
      contactType: details.contactType || null,
    });

    if (data.createAppointment?.messages?.length) {
      const errMsg = data.createAppointment.messages.map(m => m.message).join(', ');
      throw new Error(`Healthie createAppointment failed: ${errMsg}`);
    }

    const appt = data.createAppointment?.appointment;
    if (!appt) {
      throw new Error('Healthie createAppointment returned no appointment.');
    }

    console.log(`[scheduling] Created Healthie appointment ${appt.id} for patient ${details.patientId}`);

    return {
      ...details,
      appointmentId: appt.id,
      status: 'scheduled',
    };
  },

  async reschedule(appointmentId, newDetails) {
    const variables: Record<string, unknown> = { id: appointmentId };
    if (newDetails.startAt) variables.datetime = newDetails.startAt;
    if (newDetails.notes) variables.notes = newDetails.notes;
    if (newDetails.providerId) variables.other_party_id = newDetails.providerId;

    if (Object.keys(variables).length <= 1) {
      return; // Nothing to update besides ID
    }

    await healthieGraphQL(`
      mutation RescheduleAppointment($input: updateAppointmentInput!) {
        updateAppointment(input: $input) {
          appointment { id date }
          messages { field message }
        }
      }
    `, { input: variables });

    console.log(`[scheduling] Rescheduled Healthie appointment ${appointmentId}`);
  },

  async cancel(appointmentId, reason) {
    await healthieGraphQL(`
      mutation CancelAppointment($input: updateAppointmentInput!) {
        updateAppointment(input: $input) {
          appointment { id pm_status }
          messages { field message }
        }
      }
    `, {
      input: {
        id: appointmentId,
        pm_status: 'Cancelled',
        other_cancellation_reason: reason || undefined,
      },
    });

    console.log(`[scheduling] Cancelled Healthie appointment ${appointmentId}${reason ? ': ' + reason : ''}`);
  },
};

import { createGHLClient } from './ghl';
import { patientsService } from './patients';

/**
 * Scheduling domain module
 * ------------------------
 * Abstracts GoHighLevel appointment creation/rescheduling so higher layers
 * can request follow-ups without dealing with raw API payloads.
 */

export type AppointmentDetails = {
  patientId: string;
  calendarId: string;
  appointmentTypeId?: string;
  startAt: string; // ISO8601
  endAt?: string;
  notes?: string;
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

function requireGhl() {
  const client = createGHLClient();
  if (!client) {
    throw new Error('GHL client not configured.');
  }
  return client;
}

export const schedulingService: SchedulingService = {
  async schedule(details) {
    const ghlClient = requireGhl();
    const patient = await patientsService.getById(details.patientId);
    if (!patient) {
      throw new Error(`Patient ${details.patientId} not found.`);
    }
    const contactId = await patientsService.ensureGhlContact(details.patientId);

    const response = await ghlClient.createAppointment({
      contactId,
      calendarId: details.calendarId,
      appointmentTypeId: details.appointmentTypeId,
      startTime: details.startAt,
      endTime: details.endAt,
      notes: details.notes,
    });

    return {
      ...details,
      appointmentId: response.id,
      status: 'scheduled',
    };
  },

  async reschedule(appointmentId, newDetails) {
    const ghlClient = requireGhl();
    const updates: Record<string, unknown> = {};
    if (newDetails.startAt) updates.startTime = newDetails.startAt;
    if (newDetails.endAt) updates.endTime = newDetails.endAt;
    if (newDetails.notes) updates.notes = newDetails.notes;

    if (Object.keys(updates).length === 0) {
      return;
    }

    await ghlClient.rescheduleAppointment(appointmentId, updates);
  },

  async cancel(appointmentId, reason) {
    const ghlClient = requireGhl();
    await ghlClient.cancelAppointment(appointmentId);
    if (reason) {
      console.info(`[scheduling] Appointment ${appointmentId} cancelled: ${reason}`);
    }
  },
};


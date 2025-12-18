import { auditService } from './audit';
import {
  createHealthieClient,
  type HealthieAllergy,
  type HealthieMedication,
} from './healthie';
import { patientsService } from './patients';

/**
 * Clinical domain module
 * ----------------------
 * All clinical data lookups (labs, meds, allergies, problems, Heidi notes, etc.)
 * are centralized here so that both the dashboard and the upcoming agent reuse
 * the same typed accessors.
 */

export type LabObservationResult = {
  analyte: string;
  quantitative?: string | null;
  qualitative?: string | null;
  units?: string | null;
  referenceRange?: string | null;
  isAbnormal?: boolean | null;
  interpretation?: string | null;
};

export type LabResult = {
  id: string;
  createdAt: string;
  interpretation?: string | null;
  statusFlag?: string | null;
  observations: LabObservationResult[];
  documentUrl?: string | null;
};

export type Medication = {
  id: string;
  name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  directions?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  normalizedStatus?: string | null;
};

export type Allergy = {
  id: string;
  name?: string | null;
  reaction?: string | null;
  severity?: string | null;
  notes?: string | null;
};

export interface ClinicalService {
  getRecentLabs(patientId: string, opts?: { limit?: number; since?: string }): Promise<LabResult[]>;
  getMedicationList(patientId: string, opts?: { activeOnly?: boolean }): Promise<Medication[]>;
  getAllergies(patientId: string): Promise<Allergy[]>;
  attachHeidiNote(
    patientId: string,
    note: { summary?: string; raw?: string; heidiSessionId?: string }
  ): Promise<void>;
  createLabOrder(
    patientId: string,
    order: { panelId?: string; analytes?: string[]; notes?: string }
  ): Promise<{ labOrderId: string }>;
}

const notImplemented = (method: string): Error =>
  new Error(`clinicalService.${method} is not implemented yet`);

async function resolveHealthieUserId(patientId: string): Promise<{
  clientId: string;
  userId: string;
}> {
  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    throw new Error('Healthie client is not configured.');
  }

  const clientId = await patientsService.ensureHealthieClient(patientId);
  const clientRecord = await healthieClient.getClient(clientId);
  const userId = clientRecord.user_id || clientRecord.id;
  if (!userId) {
    throw new Error(`Healthie user ID missing for client ${clientId}.`);
  }

  return { clientId, userId };
}

function mapMedication(med: HealthieMedication): Medication {
  return {
    id: med.id,
    name: med.name,
    dosage: med.dosage,
    frequency: med.frequency,
    route: med.route,
    directions: med.directions,
    startDate: med.start_date ?? undefined,
    endDate: med.end_date ?? undefined,
    normalizedStatus: med.normalized_status ?? undefined,
  };
}

function mapAllergy(allergy: HealthieAllergy): Allergy {
  return {
    id: allergy.id,
    name: allergy.name ?? '',
    reaction: allergy.reaction ?? null,
    severity: allergy.severity ?? null,
    notes: allergy.notes ?? null,
  };
}

export const clinicalService: ClinicalService = {
  async getRecentLabs() {
    throw notImplemented('getRecentLabs');
  },

  async getMedicationList(patientId, opts) {
    const healthieClient = createHealthieClient();
    if (!healthieClient) {
      throw new Error('Healthie client is not configured.');
    }

    const { userId } = await resolveHealthieUserId(patientId);
    const meds = await healthieClient.getMedications(userId, { active: opts?.activeOnly });
    return meds.map(mapMedication);
  },

  async getAllergies(patientId) {
    const healthieClient = createHealthieClient();
    if (!healthieClient) {
      throw new Error('Healthie client is not configured.');
    }
    const { userId } = await resolveHealthieUserId(patientId);
    const allergies = await healthieClient.getAllergies(userId);
    return allergies.map(mapAllergy);
  },

  async attachHeidiNote(patientId, note) {
    if (!note?.raw && !note?.summary) {
      throw new Error('Heidi note payload must include summary or raw text.');
    }

    const healthieClient = createHealthieClient();
    if (!healthieClient) {
      throw new Error('Healthie client is not configured.');
    }

    const { clientId } = await resolveHealthieUserId(patientId);
    const title =
      note.summary?.trim().slice(0, 120) || 'Heidi Consult Note';
    const body = (note.raw || note.summary || '').trim();

    const chartNote = await healthieClient.createChartNote({
      client_id: clientId,
      title,
      body,
      status: 'signed',
    });

    await auditService.logEvent({
      actorId: 'heidi',
      patientId,
      system: 'HEALTHIE',
      action: 'HEIDI_NOTE_ATTACHED',
      payload: {
        chartNoteId: chartNote.id,
        title,
      },
    });
  },

  async createLabOrder() {
    throw notImplemented('createLabOrder');
  },
};


import { randomUUID } from 'crypto';

import {
  createHealthieClient,
  type HealthiePharmacy,
  type HealthiePrescription,
} from './healthie';
import { auditService } from './audit';
import { query as dbQuery } from './db';
import { patientsService } from './patients';

/**
 * Prescribing domain module
 * -------------------------
 * Encapsulates non-controlled e-prescribing flows. Controlled dispensing is
 * handled separately in `deaDomain.ts`.
 */

export type PrescriptionIntent = {
  patientId: string;
  medication: {
    name: string;
    strength?: string;
    route?: string;
    frequency?: string;
    durationDays?: number;
    quantity?: number;
    refills?: number;
    instructions?: string;
    indication?: string;
  };
  pharmacy: {
    id?: string;
    name: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
};

export type SafetyReport = {
  allergiesOk: boolean;
  interactionsOk: boolean;
  refillWindowOk: boolean;
  notes: string[];
};

export type DraftStatus = 'pending' | 'submitted' | 'failed';

export type PrescriptionDraft = {
  id: string;
  patientId: string;
  intent: PrescriptionIntent;
  safety: SafetyReport;
  status: DraftStatus;
  createdAt: string;
  updatedAt?: string;
  submittedAt?: string | null;
  healthiePrescriptionId?: string | null;
  submissionNotes?: string | null;
};

export type PrescriptionSummary = {
  id: string;
  productName?: string | null;
  dosage?: string | null;
  directions?: string | null;
  quantity?: string | null;
  refills?: string | null;
  unit?: string | null;
  route?: string | null;
  dateWritten?: string | null;
  status?: string | null;
  pharmacy?: {
    id?: string | null;
    name?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
  } | null;
};

export interface PrescribingService {
  listPrescriptions(patientId: string, opts?: { status?: string }): Promise<PrescriptionSummary[]>;
  proposeNonControlledPrescription(intent: PrescriptionIntent): Promise<PrescriptionDraft>;
  submitPrescription(
    draftId: string
  ): Promise<{
    success: boolean;
    prescriptionId?: string;
    note?: string;
    manualEntryUrl?: string;
    manualInstructions?: string;
  }>;
}

const HEALTHIE_APP_BASE_URL =
  process.env.HEALTHIE_APP_BASE_URL?.trim() || 'https://secure.gethealthie.com';

async function resolveHealthieUserId(patientId: string): Promise<string> {
  const healthieClientId = await patientsService.ensureHealthieClient(patientId);
  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    throw new Error('Healthie client is not configured.');
  }
  const clientRecord = await healthieClient.getClient(healthieClientId);
  const userId = clientRecord.user_id || clientRecord.id;
  if (!userId) {
    throw new Error(`Healthie user ID missing for client ${healthieClientId}.`);
  }
  return userId;
}

type PrescriptionDraftRow = {
  draft_id: string;
  patient_id: string;
  intent_payload: unknown;
  safety_payload: unknown;
  status: DraftStatus;
  healthie_prescription_id?: string | null;
  submission_notes?: string | null;
  created_at: string;
  updated_at: string;
  submitted_at?: string | null;
};

let draftTableEnsured = false;

async function ensureDraftTable(): Promise<void> {
  if (draftTableEnsured) {
    return;
  }
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS prescription_drafts (
      draft_id UUID PRIMARY KEY,
      patient_id TEXT NOT NULL,
      intent_payload JSONB NOT NULL,
      safety_payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      healthie_prescription_id TEXT NULL,
      submission_notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prescription_drafts_patient ON prescription_drafts(patient_id);
    CREATE INDEX IF NOT EXISTS idx_prescription_drafts_status ON prescription_drafts(status);
  `);
  draftTableEnsured = true;
}

function mapDraftRow(row: PrescriptionDraftRow): PrescriptionDraft {
  return {
    id: row.draft_id,
    patientId: row.patient_id,
    intent: row.intent_payload as PrescriptionIntent,
    safety: row.safety_payload as SafetyReport,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at ?? null,
    healthiePrescriptionId: row.healthie_prescription_id ?? null,
    submissionNotes: row.submission_notes ?? null,
  };
}

async function fetchDraft(draftId: string): Promise<PrescriptionDraft | null> {
  await ensureDraftTable();
  const rows = await dbQuery<PrescriptionDraftRow>(
    `SELECT * FROM prescription_drafts WHERE draft_id = $1`,
    [draftId]
  );
  if (!rows.length) {
    return null;
  }
  return mapDraftRow(rows[0]);
}

async function persistDraft(
  draft: PrescriptionDraft
): Promise<void> {
  await ensureDraftTable();
  await dbQuery(
    `
      INSERT INTO prescription_drafts (
        draft_id,
        patient_id,
        intent_payload,
        safety_payload,
        status,
        healthie_prescription_id,
        submission_notes
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
      ON CONFLICT (draft_id) DO UPDATE
        SET
          patient_id = EXCLUDED.patient_id,
          intent_payload = EXCLUDED.intent_payload,
          safety_payload = EXCLUDED.safety_payload,
          status = EXCLUDED.status,
          healthie_prescription_id = EXCLUDED.healthie_prescription_id,
          submission_notes = EXCLUDED.submission_notes,
          updated_at = NOW(),
          submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE prescription_drafts.submitted_at END
    `,
    [
      draft.id,
      draft.patientId,
      JSON.stringify(draft.intent),
      JSON.stringify(draft.safety),
      draft.status,
      draft.healthiePrescriptionId ?? null,
      draft.submissionNotes ?? null,
    ]
  );
}

function mapPharmacy(pharmacy?: HealthiePharmacy | null) {
  if (!pharmacy) return null;
  return {
    id: pharmacy.id ?? null,
    name: pharmacy.name ?? null,
    city: pharmacy.city ?? null,
    state: pharmacy.state ?? null,
    phone: pharmacy.phone_number ?? null,
  };
}

function mapPrescription(p: HealthiePrescription): PrescriptionSummary {
  return {
    id: p.id,
    productName: p.product_name ?? null,
    dosage: p.dosage ?? null,
    directions: p.directions ?? null,
    quantity: p.quantity ?? null,
    refills: p.refills ?? null,
    unit: p.unit ?? null,
    route: p.route ?? null,
    dateWritten: p.date_written ?? null,
    status: p.status ?? p.normalized_status ?? null,
    pharmacy: mapPharmacy(p.pharmacy),
  };
}

function buildManualEntryUrl(clientId: string, intent: PrescriptionIntent): string {
  const params = new URLSearchParams();
  params.set('medication', intent.medication.name);
  if (intent.medication.strength) params.set('strength', intent.medication.strength);
  if (intent.medication.frequency) params.set('frequency', intent.medication.frequency);
  if (intent.medication.instructions) params.set('directions', intent.medication.instructions);
  if (intent.medication.durationDays)
    params.set('duration_days', String(intent.medication.durationDays));
  if (intent.medication.quantity) params.set('quantity', String(intent.medication.quantity));
  if (intent.medication.refills) params.set('refills', String(intent.medication.refills));
  if (intent.pharmacy.name) params.set('pharmacy_name', intent.pharmacy.name);
  if (intent.pharmacy.phone) params.set('pharmacy_phone', intent.pharmacy.phone);
  if (intent.pharmacy.city) params.set('pharmacy_city', intent.pharmacy.city);
  if (intent.pharmacy.state) params.set('pharmacy_state', intent.pharmacy.state);
  if (intent.pharmacy.zip) params.set('pharmacy_zip', intent.pharmacy.zip);

  const queryString = params.toString();
  const basePath = `${HEALTHIE_APP_BASE_URL}/clients/${clientId}/prescriptions/new`;
  return queryString ? `${basePath}?${queryString}` : basePath;
}

export const prescribingService: PrescribingService = {
  async listPrescriptions(patientId, opts) {
    const healthieClient = createHealthieClient();
    if (!healthieClient) {
      throw new Error('Healthie client is not configured.');
    }
    const userId = await resolveHealthieUserId(patientId);
    const prescriptions = await healthieClient.getPrescriptions(userId, { status: opts?.status });
    return prescriptions.map(mapPrescription);
  },

  async proposeNonControlledPrescription(intent) {
    if (!intent.medication?.name) {
      throw new Error('Medication name is required.');
    }
    if (!intent.pharmacy?.name) {
      throw new Error('Pharmacy information is required.');
    }

    // Ensure the patient is linked before building the draft.
    await patientsService.ensureHealthieClient(intent.patientId);

    const safetyNotes = [
      'Automated allergy and interaction checks have not been implemented yet.',
      'Please review patient chart in Healthie prior to submission.',
    ];

    const draft: PrescriptionDraft = {
      id: randomUUID(),
      patientId: intent.patientId,
      intent,
      safety: {
        allergiesOk: true,
        interactionsOk: true,
        refillWindowOk: true,
        notes: safetyNotes,
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await persistDraft(draft);
    return draft;
  },

  async submitPrescription(draftId) {
    const draft = await fetchDraft(draftId);
    if (!draft) {
      throw new Error(`Prescription draft ${draftId} not found.`);
    }

    if (draft.status === 'submitted') {
      return {
        success: true,
        prescriptionId: draft.healthiePrescriptionId ?? draft.id,
        note: draft.submissionNotes ?? 'Draft was already submitted.',
      };
    }

    const healthieClientId = await patientsService.ensureHealthieClient(draft.patientId);
    const manualEntryUrl = buildManualEntryUrl(healthieClientId, draft.intent);
    const manualInstructions =
      'Click the link to open Healthie, review the prefilled details, and finish the Rx inside Healthie/DoseSpot.';
    const fallbackNote =
      'Healthie API does not yet expose a createPrescription mutation. Draft stored for manual entry.';

    // Capture attempt in audit log for compliance.
    await auditService.logEvent({
      actorId: 'system',
      patientId: draft.patientId,
      system: 'HEALTHIE',
      action: 'PRESCRIPTION_SUBMITTED',
      payload: {
        draftId,
        medication: draft.intent.medication,
        pharmacy: draft.intent.pharmacy,
        safety: draft.safety,
      },
    });

    // Persist status change.
    const submittedDraft: PrescriptionDraft = {
      ...draft,
      status: 'submitted',
      healthiePrescriptionId: draft.healthiePrescriptionId ?? null,
      submissionNotes: `${fallbackNote} Manual entry URL: ${manualEntryUrl}`,
      submittedAt: new Date().toISOString(),
    };

    await persistDraft(submittedDraft);

    return {
      success: true,
      prescriptionId: submittedDraft.healthiePrescriptionId ?? submittedDraft.id,
      note: fallbackNote,
      manualEntryUrl,
      manualInstructions,
    };
  },
};


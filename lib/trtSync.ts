import { fetchDispensesForPatient, type PatientDispenseRow } from './inventoryQueries';
import { patientsService } from './patients';
import { createHealthieClient } from './healthie';

const TRT_REGIMEN_META_KEY = process.env.HEALTHIE_TRT_REGIMEN_META_KEY || 'trt_regimen';
const LAST_DISPENSE_META_KEY = process.env.HEALTHIE_LAST_DISPENSE_META_KEY || 'last_dispense_date';

function formatMl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `${numeric % 1 === 0 ? numeric.toFixed(1) : numeric.toFixed(2)} mL`;
  }
  return `${value} mL`;
}

function normalizeDate(value?: string | null | Date): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }

  const stringified = typeof value === 'string' ? value : String(value);
  const trimmed = stringified.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString().slice(0, 10);
}

function buildRegimenDescription(row: PatientDispenseRow): string | undefined {
  const parts: string[] = [];
  const dose = formatMl(row.dose_per_syringe_ml);
  const total = formatMl(row.total_dispensed_ml);

  if (dose) {
    parts.push(`Dose: ${dose}`);
  }
  if (row.syringe_count !== null && row.syringe_count !== undefined) {
    parts.push(`Syringes: ${row.syringe_count}`);
  }
  if (total) {
    parts.push(`Total: ${total}`);
  }
  if (row.dea_drug_name) {
    parts.push(`Product: ${row.dea_drug_name}`);
  }
  if (row.notes) {
    parts.push(`Notes: ${row.notes}`);
  }

  return parts.length ? parts.join(' • ') : undefined;
}

export async function syncHealthieTrtMetadata(patientId: string): Promise<void> {
  const client = createHealthieClient();
  if (!client) {
    throw new Error('Healthie client not configured');
  }

  let healthieClientId: string;
  try {
    healthieClientId = await patientsService.ensureHealthieClient(patientId);
  } catch (error) {
    // Patient not linked to Healthie yet.
    return;
  }

  const [latestDispense] = await fetchDispensesForPatient(patientId, 1);
  if (!latestDispense) {
    return;
  }

  const regimen = buildRegimenDescription(latestDispense);
  const lastDispenseDate =
    normalizeDate(latestDispense.dispense_date) ?? normalizeDate(latestDispense.signed_at);

  await client.updateClientMetadataFields(healthieClientId, {
    [TRT_REGIMEN_META_KEY]: regimen,
    [LAST_DISPENSE_META_KEY]: lastDispenseDate,
  });
}


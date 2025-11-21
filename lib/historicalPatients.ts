import fs from 'fs';
import path from 'path';
import { normalizeName, stripHonorifics } from './nameUtils';

export type HistoricalPatientRecord = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  mobile_phone?: string | null;
  home_phone?: string | null;
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
  birth_date?: string | null;
  sex?: string | null;
  member_since?: string | null;
  patient_number?: string | null;
};

type Directory = Record<string, HistoricalPatientRecord>;

let cachedDirectory: Directory | null = null;

function loadDirectory(): Directory {
  if (cachedDirectory) {
    return cachedDirectory;
  }
  const filePath = path.resolve(process.cwd(), 'data', 'historical_patients.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    cachedDirectory = JSON.parse(raw) as Directory;
  } catch (error) {
    console.warn('[HistoricalPatients] Unable to load historical_patients.json', error);
    cachedDirectory = {};
  }
  return cachedDirectory!;
}

export function lookupHistoricalPatient(nameOrNorm: string): HistoricalPatientRecord | null {
  const directory = loadDirectory();
  const normalized = normalizeName(nameOrNorm);
  if (!normalized) {
    return null;
  }
  return directory[normalized] ?? null;
}

export function assembleAddress(record: HistoricalPatientRecord): string {
  const parts = [
    record.street,
    record.street2,
    record.city,
    record.state,
    record.postal
  ].filter(Boolean);
  return parts.join(', ');
}

export function bestPhone(record: HistoricalPatientRecord): string {
  return record.mobile_phone || record.home_phone || '';
}

export function cleanedFullName(record: HistoricalPatientRecord): string {
  return stripHonorifics(record.full_name ?? '');
}



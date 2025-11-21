import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import {
  assembleAddress,
  bestPhone,
  cleanedFullName,
  lookupHistoricalPatient
} from '@/lib/historicalPatients';
import { normalizeName, stripHonorifics } from '@/lib/nameUtils';

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  try {
    const body = await request.json();
    const normName: string = body?.normName ?? '';
    const fallbackName: string = body?.patientName ?? '';
    const normalized = normName || normalizeName(fallbackName);
    if (!normalized) {
      return NextResponse.json({ data: null });
    }
    const record = lookupHistoricalPatient(normalized);
    if (!record) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({
      data: {
        patientName: cleanedFullName(record),
        phoneNumber: bestPhone(record),
        email: record.email ?? '',
        address: assembleAddress(record),
        dateOfBirth: record.birth_date ?? '',
        notes: record.patient_number ? `Historical patient #${record.patient_number}` : ''
      }
    });
  } catch (error) {
    console.error('Intake defaults error', error);
    return NextResponse.json({ error: 'Unable to load intake defaults' }, { status: 500 });
  }
}



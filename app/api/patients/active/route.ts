'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchActivePatientOptions } from '@/lib/patientQueries';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const patients = await fetchActivePatientOptions();
    return NextResponse.json({ data: patients });
  } catch (error) {
    console.error('Failed to fetch active patients', error);
    return NextResponse.json({ error: 'Failed to fetch active patients' }, { status: 500 });
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchBulkPatientSignalsAsObject } from '@/lib/patientSignals';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');
    const signals = await fetchBulkPatientSignalsAsObject();
    return NextResponse.json({ signals, count: Object.keys(signals).length });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[API] /patients/signals/bulk failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

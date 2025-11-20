import { NextRequest, NextResponse } from 'next/server';
import { upsertClinicSyncPatient } from '@/lib/clinicsync';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const providedKey =
      request.headers.get('x-api-key') ??
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    const expectedKey = process.env.CLINICSYNC_WEBHOOK_SECRET ?? process.env.CLINICSYNC_API_KEY;
    if (!expectedKey) {
      return NextResponse.json(
        { error: 'ClinicSync integration is not configured on the server.' },
        { status: 500 }
      );
    }
    if (!providedKey || providedKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    await upsertClinicSyncPatient(payload, { source: 'webhook' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('ClinicSync webhook error:', error);
    return NextResponse.json({ error: 'Failed to process ClinicSync webhook' }, { status: 500 });
  }
}



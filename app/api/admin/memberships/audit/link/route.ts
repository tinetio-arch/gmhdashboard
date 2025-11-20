import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  await requireApiUser(req, 'admin');
  const body = await req.json();
  const patientId = body?.patientId;
  const clinicsyncPatientId = body?.clinicsyncPatientId;

  if (!patientId || !clinicsyncPatientId) {
    return NextResponse.json({ error: 'patientId and clinicsyncPatientId are required' }, { status: 400 });
  }

  await query(
    `INSERT INTO patient_clinicsync_mapping (patient_id, clinicsync_patient_id, match_method, match_confidence)
     VALUES ($1, $2, 'manual', 0.95)
     ON CONFLICT (clinicsync_patient_id) DO NOTHING`,
    [patientId, clinicsyncPatientId]
  );

  await query(
    `UPDATE clinicsync_memberships
     SET patient_id = $1, updated_at = NOW()
     WHERE clinicsync_patient_id = $2`,
    [patientId, clinicsyncPatientId]
  );

  return NextResponse.json({ success: true });
}



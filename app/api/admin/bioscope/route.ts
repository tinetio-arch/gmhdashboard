import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import {
  addAuthorizedPatient,
  isPatientAuthorized,
  listAuthorizedPatients,
  revokeAuthorizedPatient,
  auditBioscopeCall,
} from '@/lib/bioscope-auth';
import { getBioscopeHealthieClient } from '@/lib/bioscope-healthie';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'admin');
    const patients = await listAuthorizedPatients(true);
    return NextResponse.json({ patients });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin/bioscope] GET failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'admin');
    const body = await request.json().catch(() => ({}));
    const healthieId = (body?.healthie_patient_id ?? '').toString().trim();
    const notes = body?.notes ? String(body.notes).trim() : null;

    if (!healthieId) {
      return NextResponse.json({ error: 'healthie_patient_id is required' }, { status: 400 });
    }

    if (await isPatientAuthorized(healthieId)) {
      return NextResponse.json(
        { error: `Patient ${healthieId} is already on the allowlist.` },
        { status: 409 }
      );
    }

    let patientName: string | null = null;
    try {
      const healthie = getBioscopeHealthieClient();
      const client = await healthie.getClient(healthieId);
      const first = client?.first_name ?? '';
      const last = client?.last_name ?? '';
      const composed = `${first} ${last}`.trim();
      patientName = composed || null;
    } catch (err) {
      console.warn('[admin/bioscope] could not fetch patient name from Healthie:', err);
    }

    const row = await addAuthorizedPatient({
      healthie_patient_id: healthieId,
      patient_name: patientName,
      added_by: user.email,
      notes,
    });

    await auditBioscopeCall({
      action: 'allowlist_add',
      healthie_patient_id: healthieId,
      status: 'completed',
      summary: `Added ${patientName ?? healthieId} to BioSCOPE allowlist`,
      details: { added_by: user.email, notes },
    });

    return NextResponse.json({ patient: row }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin/bioscope] POST failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'admin');
    const idParam = request.nextUrl.searchParams.get('id');
    const id = Number(idParam);
    if (!idParam || !Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Valid id query param is required' }, { status: 400 });
    }

    await revokeAuthorizedPatient(id, user.email);

    await auditBioscopeCall({
      action: 'allowlist_revoke',
      healthie_patient_id: null,
      status: 'completed',
      summary: `Revoked BioSCOPE allowlist row id=${id}`,
      details: { revoked_by: user.email, allowlist_row_id: id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin/bioscope] DELETE failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

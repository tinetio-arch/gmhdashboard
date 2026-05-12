import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeBioscopeRequest,
  auditBioscopeCall,
  BioscopeUnauthorizedError,
  BioscopeForbiddenError,
} from '@/lib/bioscope-auth';
import { getBioscopeHealthieClient } from '@/lib/bioscope-healthie';

export const dynamic = 'force-dynamic';

const ACTION = 'note_create';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolvedParams = params instanceof Promise ? await params : params;
  const patientId = (resolvedParams?.id ?? '').toString().trim();

  try {
    await authorizeBioscopeRequest(request, patientId, ACTION);

    const body = await request.json().catch(() => ({}));
    const noteBody = (body?.body ?? body?.content ?? '').toString().trim();
    const title = body?.title ? String(body.title).trim() : 'BioSCOPE Note';

    if (!noteBody) {
      return NextResponse.json(
        { error: 'Request body must include `body` (the chart note content)' },
        { status: 400 }
      );
    }

    const healthie = getBioscopeHealthieClient();
    const note = await healthie.createChartNote({
      client_id: patientId,
      body: noteBody,
      title,
    });

    await auditBioscopeCall({
      action: ACTION,
      healthie_patient_id: patientId,
      status: 'completed',
      summary: `BioSCOPE created chart note for patient ${patientId}`,
      details: {
        note_id: note.id,
        title,
        body_length: noteBody.length,
      },
    });

    return NextResponse.json(
      {
        note_id: note.id,
        title: note.title ?? title,
        status: note.status ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BioscopeUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof BioscopeForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[bioscope/patient/notes] POST failed:', error);
    await auditBioscopeCall({
      action: ACTION,
      healthie_patient_id: patientId || null,
      status: 'error',
      summary: `BioSCOPE chart note POST failed for patient ${patientId}`,
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

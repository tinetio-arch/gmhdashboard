import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeBioscopeRequest,
  auditBioscopeCall,
  BioscopeUnauthorizedError,
  BioscopeForbiddenError,
} from '@/lib/bioscope-auth';
import { getBioscopeHealthieClient } from '@/lib/bioscope-healthie';

export const dynamic = 'force-dynamic';

const ACTION = 'patient_get';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolvedParams = params instanceof Promise ? await params : params;
  const patientId = (resolvedParams?.id ?? '').toString().trim();

  try {
    await authorizeBioscopeRequest(request, patientId, ACTION);

    const healthie = getBioscopeHealthieClient();
    const [client, medications, allergies, prescriptions] = await Promise.all([
      healthie.getClient(patientId),
      healthie.getMedications(patientId, { active: true }),
      healthie.getAllergies(patientId),
      healthie.getPrescriptions(patientId),
    ]);

    const payload = {
      patient: {
        id: client.id,
        first_name: client.first_name ?? null,
        last_name: client.last_name ?? null,
        email: client.email ?? null,
        phone_number: client.phone_number ?? null,
        dob: client.dob ?? null,
      },
      medications: medications.map((m) => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage ?? null,
        frequency: m.frequency ?? null,
        route: m.route ?? null,
        directions: m.directions ?? null,
        start_date: m.start_date ?? null,
        end_date: m.end_date ?? null,
        status: m.normalized_status ?? null,
      })),
      allergies: allergies.map((a) => ({
        id: a.id,
        name: a.name,
        reaction: a.reaction ?? null,
        severity: a.severity ?? null,
        notes: a.notes ?? null,
      })),
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        product_name: p.product_name,
        dosage: p.dosage ?? null,
        directions: p.directions ?? null,
        quantity: p.quantity ?? null,
        refills: p.refills ?? null,
        date_written: p.date_written ?? null,
        status: p.normalized_status ?? p.status ?? null,
        prescriber_name: p.prescriber_name ?? null,
      })),
    };

    await auditBioscopeCall({
      action: ACTION,
      healthie_patient_id: patientId,
      status: 'completed',
      summary: `BioSCOPE GET patient ${patientId}`,
      details: {
        medications_count: medications.length,
        allergies_count: allergies.length,
        prescriptions_count: prescriptions.length,
      },
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BioscopeUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof BioscopeForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[bioscope/patient] GET failed:', error);
    await auditBioscopeCall({
      action: ACTION,
      healthie_patient_id: patientId || null,
      status: 'error',
      summary: `BioSCOPE GET patient ${patientId} failed`,
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

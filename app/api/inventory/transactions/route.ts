'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createDispense } from '@/lib/inventoryQueries';
import { fetchPatientById } from '@/lib/patientQueries';

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isHoldOrInactive(statusKey: string | null, alertStatus: string | null): boolean {
  const status = statusKey?.toLowerCase() ?? '';
  const alert = alertStatus?.toLowerCase() ?? '';
  if (status.startsWith('hold') || alert.startsWith('hold')) {
    return true;
  }
  if (status === 'inactive' || alert === 'inactive') {
    return true;
  }
  return false;
}

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');

  try {
    const body = await request.json();
    if (!body) {
      return NextResponse.json({ error: 'Request body required.' }, { status: 400 });
    }

    const vialExternalId = body.vialExternalId?.trim();
    if (!vialExternalId) {
      return NextResponse.json({ error: 'vialExternalId is required.' }, { status: 400 });
    }
    if (!body.dispenseDate) {
      return NextResponse.json({ error: 'dispenseDate is required.' }, { status: 400 });
    }

    const syringeCount = parseNullableNumber(body.syringeCount);
    if (syringeCount !== null && !Number.isInteger(syringeCount)) {
      return NextResponse.json({ error: 'Syringe count must be a whole number.' }, { status: 400 });
    }

    if (body.patientId) {
      const patient = await fetchPatientById(body.patientId);
      if (!patient) {
        return NextResponse.json({ error: 'Selected patient could not be found.' }, { status: 404 });
      }
      if (isHoldOrInactive(patient.status_key, patient.alert_status)) {
        return NextResponse.json({ error: 'Patient status is hold or inactive. Update the status before dispensing.' }, { status: 400 });
      }
    }

    const result = await createDispense({
      vialExternalId,
      dispenseDate: body.dispenseDate,
      transactionType: body.transactionType ?? null,
      patientId: body.patientId ?? null,
      patientName: body.patientName ?? null,
      totalDispensedMl: parseNullableNumber(body.totalDispensedMl),
      syringeCount,
      dosePerSyringeMl: parseNullableNumber(body.dosePerSyringeMl),
      wasteMl: parseNullableNumber(body.wasteMl),
      totalAmount: parseNullableNumber(body.totalAmount),
      notes: body.notes ?? null,
      prescriber: body.prescriber ?? null,
      deaSchedule: body.deaSchedule ?? null,
      deaDrugName: body.deaDrugName ?? null,
      deaDrugCode: body.deaDrugCode ?? null,
      units: body.units ?? null,
      recordDea: body.recordDea,
      createdByUserId: user.user_id,
      createdByRole: user.role,
      prescribingProviderId: body.prescribingProviderId ?? null,
      signatureStatus: body.signatureStatus ?? 'awaiting_signature',
      signatureNote: body.signatureNote ?? null
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Failed to record dispense', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


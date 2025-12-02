import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createDispense } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    
    const body = await request.json();
    
    // Validate required fields
    if (!body.vialExternalId) {
      return NextResponse.json({ error: 'Vial external ID is required.' }, { status: 400 });
    }
    if (!body.dispenseDate) {
      return NextResponse.json({ error: 'Dispense date is required.' }, { status: 400 });
    }
    if (!body.patientName && !body.patientId) {
      return NextResponse.json({ error: 'Patient name or ID is required.' }, { status: 400 });
    }

    const result = await createDispense({
      vialExternalId: body.vialExternalId,
      dispenseDate: body.dispenseDate,
      transactionType: body.transactionType ?? 'Dispense',
      patientId: body.patientId ?? null,
      patientName: body.patientName ?? null,
      totalDispensedMl: body.totalDispensedMl ?? null,
      syringeCount: body.syringeCount ?? null,
      dosePerSyringeMl: body.dosePerSyringeMl ?? null,
      wasteMl: body.wasteMl ?? null,
      totalAmount: body.totalAmount ?? null,
      notes: body.notes ?? null,
      prescriber: body.prescriber ?? null,
      deaSchedule: body.deaSchedule ?? null,
      deaDrugName: body.deaDrugName ?? null,
      deaDrugCode: body.deaDrugCode ?? null,
      units: body.units ?? 'mL',
      recordDea: body.recordDea ?? true,
      createdByUserId: user.user_id,
      createdByRole: user.role,
      prescribingProviderId: body.prescribingProviderId ?? null,
      signatureStatus: body.signatureStatus ?? 'awaiting_signature',
      signatureNote: body.signatureNote ?? null,
    });

    return NextResponse.json({
      success: true,
      dispenseId: result.dispenseId,
      deaTransactionId: result.deaTransactionId,
      updatedRemainingMl: result.updatedRemainingMl,
    });
  } catch (error: any) {
    console.error('[API] Error creating dispense transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create dispense transaction.' },
      { status: 500 }
    );
  }
}


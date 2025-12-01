import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { deletePatient, updatePatient, fetchPatientById } from '@/lib/patientQueries';
import { syncPatientToGHL } from '@/lib/patientGHLSync';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireApiUser(request, 'write');
  try {
    const body = await request.json();
    const timestamp = new Date().toISOString();
    const updated = await updatePatient({
      patientId: params.id,
      patientName: body.patientName,
      statusKey: body.statusKey ?? null,
      paymentMethodKey: body.paymentMethodKey ?? null,
      clientTypeKey: body.clientTypeKey ?? null,
      regimen: body.regimen ?? null,
      patientNotes: body.patientNotes ?? null,
      lastLab: body.lastLab ?? null,
      nextLab: body.nextLab ?? null,
      labStatus: body.labStatus ?? null,
      labNotes: null,
      serviceStartDate: body.serviceStartDate ?? null,
      contractEndDate: body.contractEndDate ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
      address: body.address ?? null,
      phoneNumber: body.phoneNumber ?? null,
      addedBy: user.email,
      dateAdded: body.dateAdded ?? null,
      lastModified: timestamp,
      email: body.email ?? null,
      regularClient: body.regularClient ?? false,
      isVerified: body.isVerified ?? false,
      membershipOwes: body.membershipOwes ?? null,
      eligibleForNextSupply: body.eligibleForNextSupply ?? null,
      supplyStatus: body.supplyStatus ?? null,
      membershipProgram: body.membershipProgram ?? null,
      membershipStatus: body.membershipStatus ?? null,
      membershipBalance: body.membershipBalance ?? null,
      nextChargeDate: body.nextChargeDate ?? null,
      lastChargeDate: body.lastChargeDate ?? null,
      lastSupplyDate: body.lastSupplyDate ?? null,
      lastControlledDispenseAt: body.lastControlledDispenseAt ?? null,
      lastDeaDrug: body.lastDeaDrug ?? null
    });

    // Sync the updated patient to GHL
    try {
      const patientForSync = await fetchPatientById(params.id);
      if (patientForSync) {
        await syncPatientToGHL(patientForSync, user.email);
        console.log(`[API] Successfully synced updated patient ${params.id} to GHL`);
      }
    } catch (ghlError) {
      // Log the error but don't fail the patient update
      console.error(`[API] Failed to sync updated patient ${params.id} to GHL:`, ghlError);
      // The patient is still updated successfully, GHL sync can be retried later
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Failed to update patient', error);
    return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  await requireApiUser(request, 'admin');
  try {
    await deletePatient(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete patient', error);
    return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
  }
}







import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createPatient, fetchPatientDataEntries } from '@/lib/patientQueries';
import { syncPatientToGHL } from '@/lib/patientGHLSync';
import { fetchPatientById } from '@/lib/patientQueries';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const patients = await fetchPatientDataEntries();
    return NextResponse.json({ data: patients });
  } catch (error) {
    console.error('Failed to fetch patients', error);
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');
  try {
    const body = await request.json();
    const timestamp = new Date().toISOString();
    const created = await createPatient({
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
      dateAdded: body.dateAdded ?? timestamp,
      lastModified: body.lastModified ?? timestamp,
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

    // Sync the newly created patient to GHL asynchronously (don't block response)
    // Fire and forget - don't await, let it run in background
    (async () => {
      try {
        const patientForSync = await fetchPatientById(created.patient_id);
        if (patientForSync) {
          // Pass undefined for userId since created_by expects UUID, not email
          await syncPatientToGHL(patientForSync, undefined);
          console.log(`[API] Successfully synced new patient ${created.patient_id} to GHL`);
        }
      } catch (ghlError) {
        // Log the error but don't fail the patient creation
        console.error(`[API] Failed to sync new patient ${created.patient_id} to GHL:`, ghlError);
        // The patient is still created successfully, GHL sync can be retried later
      }
    })();

    // Return immediately without waiting for GHL sync
    return NextResponse.json({ data: created });
  } catch (error) {
    console.error('Failed to create patient', error);
    return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
  }
}


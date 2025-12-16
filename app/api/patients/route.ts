import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createPatient, fetchPatientDataEntries } from '@/lib/patientQueries';
import { syncPatientToGHL } from '@/lib/patientGHLSync';
import { fetchPatientById } from '@/lib/patientQueries';
import { query } from '@/lib/db';

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
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (authError) {
    console.error('[API] Authentication error:', authError);
    return NextResponse.json(
      { error: authError instanceof Error ? authError.message : 'Unauthorized' },
      { status: 401 }
    );
  }
  
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
        if (patientForSync && user?.user_id) {
          // Pass user email for audit trail
          const syncResult = await syncPatientToGHL(patientForSync, user.user_id);
          if (syncResult.success) {
            console.log(`[API] ✅ Successfully synced new patient ${created.patient_name} (${created.patient_id}) to GHL. Contact ID: ${syncResult.ghlContactId || 'N/A'}`);
          } else {
            console.error(`[API] ❌ Failed to sync new patient ${created.patient_name} (${created.patient_id}) to GHL: ${syncResult.error}`);
          }
        } else {
          console.error(`[API] ⚠️  Could not fetch patient ${created.patient_id} for GHL sync`);
        }
      } catch (ghlError) {
        // Log the error but don't fail the patient creation
        const errorMsg = ghlError instanceof Error ? ghlError.message : String(ghlError);
        console.error(`[API] ❌ Failed to sync new patient ${created.patient_name} (${created.patient_id}) to GHL:`, errorMsg);
        // The patient is still created successfully, GHL sync can be retried later
        // Update patient record with error status
        try {
          await query(
            `UPDATE patients 
             SET ghl_sync_status = 'error',
                 ghl_sync_error = $1
             WHERE patient_id = $2`,
            [errorMsg.substring(0, 500), created.patient_id]
          );
        } catch (updateError) {
          console.error(`[API] Failed to update patient sync error status:`, updateError);
        }
      }
    })();

    // Return immediately without waiting for GHL sync
    return NextResponse.json({ data: created });
  } catch (error) {
    console.error('[API] Failed to create patient:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create patient';
    
    // Log full error details for debugging
    if (error instanceof Error) {
      console.error('[API] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        user: user?.email || 'unknown',
        userRole: user?.role || 'unknown',
        userId: user?.user_id || 'unknown'
      });
      
      // Check for specific database errors
      if (error.message.includes('violates') || error.message.includes('constraint')) {
        return NextResponse.json(
          { error: 'Database constraint error. Please check all required fields are valid.' },
          { status: 400 }
        );
      }
      
      // Check for authentication errors
      if (error.message.includes('Unauthorized') || error.message.includes('Forbidden')) {
        return NextResponse.json(
          { error: 'You do not have permission to create patients. Please contact an administrator.' },
          { status: 403 }
        );
      }
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}


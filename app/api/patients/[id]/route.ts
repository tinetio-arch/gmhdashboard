import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { deletePatient, updatePatient, fetchPatientById } from '@/lib/patientQueries';
import { syncPatientToGHL } from '@/lib/patientGHLSync';
import { query } from '@/lib/db';
import { syncHealthiePatientDemographics } from '@/lib/healthieDemographics';

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
      lastDeaDrug: body.lastDeaDrug ?? null,
      patientType: body.patientType ?? null
    });

    // Sync the updated patient to GHL asynchronously (don't block response).
    // PHASE 2-r (2026-05-19): persist the sync outcome on `ghl_sync_status` /
    // `ghl_sync_error` / `ghl_last_synced_at` on EVERY code path — success,
    // soft-fail (`syncResult.success === false`), and thrown error. Previously
    // only the throw branch wrote a status, so a soft-fail (e.g. GHL validation
    // rejection) left `ghl_sync_status` stuck at its prior value. This mirrors
    // the persist-status pattern claude9 wired up for the Healthie sync.
    (async () => {
      let nextStatus: 'ok' | 'error' | null = null;
      let nextError: string | null = null;

      try {
        const patientForSync = await fetchPatientById(params.id);
        if (patientForSync) {
          const syncResult = await syncPatientToGHL(patientForSync, user.user_id);
          if (syncResult.success) {
            console.log(`[API] ✅ Successfully synced updated patient ${patientForSync.patient_name} (${params.id}) to GHL. Contact ID: ${syncResult.ghlContactId || 'N/A'}`);
            nextStatus = 'ok';
          } else {
            const errMsg = syncResult.error || 'unknown error';
            console.error(`[API] ❌ Failed to sync updated patient ${patientForSync.patient_name} (${params.id}) to GHL: ${errMsg}`);
            nextStatus = 'error';
            nextError = errMsg;
          }
        } else {
          // Couldn't fetch the patient row to send — don't touch ghl_sync_status
          // because we genuinely don't know whether the upstream is reachable.
          console.error(`[API] ⚠️  Could not fetch patient ${params.id} for GHL sync`);
        }
      } catch (ghlError) {
        const errorMsg = ghlError instanceof Error ? ghlError.message : String(ghlError);
        console.error(`[API] ❌ Failed to sync updated patient ${params.id} to GHL:`, errorMsg);
        nextStatus = 'error';
        nextError = errorMsg;
      }

      if (nextStatus) {
        try {
          await query(
            `UPDATE patients
             SET ghl_sync_status = $1,
                 ghl_sync_error = $2,
                 ghl_last_synced_at = NOW()
             WHERE patient_id = $3`,
            [nextStatus, nextError ? nextError.substring(0, 500) : null, params.id]
          );
        } catch (updateError) {
          console.error(`[API] Failed to persist ghl_sync_status:`, updateError);
        }
      }
    })();

    // Sync patient demographics to Healthie if eligible.
    // FIX(2026-05-19): persist the sync result on `patients.healthie_sync_status`
    // / `healthie_sync_error` so blocked patients (e.g. email collision with a
    // provider record) are visible in /ops and we stop discarding the failure
    // signal. Previously the catch block only console.error'd, so address-leg
    // failures (Ryan Foster) went unnoticed.
    (async () => {
      // Skip retrying patients that are already flagged as blocked — a human
      // needs to resolve the collision (deduper, not sync) before we try again.
      const [blocked] = await query<{ healthie_sync_status: string | null }>(
        `SELECT healthie_sync_status FROM patients WHERE patient_id = $1`,
        [params.id]
      );
      if (blocked?.healthie_sync_status === 'blocked_email_collision') {
        console.log(
          `[API] ⏭️ Skipping Healthie sync for patient ${params.id} (blocked_email_collision — resolve dedup first)`
        );
        return;
      }

      let nextStatus: string | null = null;
      let nextError: string | null = null;

      try {
        const result = await syncHealthiePatientDemographics(params.id);
        if (result.status === 'synced') {
          console.log(`[API] ✅ Synced demographics for patient ${params.id} to Healthie`);
          nextStatus = 'ok';
        } else if (result.status === 'skipped') {
          console.log(
            `[API] ℹ️ Skipped Healthie sync for patient ${params.id}: ${result.reason}`
          );
          // Don't touch status for skipped rows — patient isn't eligible.
          return;
        } else {
          // partial: address may or may not have synced; demographics did not.
          console.warn(
            `[API] ⚠️ Healthie sync partial for patient ${params.id} (${result.healthie_sync_status}, address_synced=${result.address_synced}): ${result.reason}`
          );
          nextStatus = result.healthie_sync_status;
          nextError = result.reason.substring(0, 500);
        }
      } catch (healthieError) {
        const msg = healthieError instanceof Error ? healthieError.message : String(healthieError);
        console.error(`[API] ❌ Failed to sync patient ${params.id} to Healthie:`, msg);
        nextStatus = 'error';
        nextError = msg.substring(0, 500);
      }

      if (nextStatus) {
        try {
          await query(
            `UPDATE patients
             SET healthie_sync_status = $1,
                 healthie_sync_error = $2,
                 healthie_last_synced_at = NOW()
             WHERE patient_id = $3`,
            [nextStatus, nextError, params.id]
          );
        } catch (persistErr) {
          console.error(`[API] Failed to persist healthie_sync_status:`, persistErr);
        }
      }
    })();

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








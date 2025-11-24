import { NextRequest, NextResponse } from 'next/server';
import { upsertClinicSyncPatient } from '@/lib/clinicsync';
import { CLINICSYNC_CONFIG, isRelevantPassId, hasRelevantPassName, meetsBalanceThreshold } from '@/lib/clinicsyncConfig';
import { query } from '@/lib/db';

// Helper function to check if patient has meaningful membership data
function hasValidMembershipData(payload: any): boolean {
  // Check for explicit membership indicators
  const hasMembershipPlan = !!(
    payload.membership_plan ||
    payload.program_name ||
    payload.treatment_name
  );

  // Check for memberships array with actual data
  const hasMembershipsArray = !!(
    Array.isArray(payload.memberships) && 
    payload.memberships.length > 0 &&
    payload.memberships.some((m: any) => 
      m?.name || m?.plan_name || m?.program_name || m?.status
    )
  );

  // Check for nested membership object
  const hasMembershipObject = !!(
    payload.membership && 
    (payload.membership.name || payload.membership.plan_name || payload.membership.status)
  );

  // Check for passes array with membership/package data
  const hasValidPasses = !!(
    Array.isArray(payload.passes) && 
    payload.passes.length > 0 &&
    payload.passes.some((pass: any) => {
      // Only count passes that have meaningful membership data
      const hasName = !!(pass?.name || pass?.package_name || pass?.membership_name || pass?.plan_name || pass?.program_name);
      const hasValidId = !!(pass?.id && [3, 7, 52, 65, 72].includes(pass.id)); // Known membership pass IDs
      const hasPackageType = !!(pass?.package_type && pass.package_type !== 'appointment');
      
      return hasName || hasValidId || hasPackageType;
    })
  );

  // Check for outstanding balance (indicates active membership with payment issues)
  const hasOutstandingBalance = CLINICSYNC_CONFIG.webhook.processOutstandingBalances && !!(
    (payload.amount_owing && meetsBalanceThreshold(payload.amount_owing)) ||
    (payload.balance && meetsBalanceThreshold(payload.balance)) ||
    (payload.amount_due && meetsBalanceThreshold(payload.amount_due)) ||
    (payload.claims_amount_owing && meetsBalanceThreshold(payload.claims_amount_owing))
  );

  // Check for appointments with package/membership associations
  const hasPackageAppointments = !!(
    Array.isArray(payload.appointmentsObject) &&
    payload.appointmentsObject.length > 0 &&
    payload.appointmentsObject.some((apt: any) => 
      apt?.package_id || apt?.membership_id || apt?.pass_id
    )
  );

  // Patient has membership data if ANY of these conditions are true
  return hasMembershipPlan || 
         hasMembershipsArray || 
         hasMembershipObject || 
         hasValidPasses || 
         hasOutstandingBalance ||
         hasPackageAppointments;
}

// Helper function to check for specific pass types we care about
function hasRelevantPassTypes(payload: any): boolean {
  if (!Array.isArray(payload.passes) || payload.passes.length === 0) {
    return false;
  }
  
  return payload.passes.some((pass: any) => {
    // Check by pass ID using config
    if (pass?.id && isRelevantPassId(pass.id)) {
      return true;
    }
    
    // Check by pass name/type using config
    const passName = pass?.name || pass?.package_name || pass?.membership_name || pass?.plan_name || '';
    return hasRelevantPassName(passName);
  });
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    // Log the webhook receipt (but don't log full payload for privacy)
    console.log(`[ClinicSync Webhook] Received data for patient ${payload.patient_number || payload.id || 'unknown'}`);
    
    // Pre-filter: Only process patients with membership data (if filtering is enabled)
    if (CLINICSYNC_CONFIG.webhook.filterNonMembershipPatients && !hasValidMembershipData(payload)) {
      // Update sync tracking for skipped patient
      await updateSyncTracking(false, false);
      
      // Log only if configured (now disabled by default)
      if (CLINICSYNC_CONFIG.logging.logSkippedPatients) {
        console.log(`[ClinicSync Webhook] Skipping patient ${payload.patient_number || payload.id} (${payload.name || payload.patient_name || 'unknown'}) - no membership data detected`);
      }
      
      // Return success to avoid webhook retries, but don't process
      return NextResponse.json({ 
        success: true, 
        message: 'Patient skipped - no membership data',
        processed: false 
      });
    }

    // Additional filter: Check for specific pass types if passes exist (if filtering is enabled)
    if (CLINICSYNC_CONFIG.webhook.filterByPassTypes && 
        Array.isArray(payload.passes) && 
        payload.passes.length > 0) {
      if (!hasRelevantPassTypes(payload)) {
        // Update sync tracking for skipped patient
        await updateSyncTracking(false, false);
        
        if (CLINICSYNC_CONFIG.logging.logSkippedPatients) {
          console.log(`[ClinicSync Webhook] Skipping patient ${payload.patient_number || payload.id} - passes don't match membership criteria`);
        }
        return NextResponse.json({ 
          success: true, 
          message: 'Patient skipped - no relevant pass types',
          processed: false 
        });
      }
    }

    // Process the patient through existing ClinicSync logic
    const result = await upsertClinicSyncPatient(payload, { 
      source: 'webhook',
      skipWebhookLog: false 
    });

    // Update sync tracking for processed patient
    const wasMatched = !!result.patientId;
    await updateSyncTracking(true, wasMatched);

    if (CLINICSYNC_CONFIG.logging.logSuccessfulProcessing) {
      console.log(`[ClinicSync Webhook] Processed patient ${payload.patient_number || payload.id}: ${payload.name || payload.patient_name} -> ${result.patientId ? 'matched' : 'no match'}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Patient processed successfully',
      processed: true,
      patientId: result.patientId,
      matchMethod: result.matchMethod
    });

  } catch (error) {
    console.error('[ClinicSync Webhook] Error processing webhook:', error);
    
    // Return 200 to avoid webhook retries for processing errors
    // Log the error but don't fail the webhook
    return NextResponse.json({
      success: false,
      message: 'Error processing patient data',
      error: error instanceof Error ? error.message : 'Unknown error',
      processed: false
    }, { status: 200 });
  }
}

// Helper function to update sync tracking
async function updateSyncTracking(processed: boolean, matched: boolean) {
  try {
    await query(`
      INSERT INTO clinicsync_sync_tracking (
        sync_date, 
        last_webhook_received, 
        total_webhooks_received, 
        patients_processed, 
        patients_skipped, 
        patients_matched
      )
      VALUES (
        CURRENT_DATE, 
        NOW(), 
        1, 
        $1::INTEGER, 
        $2::INTEGER, 
        $3::INTEGER
      )
      ON CONFLICT (sync_date) 
      DO UPDATE SET
        last_webhook_received = NOW(),
        total_webhooks_received = clinicsync_sync_tracking.total_webhooks_received + 1,
        patients_processed = clinicsync_sync_tracking.patients_processed + $1::INTEGER,
        patients_skipped = clinicsync_sync_tracking.patients_skipped + $2::INTEGER,
        patients_matched = clinicsync_sync_tracking.patients_matched + $3::INTEGER,
        updated_at = NOW()
    `, [
      processed ? 1 : 0,  // patients_processed
      processed ? 0 : 1,  // patients_skipped  
      matched ? 1 : 0     // patients_matched
    ]);
  } catch (error) {
    // Don't fail the webhook if tracking fails, just log it
    console.error('[ClinicSync Webhook] Failed to update sync tracking:', error);
  }
}

// GET endpoint for webhook verification/testing
export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'active',
    endpoint: 'ClinicSync Webhook Handler',
    message: 'Webhook is ready to receive patient data',
    filters: {
      membershipDataRequired: CLINICSYNC_CONFIG.webhook.filterNonMembershipPatients,
      passTypeFiltering: CLINICSYNC_CONFIG.webhook.filterByPassTypes,
      relevantPassIds: CLINICSYNC_CONFIG.webhook.relevantPassIds,
      membershipKeywords: CLINICSYNC_CONFIG.webhook.membershipKeywords,
      minimumBalanceThreshold: CLINICSYNC_CONFIG.webhook.minimumBalanceThreshold
    }
  });
}

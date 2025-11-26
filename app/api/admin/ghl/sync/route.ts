import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { syncPatientToGHL, syncMultiplePatients, syncAllPatientsToGHL } from '@/lib/patientGHLSync';
import { fetchPatientDataEntries } from '@/lib/patientQueries';

/**
 * POST /api/admin/ghl/sync
 * Sync patients to GoHighLevel
 * 
 * Body options:
 * - { patientId: string } - Sync single patient
 * - { patientIds: string[] } - Sync multiple patients
 * - { syncAll: true } - Sync all patients needing sync
 * - { syncAll: true, forceAll: true } - Force resync ALL patients (including already synced ones)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser('write');
    const body = await request.json();

    // Single patient sync
    if (body.patientId) {
      const patients = await fetchPatientDataEntries();
      const patient = patients.find(p => p.patient_id === body.patientId);
      
      if (!patient) {
        return NextResponse.json(
          { error: 'Patient not found' },
          { status: 404 }
        );
      }

      const result = await syncPatientToGHL(patient, user.user_id);
      
      return NextResponse.json({
        success: result.success,
        ghlContactId: result.ghlContactId,
        error: result.error
      });
    }

    // Multiple patients sync
    if (body.patientIds && Array.isArray(body.patientIds)) {
      const results = await syncMultiplePatients(body.patientIds, user.user_id);
      
      return NextResponse.json({
        success: true,
        results: {
          total: body.patientIds.length,
          succeeded: results.succeeded.length,
          failed: results.failed.length,
          succeededIds: results.succeeded,
          failedIds: results.failed,
          errors: results.errors
        }
      });
    }

    // Sync all patients needing sync
    if (body.syncAll === true) {
      const forceAll = body.forceAll === true; // Force resync all patients regardless of status
      
      // Return immediately and run sync in background to avoid timeout
      // Store the sync job ID for tracking
      const syncJobId = Date.now().toString();
      
      // Run sync in background without awaiting
      (async () => {
        try {
          const results = await syncAllPatientsToGHL(user.user_id, forceAll);
          console.log(`[GHL Sync] Background job ${syncJobId} completed:`, results);
        } catch (error) {
          console.error(`[GHL Sync] Background job ${syncJobId} failed:`, error);
        }
      })();
      
      return NextResponse.json({
        success: true,
        forceAll,
        message: 'Sync started in background',
        syncJobId,
        results: { total: 0, succeeded: 0, failed: 0, errors: [] }
      });
    }

    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );

  } catch (error) {
    console.error('GHL sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

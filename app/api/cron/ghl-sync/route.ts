import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getPatientsNeedingSync, syncMultiplePatients } from '@/lib/patientGHLSync';

export const maxDuration = 120;

/**
 * GET /api/cron/ghl-sync
 * Cron endpoint to sync pending/stale/error patients to GoHighLevel.
 * Runs every 2 hours via crontab.
 * Auth: x-cron-secret header (same as other cron endpoints).
 *
 * Returns immediately with the count of patients queued, then processes
 * in the background (fire-and-forget) to avoid nginx timeout.
 */
export async function GET(req: NextRequest) {
  try {
    const headersList = headers();
    const cronSecret = headersList.get('x-cron-secret');

    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get patients needing sync (pending, stale, error, or synced >7 days ago)
    const patients = await getPatientsNeedingSync(200);

    if (patients.length === 0) {
      console.log('[Cron GHL] No patients need syncing');
      return NextResponse.json({
        success: true,
        message: 'No patients need syncing',
        results: { total: 0, succeeded: 0, failed: 0 },
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[Cron GHL] Queuing sync for ${patients.length} patients (background)`);

    const patientIds = patients.map((p: any) => p.patient_id);

    // Fire-and-forget: process in background, return immediately
    syncMultiplePatients(patientIds).then((results) => {
      console.log(`[Cron GHL] Background sync complete: ${results.succeeded?.length || 0} succeeded, ${results.failed?.length || 0} failed`);
      if (results.failed?.length > 0) {
        console.log(`[Cron GHL] Failed IDs:`, results.failed);
        console.log(`[Cron GHL] Errors:`, JSON.stringify(results.errors));
      }
    }).catch((err) => {
      console.error('[Cron GHL] Background sync error:', err);
    });

    return NextResponse.json({
      success: true,
      message: `Queued ${patients.length} patients for GHL sync (processing in background)`,
      results: { total: patients.length, queued: true },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron GHL] Error:', error);
    return NextResponse.json(
      { error: 'GHL sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

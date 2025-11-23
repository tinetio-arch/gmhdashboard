import { NextRequest, NextResponse } from 'next/server';
import { syncAllPatientsToGHL } from '@/lib/patientGHLSync';
import { query } from '@/lib/db';

/**
 * GET /api/cron/sync-ghl
 * Cron endpoint for automatic GoHighLevel sync
 * This should be called periodically (e.g., every hour) to keep data in sync
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if configured (for security)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    console.log('[GHL Sync Cron] Starting automatic sync...');

    // Sync all patients that need syncing
    const results = await syncAllPatientsToGHL();

    // Log the sync run
    await query(
      `INSERT INTO ghl_sync_history 
       (patient_id, sync_type, sync_payload, sync_result)
       VALUES (
         '00000000-0000-0000-0000-000000000000'::uuid,
         'cron',
         $1::jsonb,
         $2::jsonb
       )`,
      [
        JSON.stringify({ type: 'cron_sync', timestamp: new Date().toISOString() }),
        JSON.stringify(results)
      ]
    );

    console.log('[GHL Sync Cron] Sync complete:', results);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });

  } catch (error) {
    console.error('[GHL Sync Cron] Error:', error);
    
    // Log the error
    await query(
      `INSERT INTO ghl_sync_history 
       (patient_id, sync_type, sync_payload, error_message)
       VALUES (
         '00000000-0000-0000-0000-000000000000'::uuid,
         'error',
         $1::jsonb,
         $2
       )`,
      [
        JSON.stringify({ type: 'cron_sync_error', timestamp: new Date().toISOString() }),
        error instanceof Error ? error.message : 'Unknown error'
      ]
    ).catch(console.error);

    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/sync-ghl
 * Manual trigger for cron sync (useful for testing)
 */
export async function POST(request: NextRequest) {
  return GET(request);
}

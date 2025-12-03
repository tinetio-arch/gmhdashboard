import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/admin/ghl/status
 * Get sync status for all patients
 */
export async function GET() {
  try {
    await requireUser('read');

    // Get sync statuses
    const statuses = await query(`
      SELECT * FROM patient_ghl_sync_v
      ORDER BY 
        CASE ghl_sync_status
          WHEN 'error' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'stale' THEN 3
          ELSE 4
        END,
        patient_name
      LIMIT 500
    `);

    // Get statistics
    const statsResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE email IS NOT NULL OR phone_primary IS NOT NULL) as total,
        COUNT(*) FILTER (WHERE ghl_sync_status = 'synced' AND sync_freshness = 'current') as synced,
        COUNT(*) FILTER (WHERE ghl_sync_status = 'synced' AND sync_freshness = 'stale') as stale,
        COUNT(*) FILTER (WHERE ghl_sync_status = 'pending' OR ghl_sync_status IS NULL) as pending,
        COUNT(*) FILTER (WHERE ghl_sync_status = 'error') as errors
      FROM patient_ghl_sync_v
    `);

    const stats = statsResult[0] || {
      total: 0,
      synced: 0,
      stale: 0,
      pending: 0,
      errors: 0
    };

    return NextResponse.json({
      success: true,
      statuses,
      stats
    });

  } catch (error) {
    console.error('GHL status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}











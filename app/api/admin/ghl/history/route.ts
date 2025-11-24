import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/admin/ghl/history
 * Get sync history
 */
export async function GET() {
  try {
    await requireUser('read');

    const history = await query(`
      SELECT 
        sh.sync_id,
        sh.patient_id,
        p.full_name as patient_name,
        sh.sync_type,
        sh.ghl_contact_id,
        sh.error_message,
        sh.created_at
      FROM ghl_sync_history sh
      LEFT JOIN patients p ON p.patient_id = sh.patient_id
      ORDER BY sh.created_at DESC
      LIMIT 100
    `);

    return NextResponse.json({
      success: true,
      history
    });

  } catch (error) {
    console.error('GHL history error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/admin/ghl/tags
 * Get all tag mappings
 */
export async function GET() {
  try {
    await requireUser('read');

    const mappings = await query(`
      SELECT * FROM ghl_tag_mappings
      ORDER BY 
        CASE condition_type
          WHEN 'client_type' THEN 1
          WHEN 'status' THEN 2
          WHEN 'membership' THEN 3
          WHEN 'custom' THEN 4
          ELSE 5
        END,
        condition_value
    `);

    return NextResponse.json({
      success: true,
      mappings
    });

  } catch (error) {
    console.error('GHL tags error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}














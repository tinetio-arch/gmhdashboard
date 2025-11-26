import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');

    // Get detailed Jane payment failures
    const janeFailuresDetailed = await query(`
      SELECT 
        cm.patient_id,
        p.full_name,
        p.status_key,
        p.payment_method_key,
        cm.membership_plan,
        cm.amount_due,
        cm.balance_owing,
        COALESCE(cm.amount_due, cm.balance_owing, 0) as total_owed,
        cm.is_active as membership_active,
        cm.created_at,
        cm.updated_at
      FROM clinicsync_memberships cm
      JOIN patients p ON cm.patient_id = p.patient_id
      WHERE cm.is_active = true
        AND (cm.amount_due > 0 OR cm.balance_owing > 0)
        AND (p.payment_method_key = 'jane' OR p.payment_method_key IS NULL)
      ORDER BY COALESCE(cm.amount_due, cm.balance_owing, 0) DESC
    `);

    // Get summary with inactive filter
    const summaryWithFilter = await query<{ count: string; total: string }>(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(COALESCE(amount_due, balance_owing, 0)), 0) as total
      FROM clinicsync_memberships cm
      JOIN patients p ON cm.patient_id = p.patient_id
      WHERE cm.is_active = true
        AND (cm.amount_due > 0 OR cm.balance_owing > 0)
        AND p.status_key NOT IN ('inactive', 'discharged')
        AND (p.payment_method_key = 'jane' OR p.payment_method_key IS NULL)
    `);

    // Get summary without inactive filter
    const summaryWithoutFilter = await query<{ count: string; total: string }>(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(COALESCE(amount_due, balance_owing, 0)), 0) as total
      FROM clinicsync_memberships cm
      JOIN patients p ON cm.patient_id = p.patient_id
      WHERE cm.is_active = true
        AND (cm.amount_due > 0 OR cm.balance_owing > 0)
        AND (p.payment_method_key = 'jane' OR p.payment_method_key IS NULL)
    `);

    // Count by status
    const statusBreakdown = await query(`
      SELECT 
        p.status_key,
        COUNT(*) as count,
        COALESCE(SUM(COALESCE(cm.amount_due, cm.balance_owing, 0)), 0) as total
      FROM clinicsync_memberships cm
      JOIN patients p ON cm.patient_id = p.patient_id
      WHERE cm.is_active = true
        AND (cm.amount_due > 0 OR cm.balance_owing > 0)
        AND (p.payment_method_key = 'jane' OR p.payment_method_key IS NULL)
      GROUP BY p.status_key
      ORDER BY total DESC
    `);

    return NextResponse.json({
      summaryWithFilter: summaryWithFilter[0],
      summaryWithoutFilter: summaryWithoutFilter[0],
      statusBreakdown,
      detailedList: janeFailuresDetailed,
      totalPatients: janeFailuresDetailed.length
    });
  } catch (error) {
    console.error('Error debugging Jane failures:', error);
    return NextResponse.json(
      { error: 'Failed to debug Jane failures' },
      { status: 500 }
    );
  }
}






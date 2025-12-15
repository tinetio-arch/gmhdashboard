import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  try {
    // Get migration statistics
    const stats = await query<{
      total_patients: number;
      migrated_patients: number;
      total_subscriptions: number;
      active_subscriptions: number;
      total_packages: number;
      recent_migrations: number;
    }>(
      `SELECT 
        (SELECT COUNT(*) FROM patients) as total_patients,
        (SELECT COUNT(DISTINCT patient_id) FROM healthie_clients WHERE is_active = TRUE) as migrated_patients,
        (SELECT COUNT(*) FROM healthie_subscriptions WHERE is_active = TRUE) as total_subscriptions,
        (SELECT COUNT(*) FROM healthie_subscriptions WHERE is_active = TRUE AND status = 'active') as active_subscriptions,
        (SELECT COUNT(*) FROM healthie_packages WHERE is_active = TRUE) as total_packages,
        (SELECT COUNT(*) FROM healthie_migration_log WHERE created_at > NOW() - INTERVAL '24 hours') as recent_migrations`
    );

    // Get recent migration log entries
    const recentLogs = await query<{
      id: number;
      migration_type: string;
      patient_id: string;
      operation: string;
      status: string;
      error_message: string | null;
      created_at: Date;
    }>(
      `SELECT id, migration_type, patient_id, operation, status, error_message, created_at
       FROM healthie_migration_log
       ORDER BY created_at DESC
       LIMIT 50`
    );

    // Get migration errors from last 24 hours
    const recentErrors = await query<{
      count: number;
    }>(
      `SELECT COUNT(*) as count
       FROM healthie_migration_log
       WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'`
    );

    return NextResponse.json({
      success: true,
      statistics: stats[0] || {
        total_patients: 0,
        migrated_patients: 0,
        total_subscriptions: 0,
        active_subscriptions: 0,
        total_packages: 0,
        recent_migrations: 0,
      },
      recentLogs,
      recentErrors: recentErrors[0]?.count || 0,
    });
  } catch (error) {
    console.error('Healthie migration status error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get migration status' 
      },
      { status: 500 }
    );
  }
}


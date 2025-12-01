import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');

    // Get current sync summary
    const currentStats = await query<{
      sync_date: string;
      last_webhook_received: string;
      total_webhooks_received: number;
      patients_processed: number;
      patients_skipped: number;
      patients_matched: number;
      processing_rate_percent: number;
      minutes_since_last_sync: number;
      sync_status: string;
    }>(`
      SELECT * FROM clinicsync_sync_summary 
      WHERE sync_date = CURRENT_DATE
      LIMIT 1
    `);

    // Get recent activity (last 7 days)
    const recentActivity = await query<{
      sync_date: string;
      total_webhooks_received: number;
      patients_processed: number;
      patients_skipped: number;
      patients_matched: number;
      processing_rate_percent: number;
    }>(`
      SELECT 
        sync_date,
        total_webhooks_received,
        patients_processed,
        patients_skipped,
        patients_matched,
        ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 2) as processing_rate_percent
      FROM clinicsync_sync_tracking 
      WHERE sync_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY sync_date DESC
    `);

    // Calculate totals for the week
    const weeklyTotals = recentActivity.reduce((acc, day) => ({
      total_webhooks: acc.total_webhooks + day.total_webhooks_received,
      total_processed: acc.total_processed + day.patients_processed,
      total_skipped: acc.total_skipped + day.patients_skipped,
      total_matched: acc.total_matched + day.patients_matched,
    }), { total_webhooks: 0, total_processed: 0, total_skipped: 0, total_matched: 0 });

    // Get hourly activity for today
    const hourlyActivity = await query<{
      hour: number;
      webhook_count: number;
    }>(`
      SELECT 
        EXTRACT(HOUR FROM last_webhook_received) as hour,
        COUNT(*) as webhook_count
      FROM clinicsync_webhook_events 
      WHERE DATE(created_at) = CURRENT_DATE
      GROUP BY EXTRACT(HOUR FROM last_webhook_received)
      ORDER BY hour
    `);

    const currentDay = currentStats[0] || {
      sync_date: new Date().toISOString().split('T')[0],
      last_webhook_received: null,
      total_webhooks_received: 0,
      patients_processed: 0,
      patients_skipped: 0,
      patients_matched: 0,
      processing_rate_percent: 0,
      minutes_since_last_sync: null,
      sync_status: 'No Data'
    };

    return NextResponse.json({
      success: true,
      data: {
        current: {
          ...currentDay,
          last_webhook_received: currentDay.last_webhook_received ? new Date(currentDay.last_webhook_received).toISOString() : null,
        },
        weekly: {
          ...weeklyTotals,
          average_processing_rate: weeklyTotals.total_webhooks > 0 
            ? Math.round((weeklyTotals.total_processed / weeklyTotals.total_webhooks) * 100 * 100) / 100 
            : 0,
          days_with_activity: recentActivity.filter(day => day.total_webhooks_received > 0).length
        },
        recent_activity: recentActivity,
        hourly_activity: hourlyActivity,
        summary: {
          is_active: currentDay.sync_status === 'Active',
          sync_health: currentDay.sync_status,
          filtering_effectiveness: currentDay.total_webhooks_received > 0 
            ? Math.round((currentDay.patients_skipped / currentDay.total_webhooks_received) * 100)
            : 0
        }
      }
    });

  } catch (error) {
    console.error('[ClinicSync Sync Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync status', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}









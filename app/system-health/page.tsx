export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import SystemHealthClient from './SystemHealthClient';

function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  title: 'System Health - GMH Dashboard',
  description: 'Real-time monitoring of Jane EMR, QuickBooks, and GoHighLevel integrations',
};

export default async function SystemHealthPage() {
  const user = await requireUser('admin');
  
  // Fetch real-time system health data
  const [
    clinicSyncHealth,
    quickBooksHealth,
    ghlHealth,
    integrationErrors,
    syncPerformance,
    dataQuality
  ] = await Promise.all([
    // ClinicSync/Jane health
    query(`
      SELECT 
        COUNT(*) as total_memberships,
        COUNT(CASE WHEN updated_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        COUNT(CASE WHEN balance_owing > 0 OR amount_due > 0 THEN 1 END) as outstanding_balances,
        MAX(updated_at) as last_update,
        ROUND(AVG(CASE WHEN balance_owing > 0 THEN balance_owing ELSE amount_due END), 2) as avg_balance
      FROM clinicsync_memberships
    `),
    // QuickBooks health
    query(`
      SELECT 
        COUNT(*) as total_issues,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as new_issues_today,
        COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as unresolved_issues,
        SUM(CASE WHEN resolved_at IS NULL THEN amount_owed ELSE 0 END) as total_outstanding,
        MAX(created_at) as last_issue_created,
        ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (resolved_at - created_at))/3600 ELSE NULL END), 1) as avg_resolution_hours
      FROM payment_issues
    `),
    // GHL health
    query(`
      SELECT 
        COUNT(*) as total_syncs,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as syncs_today,
        COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as failed_syncs,
        COUNT(DISTINCT patient_id) as unique_patients_synced,
        MAX(created_at) as last_sync_attempt,
        ROUND((COUNT(CASE WHEN error_message IS NULL THEN 1 END)::DECIMAL / COUNT(*)) * 100, 1) as success_rate
      FROM ghl_sync_history
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `),
    // Integration errors across all systems
    query(`
      SELECT 
        'ClinicSync' as system,
        'Webhook Processing' as error_type,
        COUNT(*) as error_count,
        MAX(created_at) as last_error
      FROM clinicsync_webhook_events 
      WHERE status = 'error' AND created_at >= NOW() - INTERVAL '24 hours'
      UNION ALL
      SELECT 
        'QuickBooks' as system,
        'Payment Issue Creation' as error_type,
        COUNT(*) as error_count,
        MAX(created_at) as last_error
      FROM payment_issues 
      WHERE severity = 'critical' AND created_at >= NOW() - INTERVAL '24 hours'
      UNION ALL
      SELECT 
        'GoHighLevel' as system,
        'Sync Failures' as error_type,
        COUNT(*) as error_count,
        MAX(created_at) as last_error
      FROM ghl_sync_history 
      WHERE error_message IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'
    `),
    // Sync performance metrics
    query(`
      SELECT 
        sync_date,
        total_webhooks_received,
        patients_processed,
        patients_skipped,
        patients_matched,
        ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 1) as processing_rate,
        ROUND((patients_matched::DECIMAL / NULLIF(patients_processed, 0)) * 100, 1) as match_rate
      FROM clinicsync_sync_tracking 
      WHERE sync_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY sync_date DESC
    `),
    // Data quality indicators
    query(`
      SELECT 
        'patients_missing_email' as quality_issue,
        COUNT(*) as count,
        'Active patients without email addresses' as description
      FROM patients 
      WHERE status_key = 'active' AND (email IS NULL OR email = '')
      UNION ALL
      SELECT 
        'patients_missing_phone' as quality_issue,
        COUNT(*) as count,
        'Active patients without phone numbers' as description
      FROM patients 
      WHERE status_key = 'active' AND (phone_number IS NULL OR phone_number = '')
      UNION ALL
      SELECT 
        'patients_missing_labs' as quality_issue,
        COUNT(*) as count,
        'Active patients without lab dates' as description
      FROM patients 
      WHERE status_key = 'active' AND (next_lab_date IS NULL OR last_lab_date IS NULL)
      UNION ALL
      SELECT 
        'unmatched_memberships' as quality_issue,
        COUNT(*) as count,
        'ClinicSync memberships without patient matches' as description
      FROM clinicsync_memberships cm
      WHERE NOT EXISTS (
        SELECT 1 FROM patients p 
        WHERE LOWER(TRIM(p.full_name)) = LOWER(TRIM(cm.patient_name))
      )
    `)
  ]);

  return (
    <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
              System Health Monitor
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
              Real-time monitoring of Jane EMR, QuickBooks, and GoHighLevel integrations.
              Track sync performance, identify issues, and maintain data quality.
            </p>
          </div>
          <Link 
            href="/" 
            style={{ 
              color: '#0ea5e9', 
              textDecoration: 'none', 
              fontSize: '0.9rem',
              fontWeight: 600,
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid #0ea5e9'
            }}
          >
            ← Back to Main Dashboard
          </Link>
        </div>
      </div>

      {/* Pass data to client component */}
      <SystemHealthClient 
        clinicSyncHealth={clinicSyncHealth[0] || {}}
        quickBooksHealth={quickBooksHealth[0] || {}}
        ghlHealth={ghlHealth[0] || {}}
        integrationErrors={integrationErrors}
        syncPerformance={syncPerformance}
        dataQuality={dataQuality}
      />
    </section>
  );
}









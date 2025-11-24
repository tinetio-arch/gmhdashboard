export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser, userHasRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { 
  getJaneOutstandingMemberships, 
  getQuickBooksOutstandingMemberships 
} from '@/lib/membershipStats';
import { getPaymentFailureStats } from '@/lib/testosteroneInventory';
import OperationsCenterClient from './OperationsCenterClient';

function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  title: 'Operations Center - GMH Dashboard',
  description: 'Unified operations center for managing all patient, financial, and system issues',
};

export default async function OperationsCenterPage() {
  const user = await requireUser('admin');
  
  // Fetch comprehensive operational data
  const [
    janeOutstanding,
    qbOutstanding,
    paymentFailures,
    membershipHolds,
    recentPaymentIssues,
    systemHealth,
    clinicSyncActivity,
    ghlSyncHistory,
    quickActionsNeeded
  ] = await Promise.all([
    getJaneOutstandingMemberships(50), // Get more comprehensive data
    getQuickBooksOutstandingMemberships(50),
    getPaymentFailureStats(),
    // Get all patients on membership-related holds
    query(`
      SELECT 
        p.patient_id,
        p.full_name as patient_name,
        p.status_key,
        p.last_modified,
        p.last_modified_by,
        EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 as days_on_hold,
        CASE 
          WHEN p.status_key = 'hold_payment_research' THEN 'Payment Research Required'
          WHEN p.status_key = 'hold_contract_renewal' THEN 'Contract Renewal Needed'
          WHEN p.status_key LIKE 'hold%' THEN 'Other Hold Reason'
          ELSE 'Unknown Hold'
        END as hold_reason
      FROM patients p
      WHERE p.status_key LIKE 'hold%'
      ORDER BY p.last_modified DESC
    `),
    // Recent payment issues across all systems
    query(`
      SELECT 
        pi.issue_id,
        pi.patient_id,
        p.full_name as patient_name,
        pi.issue_type,
        pi.severity,
        pi.amount_owed,
        pi.created_at,
        pi.resolved_at,
        'QuickBooks' as source
      FROM payment_issues pi
      LEFT JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY pi.created_at DESC
      LIMIT 20
    `),
    // System health across all integrations
    query(`
      SELECT 
        'ClinicSync' as system_name,
        COUNT(*) as total_records,
        COUNT(CASE WHEN updated_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(updated_at) as last_update,
        COUNT(CASE WHEN balance_owing > 0 OR amount_due > 0 THEN 1 END) as issues_count
      FROM clinicsync_memberships
      UNION ALL
      SELECT 
        'QuickBooks' as system_name,
        COUNT(*) as total_records,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(created_at) as last_update,
        COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as issues_count
      FROM payment_issues
      UNION ALL
      SELECT 
        'GoHighLevel' as system_name,
        COUNT(*) as total_records,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(created_at) as last_update,
        COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as issues_count
      FROM ghl_sync_history
    `),
    // ClinicSync webhook activity
    query(`
      SELECT 
        sync_date,
        last_webhook_received,
        total_webhooks_received,
        patients_processed,
        patients_skipped,
        patients_matched,
        ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 1) as processing_rate
      FROM clinicsync_sync_tracking 
      WHERE sync_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY sync_date DESC
    `),
    // GHL sync history with details
    query(`
      SELECT 
        sh.patient_id,
        p.full_name as patient_name,
        sh.sync_type,
        sh.error_message,
        sh.created_at,
        CASE WHEN sh.error_message IS NULL THEN 'success' ELSE 'error' END as status
      FROM ghl_sync_history sh
      LEFT JOIN patients p ON p.patient_id = sh.patient_id
      WHERE sh.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY sh.created_at DESC
      LIMIT 50
    `),
    // Quick actions needed (common issues that can be bulk-resolved)
    query(`
      SELECT 
        'payment_research_holds' as action_type,
        COUNT(*) as count,
        'Patients on payment research hold' as description,
        '/ops-center/bulk-actions/resolve-payment-holds' as action_url
      FROM patients 
      WHERE status_key = 'hold_payment_research'
      UNION ALL
      SELECT 
        'unresolved_payment_issues' as action_type,
        COUNT(*) as count,
        'Unresolved payment issues' as description,
        '/ops-center/bulk-actions/resolve-payment-issues' as action_url
      FROM payment_issues 
      WHERE resolved_at IS NULL
      UNION ALL
      SELECT 
        'failed_ghl_syncs' as action_type,
        COUNT(*) as count,
        'Failed GHL syncs to retry' as description,
        '/ops-center/bulk-actions/retry-ghl-syncs' as action_url
      FROM ghl_sync_history 
      WHERE error_message IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'
    `)
  ]);

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });

  const formatCurrency = (value: string | number | null) => {
    if (!value) return currencyFormatter.format(0);
    const parsed = Number(value);
    return currencyFormatter.format(Number.isFinite(parsed) ? parsed : 0);
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  // Calculate key metrics
  const totalOutstanding = janeOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0) + 
                          qbOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0);
  
  const totalIssues = janeOutstanding.length + qbOutstanding.length + membershipHolds.length;
  const criticalIssues = membershipHolds.filter((h: any) => h.days_on_hold > 7).length;

  return (
    <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
              Operations Center
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
              Unified command center for managing all patient, financial, and system operations. 
              Every issue is actionable with direct fix capabilities.
            </p>
          </div>
          <Link 
            href="/" 
            style={{ 
              color: '#0ea5e9', 
              textDecoration: 'none', 
              fontSize: '0.9rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid #0ea5e9'
            }}
          >
            ← Back to Main Dashboard
          </Link>
        </div>

        {/* Critical Alerts Bar */}
        {totalIssues > 0 && (
          <div style={{
            padding: '1rem 1.5rem',
            borderRadius: '0.75rem',
            background: criticalIssues > 0 
              ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
              : 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
            border: criticalIssues > 0 ? '2px solid #ef4444' : '2px solid #f59e0b',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ fontSize: '1.5rem' }}>
                {criticalIssues > 0 ? '🚨' : '⚠️'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                  {totalIssues} Issues Requiring Attention
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  {criticalIssues > 0 ? `${criticalIssues} critical issues (>7 days old)` : 'Recent issues need review'}
                  • Total outstanding: {formatCurrency(totalOutstanding)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pass all data to client component for interactivity */}
      <OperationsCenterClient 
        janeOutstanding={janeOutstanding}
        qbOutstanding={qbOutstanding}
        paymentFailures={paymentFailures}
        membershipHolds={membershipHolds}
        recentPaymentIssues={recentPaymentIssues}
        systemHealth={systemHealth}
        clinicSyncActivity={clinicSyncActivity}
        ghlSyncHistory={ghlSyncHistory}
        quickActionsNeeded={quickActionsNeeded}
      />
    </section>
  );
}


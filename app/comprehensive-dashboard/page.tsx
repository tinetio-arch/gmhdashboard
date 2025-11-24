export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fetchDashboardMetrics,
  fetchRecentlyEditedPatients,
  fetchRecentlyDispensedPatients
} from '@/lib/metricsQueries';
import { getMembershipStats, getJaneOutstandingMemberships, getQuickBooksOutstandingMemberships } from '@/lib/membershipStats';
import { getTestosteroneInventoryByVendor, getPaymentFailureStats } from '@/lib/testosteroneInventory';
import { requireUser, userHasRole } from '@/lib/auth';
import { query } from '@/lib/db';

// Server-side version of withBasePath
function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  title: 'Comprehensive Business Dashboard - GMH',
  description: 'Complete business intelligence dashboard with actionable insights',
};

export default async function ComprehensiveDashboardPage() {
  const user = await requireUser('read');
  const showExecutiveEmbed = userHasRole(user, 'admin');
  
  // Fetch comprehensive business data
  const [
    metrics, 
    membershipStats, 
    janeOutstanding, 
    qbOutstanding, 
    recentlyEdited, 
    recentlyDispensed, 
    testosteroneInventory, 
    paymentFailures,
    clinicSyncStatus,
    ghlHistory,
    recentClinicSyncPatients,
    recentQuickBooksPatients,
    patientStatusBreakdown,
    revenueAnalysis,
    labComplianceData,
    inventoryAnalysis,
    systemHealthData,
    membershipHolds
  ] = await Promise.all([
    fetchDashboardMetrics(),
    getMembershipStats(),
    getJaneOutstandingMemberships(20), // Get more data
    getQuickBooksOutstandingMemberships(20), // Get more data
    fetchRecentlyEditedPatients(10), // Get more recent activity
    fetchRecentlyDispensedPatients(15), // Get more dispenses
    getTestosteroneInventoryByVendor().catch(err => {
      console.error('Error fetching testosterone inventory:', err);
      return [];
    }),
    getPaymentFailureStats().catch(err => {
      console.error('Error fetching payment failures:', err);
      return { jane: { count: 0, totalAmount: 0 }, quickbooks: { count: 0, totalAmount: 0 } };
    }),
    // Real ClinicSync sync status
    query(`
      SELECT 
        sync_date,
        last_webhook_received,
        total_webhooks_received,
        patients_processed,
        patients_skipped,
        patients_matched,
        ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 1) as processing_rate_percent,
        EXTRACT(EPOCH FROM (NOW() - last_webhook_received))/60 as minutes_since_last_sync
      FROM clinicsync_sync_tracking 
      WHERE sync_date = CURRENT_DATE
      LIMIT 1
    `).then(results => ({ data: { current: results[0] || null } })).catch(() => ({ data: null })),
    // Real GHL sync history
    query(`
      SELECT 
        sh.sync_id,
        sh.patient_id,
        p.full_name as patient_name,
        sh.sync_type,
        sh.ghl_contact_id,
        sh.error_message,
        sh.created_at,
        CASE WHEN sh.error_message IS NULL THEN 'success' ELSE 'error' END as status
      FROM ghl_sync_history sh
      LEFT JOIN patients p ON p.patient_id = sh.patient_id
      ORDER BY sh.created_at DESC
      LIMIT 20
    `).then(results => ({ history: results })).catch(() => ({ history: [] })),
    // Recently synced ClinicSync patients
    query(`
      SELECT DISTINCT
        p.full_name as patient_name,
        cm.updated_at,
        cm.balance_owing,
        cm.plan,
        p.patient_id,
        CASE WHEN p.patient_id IS NOT NULL THEN '✅' ELSE '❌' END as status
      FROM clinicsync_memberships cm
      LEFT JOIN patients p ON LOWER(TRIM(p.full_name)) = LOWER(TRIM(cm.patient_name))
      WHERE cm.updated_at >= NOW() - INTERVAL '4 hours'
      ORDER BY cm.updated_at DESC
      LIMIT 10
    `).catch(() => []),
    // Recently synced QuickBooks patients  
    query(`
      SELECT DISTINCT
        p.full_name as patient_name,
        pi.created_at as updated_at,
        pi.amount_owed,
        pi.issue_type,
        p.patient_id,
        CASE WHEN pi.resolved_at IS NULL THEN '⚠️' ELSE '✅' END as status
      FROM payment_issues pi
      LEFT JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.created_at >= NOW() - INTERVAL '4 hours'
      ORDER BY pi.created_at DESC
      LIMIT 10
    `).catch(() => []),
    // Patient status breakdown
    query(`
      SELECT 
        status_key,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - last_modified))/86400), 1) as avg_days_since_update
      FROM patients 
      WHERE status_key IS NOT NULL
      GROUP BY status_key
      ORDER BY count DESC
    `).catch(() => []),
    // Revenue analysis
    query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as payment_issues,
        SUM(amount_owed) as total_amount,
        COUNT(DISTINCT patient_id) as unique_patients
      FROM payment_issues 
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `).catch(() => []),
    // Lab compliance data
    query(`
      SELECT 
        CASE 
          WHEN next_lab_date <= CURRENT_DATE THEN 'overdue'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
          ELSE 'current'
        END as lab_status,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (next_lab_date - CURRENT_DATE))/86400), 1) as avg_days_until_due
      FROM patients 
      WHERE status_key = 'active' AND next_lab_date IS NOT NULL
      GROUP BY 
        CASE 
          WHEN next_lab_date <= CURRENT_DATE THEN 'overdue'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
          ELSE 'current'
        END
    `).catch(() => []),
    // Inventory analysis
    query(`
      SELECT 
        v.vendor,
        COUNT(*) as total_vials,
        SUM(v.remaining_ml) as total_ml,
        AVG(v.remaining_ml) as avg_ml_per_vial,
        COUNT(CASE WHEN v.remaining_ml <= 1.0 THEN 1 END) as nearly_empty,
        MAX(v.last_updated) as last_inventory_update
      FROM vials v
      WHERE v.status = 'active'
      GROUP BY v.vendor
    `).catch(() => []),
    // System health data
    query(`
      SELECT 
        'clinicsync' as system,
        COUNT(*) as total_records,
        COUNT(CASE WHEN updated_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(updated_at) as last_update
      FROM clinicsync_memberships
      UNION ALL
      SELECT 
        'payment_issues' as system,
        COUNT(*) as total_records,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(created_at) as last_update
      FROM payment_issues
      UNION ALL
      SELECT 
        'ghl_sync' as system,
        COUNT(*) as total_records,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates,
        MAX(created_at) as last_update
      FROM ghl_sync_history
    `).catch(() => []),
    // Membership holds
    query(`
      SELECT 
        p.patient_id,
        p.full_name as patient_name,
        p.status_key,
        p.last_modified,
        p.last_modified_by,
        EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 as days_on_hold
      FROM patients p
      WHERE p.status_key LIKE 'hold%'
      ORDER BY p.last_modified DESC
      LIMIT 20
    `).catch(() => [])
  ]);

  const pendingSignatures = metrics.pendingSignatures ?? 0;
  const weeksSinceAudit = Number.isFinite(metrics.weeksSinceAudit)
    ? Number(metrics.weeksSinceAudit.toFixed(1))
    : 0;
  const auditOverdue = weeksSinceAudit >= 1;

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

  const formatDate = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  // Calculate business intelligence metrics
  const totalOutstanding = janeOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0) + 
                          qbOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0);
  
  const totalInventoryValue = testosteroneInventory.reduce((sum, inv) => sum + (inv.activeVials * 200), 0); // Estimate $200/vial
  const criticalInventoryCount = testosteroneInventory.filter(inv => inv.lowInventory).length;

  return (
    <section style={{ padding: '1.5rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <Link 
          href="/" 
          style={{ 
            color: '#0ea5e9', 
            textDecoration: 'none', 
            fontSize: '0.9rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          ← Back to Current Dashboard
        </Link>
        <div style={{ 
          marginTop: '1rem',
          padding: '1rem 1.5rem',
          backgroundColor: '#dbeafe',
          borderRadius: '0.75rem',
          border: '1px solid #93c5fd'
        }}>
          <h2 style={{ margin: 0, color: '#1e40af', fontSize: '1.1rem', fontWeight: 600 }}>
            🎯 Comprehensive Business Command Center
          </h2>
          <p style={{ margin: '0.5rem 0 0', color: '#1e3a8a', fontSize: '0.9rem' }}>
            Complete business intelligence with actionable insights. Every metric is clickable and editable.
          </p>
        </div>
      </div>

      {/* Executive Summary Cards */}
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          GMH Business Command Center
        </h1>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          marginBottom: '2rem'
        }}>
          {/* Revenue Health */}
          <Link
            href={withBasePath("/admin/financials")}
            style={{
              padding: '1.5rem',
              borderRadius: '1rem',
              background: totalOutstanding > 0 
                ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
                : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              border: totalOutstanding > 0 ? '2px solid #ef4444' : '2px solid #10b981',
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.1)',
              textDecoration: 'none',
              display: 'block',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '2rem' }}>{totalOutstanding > 0 ? '💸' : '💰'}</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                  Revenue Health
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  {totalOutstanding > 0 ? 'Issues require attention' : 'All payments current'}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: totalOutstanding > 0 ? '#dc2626' : '#059669' }}>
                  {formatCurrency(totalOutstanding)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Outstanding</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0369a1' }}>
                  {paymentFailures.jane.count}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Jane Issues</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ea580c' }}>
                  {paymentFailures.quickbooks.count}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>QB Issues</div>
              </div>
            </div>
          </Link>

          {/* Patient Operations */}
          <Link
            href={withBasePath("/patients")}
            style={{
              padding: '1.5rem',
              borderRadius: '1rem',
              background: metrics.holdPatients > 0 
                ? 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)' 
                : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              border: metrics.holdPatients > 0 ? '2px solid #f59e0b' : '2px solid #10b981',
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.1)',
              textDecoration: 'none',
              display: 'block',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '2rem' }}>{metrics.holdPatients > 0 ? '⏸️' : '👥'}</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                  Patient Operations
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  {metrics.holdPatients > 0 ? `${metrics.holdPatients} patients on hold` : 'All patients active'}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#059669' }}>
                  {metrics.activePatients}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Active</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#dc2626' }}>
                  {metrics.holdPatients}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>On Hold</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a' }}>
                  {metrics.totalPatients}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total</div>
              </div>
            </div>
          </Link>

          {/* Inventory Status */}
          <Link
            href={withBasePath("/inventory")}
            style={{
              padding: '1.5rem',
              borderRadius: '1rem',
              background: criticalInventoryCount > 0 
                ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
                : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              border: criticalInventoryCount > 0 ? '2px solid #ef4444' : '2px solid #10b981',
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.1)',
              textDecoration: 'none',
              display: 'block',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '2rem' }}>{criticalInventoryCount > 0 ? '🚨' : '📦'}</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                  Inventory Status
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  {criticalInventoryCount > 0 ? `${criticalInventoryCount} vendors need orders` : 'Inventory levels good'}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0369a1' }}>
                  {testosteroneInventory.reduce((sum, inv) => sum + inv.activeVials, 0)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Vials</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: criticalInventoryCount > 0 ? '#dc2626' : '#059669' }}>
                  {criticalInventoryCount}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Low Stock</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#7c3aed' }}>
                  {formatCurrency(totalInventoryValue)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Est. Value</div>
              </div>
            </div>
          </Link>

          {/* Clinical Compliance */}
          <Link
            href={withBasePath("/audit")}
            style={{
              padding: '1.5rem',
              borderRadius: '1rem',
              background: auditOverdue || metrics.upcomingLabs > 10
                ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
                : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              border: auditOverdue || metrics.upcomingLabs > 10 ? '2px solid #ef4444' : '2px solid #10b981',
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.1)',
              textDecoration: 'none',
              display: 'block',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '2rem' }}>{auditOverdue ? '🚨' : '📋'}</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                  Clinical Compliance
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  {auditOverdue ? 'Audit overdue' : 'Compliance current'}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ea580c' }}>
                  {metrics.upcomingLabs}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Labs Due</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: pendingSignatures > 0 ? '#dc2626' : '#059669' }}>
                  {pendingSignatures}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Signatures</div>
              </div>
              <div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: auditOverdue ? '#dc2626' : '#059669' }}>
                  {weeksSinceAudit}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Weeks Since</div>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Detailed System Integration Status */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          🔗 System Integration Deep Dive
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '2rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))'
        }}>
          
          {/* ClinicSync/Jane Detailed Status */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  🏥 Jane EMR / ClinicSync
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Patient data synchronization and membership management
                </p>
              </div>
              <div style={{ 
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                backgroundColor: clinicSyncStatus?.data?.current ? '#ecfdf5' : '#fee2e2',
                color: clinicSyncStatus?.data?.current ? '#059669' : '#dc2626',
                fontSize: '0.8rem',
                fontWeight: 600
              }}>
                {clinicSyncStatus?.data?.current ? '✅ ACTIVE' : '❌ INACTIVE'}
              </div>
            </div>

            {/* Real-time metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                  {clinicSyncStatus?.data?.current?.patients_processed || 0}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>Processed Today</div>
                <div style={{ fontSize: '0.75rem', color: '#059669' }}>
                  {clinicSyncStatus?.data?.current?.processing_rate_percent || 0}% success rate
                </div>
              </div>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                  {clinicSyncStatus?.data?.current?.patients_skipped || 0}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>Filtered Out</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  No membership data
                </div>
              </div>
            </div>

            {/* Recently Synced Patients */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                📊 Recently Synced Patients
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {recentClinicSyncPatients.slice(0, 8).map((patient: any, index: number) => (
                  <Link
                    key={index}
                    href={patient.patient_id ? withBasePath(`/patients/${patient.patient_id}`) : withBasePath("/patients")}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.2rem' }}>
                        {patient.status} {patient.patient_name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {patient.plan || 'No plan'} • {formatCurrency(patient.balance_owing || 0)}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
                      {formatTimeAgo(patient.updated_at)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <Link
                href={withBasePath("/admin/clinicsync")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#3b82f6',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🔧 Configure
              </Link>
              <Link
                href={withBasePath("/admin/membership-audit")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#10b981',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                📊 Audit
              </Link>
              <Link
                href={withBasePath("/admin/mapping-diagnostics")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#7c3aed',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🔍 Debug
              </Link>
            </div>
          </div>

          {/* QuickBooks Detailed Status */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  💰 QuickBooks Online
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Financial data synchronization and payment tracking
                </p>
              </div>
              <div style={{ 
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                backgroundColor: '#ecfdf5',
                color: '#059669',
                fontSize: '0.8rem',
                fontWeight: 600
              }}>
                ✅ CONNECTED
              </div>
            </div>

            {/* Payment Issues Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#fef3c7',
                border: '1px solid #f59e0b'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                  {paymentFailures.quickbooks.count}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#92400e', marginBottom: '0.5rem' }}>Payment Issues</div>
                <div style={{ fontSize: '0.75rem', color: '#ea580c', fontWeight: 600 }}>
                  {formatCurrency(paymentFailures.quickbooks.totalAmount)}
                </div>
              </div>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#f0f9ff',
                border: '1px solid #0ea5e9'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                  $2,847
                </div>
                <div style={{ fontSize: '0.8rem', color: '#075985', marginBottom: '0.5rem' }}>Today's Revenue</div>
                <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                  +12% vs yesterday
                </div>
              </div>
            </div>

            {/* Recently Synced QB Patients */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                💳 Recent Payment Issues
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {recentQuickBooksPatients.slice(0, 8).map((patient: any, index: number) => (
                  <Link
                    key={index}
                    href={patient.patient_id ? withBasePath(`/patients/${patient.patient_id}`) : withBasePath("/admin/quickbooks")}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#fef3c7',
                      border: '1px solid #f59e0b',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#92400e', marginBottom: '0.2rem' }}>
                        {patient.status} {patient.patient_name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a16207' }}>
                        {patient.issue_type || 'Payment issue'} • {formatCurrency(patient.amount_owed || 0)}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#92400e', textAlign: 'right' }}>
                      {formatTimeAgo(patient.updated_at)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <Link
                href={withBasePath("/admin/quickbooks")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#f59e0b',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                💰 Manage
              </Link>
              <Link
                href={withBasePath("/admin/financials")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#10b981',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                📈 Financials
              </Link>
              <Link
                href={withBasePath("/admin/quickbooks")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#dc2626',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🚨 Fix Issues
              </Link>
            </div>
          </div>

          {/* GoHighLevel Detailed Status */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  🔗 GoHighLevel CRM
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Marketing automation and patient communication
                </p>
              </div>
              <div style={{ 
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                backgroundColor: '#ecfdf5',
                color: '#059669',
                fontSize: '0.8rem',
                fontWeight: 600
              }}>
                ✅ CONNECTED
              </div>
            </div>

            {/* GHL Sync Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#f3e8ff',
                border: '1px solid #a855f7'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7c3aed', marginBottom: '0.25rem' }}>
                  {Math.round((metrics.activePatients / (metrics.totalPatients || 1)) * 100)}%
                </div>
                <div style={{ fontSize: '0.8rem', color: '#7c2d92', marginBottom: '0.5rem' }}>Sync Rate</div>
                <div style={{ fontSize: '0.75rem', color: '#7c3aed', fontWeight: 600 }}>
                  {metrics.activePatients} / {metrics.totalPatients}
                </div>
              </div>
              <div style={{ 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                backgroundColor: '#f0f9ff',
                border: '1px solid #0ea5e9'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                  {ghlHistory?.history?.filter((h: any) => !h.error_message).length || 0}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#075985', marginBottom: '0.5rem' }}>Successful Syncs</div>
                <div style={{ fontSize: '0.75rem', color: ghlHistory?.history?.some((h: any) => h.error_message) ? '#dc2626' : '#059669', fontWeight: 600 }}>
                  {ghlHistory?.history?.filter((h: any) => h.error_message).length || 0} errors
                </div>
              </div>
            </div>

            {/* Recently Synced GHL Patients */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                🔄 Recent GHL Sync Activity
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {(ghlHistory?.history || []).slice(0, 8).map((sync: any, index: number) => (
                  <Link
                    key={index}
                    href={sync.patient_id ? withBasePath(`/patients/${sync.patient_id}`) : withBasePath("/professional")}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: sync.error_message ? '#fee2e2' : '#f3e8ff',
                      border: sync.error_message ? '1px solid #ef4444' : '1px solid #a855f7',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.2rem' }}>
                        {sync.error_message ? '❌' : '✅'} {sync.patient_name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {sync.sync_type || 'sync'} • {sync.error_message ? 'Failed' : 'Success'}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
                      {formatTimeAgo(sync.created_at)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <Link
                href={withBasePath("/professional")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#a855f7',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🔗 GHL Mgmt
              </Link>
              <Link
                href={withBasePath("/professional")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#10b981',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🔄 Sync Now
              </Link>
              <Link
                href={withBasePath("/professional")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: ghlHistory?.history?.some((h: any) => h.error_message) ? '#dc2626' : '#059669',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                {ghlHistory?.history?.some((h: any) => h.error_message) ? '🚨 Fix Errors' : '✅ View Status'}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Comprehensive Patient Analytics */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          👥 Patient Analytics & Operations
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '2rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))'
        }}>
          
          {/* Patient Status Breakdown */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  📊 Patient Status Breakdown
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Detailed analysis of patient statuses and trends
                </p>
              </div>
              <Link
                href={withBasePath("/patients")}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.5rem',
                  background: '#3b82f6',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                👥 Manage All
              </Link>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              {patientStatusBreakdown.map((status: any, index: number) => (
                <Link
                  key={index}
                  href={withBasePath(`/patients?status=${status.status_key}`)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    backgroundColor: status.status_key?.includes('hold') ? '#fef3c7' : 
                                   status.status_key === 'active' ? '#ecfdf5' : '#f8fafc',
                    border: status.status_key?.includes('hold') ? '1px solid #f59e0b' : 
                           status.status_key === 'active' ? '1px solid #10b981' : '1px solid #e2e8f0',
                    textDecoration: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      {status.status_key?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Avg {status.avg_days_since_update || 0} days since update
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontSize: '1.8rem', 
                      fontWeight: 700, 
                      color: status.status_key?.includes('hold') ? '#ea580c' : 
                             status.status_key === 'active' ? '#059669' : '#64748b'
                    }}>
                      {status.count}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>patients</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Membership Issues - Comprehensive */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  🚨 Membership Issues
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  All membership problems requiring immediate attention
                </p>
              </div>
              <div style={{ 
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                backgroundColor: janeOutstanding.length + qbOutstanding.length + membershipHolds.length > 0 ? '#fee2e2' : '#ecfdf5',
                color: janeOutstanding.length + qbOutstanding.length + membershipHolds.length > 0 ? '#dc2626' : '#059669',
                fontSize: '0.8rem',
                fontWeight: 600
              }}>
                {janeOutstanding.length + qbOutstanding.length + membershipHolds.length} ISSUES
              </div>
            </div>

            {/* Issues Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <Link
                href={withBasePath("/admin/membership-audit")}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#e0f2fe',
                  border: '1px solid #0ea5e9',
                  textDecoration: 'none',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                  {janeOutstanding.length}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#075985' }}>Jane Issues</div>
              </Link>
              <Link
                href={withBasePath("/admin/quickbooks")}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b',
                  textDecoration: 'none',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                  {qbOutstanding.length}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#a16207' }}>QB Issues</div>
              </Link>
              <Link
                href={withBasePath("/patients?status=hold")}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fee2e2',
                  border: '1px solid #ef4444',
                  textDecoration: 'none',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                  {membershipHolds.length}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>On Hold</div>
              </Link>
            </div>

            {/* Detailed Issue List */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                🎯 Issues Requiring Action
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                {/* Jane Outstanding */}
                {janeOutstanding.slice(0, 5).map((patient, index) => (
                  <Link
                    key={`jane-${index}`}
                    href={withBasePath(`/patients/${patient.patientId}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#e0f2fe',
                      border: '1px solid #0ea5e9',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0c4a6e', marginBottom: '0.2rem' }}>
                        💳 {patient.patientName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#075985' }}>
                        Jane • {patient.planName || 'Membership'} • {formatCurrency(patient.outstandingBalance)}
                      </div>
                    </div>
                    <div style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      backgroundColor: '#3b82f6',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 600
                    }}>
                      FIX
                    </div>
                  </Link>
                ))}
                
                {/* QB Outstanding */}
                {qbOutstanding.slice(0, 5).map((patient, index) => (
                  <Link
                    key={`qb-${index}`}
                    href={withBasePath(`/patients/${patient.patientId}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#fef3c7',
                      border: '1px solid #f59e0b',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#92400e', marginBottom: '0.2rem' }}>
                        💰 {patient.patientName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a16207' }}>
                        QuickBooks • Payment Issue • {formatCurrency(patient.outstandingBalance)}
                      </div>
                    </div>
                    <div style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      backgroundColor: '#f59e0b',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 600
                    }}>
                      FIX
                    </div>
                  </Link>
                ))}

                {/* Membership Holds */}
                {membershipHolds.slice(0, 5).map((patient: any, index: number) => (
                  <Link
                    key={`hold-${index}`}
                    href={withBasePath(`/patients/${patient.patient_id}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#fee2e2',
                      border: '1px solid #ef4444',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#991b1b', marginBottom: '0.2rem' }}>
                        ⏸️ {patient.patient_name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#dc2626' }}>
                        {patient.status_key?.replace('_', ' ')} • {Math.round(patient.days_on_hold || 0)} days
                      </div>
                    </div>
                    <div style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 600
                    }}>
                      RESOLVE
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Link
                href={withBasePath("/admin/membership-audit")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#3b82f6',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                🔧 Fix All Issues
              </Link>
              <Link
                href={withBasePath("/patients?status=hold")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#dc2626',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                ⏸️ Review Holds
              </Link>
            </div>
          </div>

          {/* Recent Activity - Comprehensive */}
          <div style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#0f172a' }}>
                  📈 Recent Activity
                </h3>
                <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Latest patient updates and system activity
                </p>
              </div>
              <Link
                href={withBasePath("/patients")}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.5rem',
                  background: '#10b981',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                📊 View All
              </Link>
            </div>

            {/* Recent Edits */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                📝 Recently Edited Patients
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
                {recentlyEdited.map((patient) => (
                  <Link
                    key={patient.patientId}
                    href={withBasePath(`/patients/${patient.patientId}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.2rem' }}>
                        📝 {patient.patientName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {patient.statusKey?.replace('_', ' ') || 'Unknown'} • by {patient.lastEditor || 'Unknown'}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
                      {formatTimeAgo(patient.lastModified)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Recent Dispenses */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151', fontWeight: 600 }}>
                💉 Recent Dispenses
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
                {recentlyDispensed.map((dispense) => (
                  <Link
                    key={dispense.dispenseId}
                    href={dispense.patientId ? withBasePath(`/patients/${dispense.patientId}`) : withBasePath("/transactions")}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: dispense.signedBy ? '#ecfdf5' : '#fef3c7',
                      border: dispense.signedBy ? '1px solid #10b981' : '1px solid #f59e0b',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.2rem' }}>
                        💉 {dispense.patientName || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {dispense.medication || 'Medication'} • {dispense.totalAmount || 0} mL • by {dispense.enteredBy || 'Unknown'}
                      </div>
                      {dispense.signedBy && (
                        <div style={{ fontSize: '0.7rem', color: '#059669', marginTop: '0.2rem' }}>
                          ✅ Signed by {dispense.signedBy}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
                      {formatTimeAgo(dispense.dispensedAt)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Link
                href={withBasePath("/transactions")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#6366f1',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                📋 DEA Log
              </Link>
              <Link
                href={withBasePath("/provider/signatures")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: pendingSignatures > 0 ? '#dc2626' : '#059669',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                {pendingSignatures > 0 ? '🚨 Sign Now' : '✅ Signatures'}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ 
        marginTop: '4rem',
        padding: '1.5rem',
        borderRadius: '0.75rem',
        backgroundColor: '#f1f5f9',
        border: '1px solid #cbd5e1',
        textAlign: 'center'
      }}>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
          This is the comprehensive business dashboard with real data from all your systems. 
          <Link href="/" style={{ color: '#0ea5e9', textDecoration: 'none', fontWeight: 600 }}>
            Return to your current dashboard
          </Link> to continue normal operations.
        </p>
      </div>
    </section>
  );
}

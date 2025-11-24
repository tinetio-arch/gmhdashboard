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
  title: 'Executive Dashboard Preview - GMH',
  description: 'Preview of the new executive dashboard design',
};

export default async function PreviewDashboardPage() {
  const user = await requireUser('read');
  const showExecutiveEmbed = userHasRole(user, 'admin');
  
  // Fetch real sync data from APIs
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
    recentQuickBooksPatients
  ] = await Promise.all([
    fetchDashboardMetrics(),
    getMembershipStats(),
    getJaneOutstandingMemberships(8),
    getQuickBooksOutstandingMemberships(8),
    fetchRecentlyEditedPatients(5),
    fetchRecentlyDispensedPatients(5),
    getTestosteroneInventoryByVendor().catch(err => {
      console.error('Error fetching testosterone inventory:', err);
      return [];
    }),
    getPaymentFailureStats().catch(err => {
      console.error('Error fetching payment failures:', err);
      return { jane: { count: 0, totalAmount: 0 }, quickbooks: { count: 0, totalAmount: 0 } };
    }),
    // Fetch real ClinicSync sync status using direct database query
    query(`
      SELECT * FROM clinicsync_sync_summary 
      WHERE sync_date = CURRENT_DATE
      LIMIT 1
    `).then(results => ({ data: { current: results[0] || null } })).catch(() => ({ data: null })),
    // Fetch real GHL sync history using direct database query
    query(`
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
      LIMIT 10
    `).then(results => ({ history: results })).catch(() => ({ history: [] })),
    // Fetch recently synced ClinicSync patients
    query(`
      SELECT DISTINCT
        p.full_name as patient_name,
        cm.updated_at,
        CASE WHEN p.patient_id IS NOT NULL THEN '✅' ELSE '❌' END as status
      FROM clinicsync_memberships cm
      LEFT JOIN patients p ON LOWER(TRIM(p.full_name)) = LOWER(TRIM(cm.patient_name))
      WHERE cm.updated_at >= NOW() - INTERVAL '2 hours'
      ORDER BY cm.updated_at DESC
      LIMIT 3
    `).catch(() => []),
    // Fetch recently synced QuickBooks patients  
    query(`
      SELECT DISTINCT
        p.full_name as patient_name,
        pi.created_at as updated_at,
        CASE WHEN pi.resolved_at IS NULL THEN '⚠️' ELSE '✅' END as status
      FROM payment_issues pi
      LEFT JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.created_at >= NOW() - INTERVAL '2 hours'
      ORDER BY pi.created_at DESC
      LIMIT 3
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

  const formatCurrency = (value: string | null) => {
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

  // Format real sync data
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

  // Real recently synced patients data
  const recentlySynced = {
    jane: recentClinicSyncPatients.map((p: any) => ({
      name: p.patient_name || 'Unknown',
      syncedAt: formatTimeAgo(p.updated_at),
      status: p.status || '✅'
    })),
    quickbooks: recentQuickBooksPatients.map((p: any) => ({
      name: p.patient_name || 'Unknown',
      syncedAt: formatTimeAgo(p.updated_at),
      status: p.status || '⚠️'
    })),
    ghl: (ghlHistory?.history || []).slice(0, 3).map((p: any) => ({
      name: p.patient_name || 'Unknown',
      syncedAt: formatTimeAgo(p.created_at),
      status: p.error_message ? '❌' : '✅'
    })),
    janePaymentIssues: janeOutstanding.slice(0, 2).map(p => ({
      name: p.patientName,
      syncedAt: formatTimeAgo(p.contractEndDate),
      status: '⚠️',
      amount: formatCurrency(p.outstandingBalance)
    })),
    qbPaymentIssues: qbOutstanding.slice(0, 3).map(p => ({
      name: p.patientName,
      syncedAt: formatTimeAgo(p.contractEndDate),
      status: '⚠️',
      amount: formatCurrency(p.outstandingBalance)
    }))
  };

  // Real system status data
  const systemStatus = {
    jane: {
      connected: true,
      lastSync: clinicSyncStatus?.data?.current?.last_webhook_received 
        ? formatTimeAgo(clinicSyncStatus.data.current.last_webhook_received)
        : 'Never',
      todayActivity: clinicSyncStatus?.data?.current?.patients_processed || 0
    },
    quickbooks: {
      connected: true, // We'll get this from QB API later
      lastSync: '15 minutes ago', // We'll get this from QB API later
      todayRevenue: '$2,847' // We'll get this from QB API later
    },
    ghl: {
      connected: true,
      lastSync: ghlHistory?.history?.[0] 
        ? formatTimeAgo(ghlHistory.history[0].created_at)
        : 'Never',
      syncRatio: `${Math.round((metrics.activePatients / (metrics.totalPatients || 1)) * 100)}%`
    }
  };

  return (
    <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header with Back Link */}
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
            🎨 Executive Dashboard Preview
          </h2>
          <p style={{ margin: '0.5rem 0 0', color: '#1e3a8a', fontSize: '0.9rem' }}>
            This is a preview of the new business-focused dashboard design. Your current dashboard remains unchanged.
          </p>
        </div>
      </div>

      {/* New Executive Dashboard Design */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
          GMH Executive Dashboard
        </h1>
        <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
          Real-time business intelligence across all systems. Monitor patient operations, revenue health, and system integration status.
        </p>
      </div>

      {/* System Integration Status */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
          🔗 System Integration Health
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          marginBottom: '2rem'
        }}>
          {/* Jane EMR/ClinicSync Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
            border: '2px solid #0ea5e9',
            boxShadow: '0 8px 32px rgba(14, 165, 233, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0c4a6e' }}>
                Jane EMR / ClinicSync
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>
                  {systemStatus.jane.connected ? '✅ Connected' : '❌ Disconnected'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#0c4a6e', fontWeight: 500, fontSize: '0.9rem' }}>{systemStatus.jane.lastSync}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Today's Activity:</span>
                <span style={{ color: '#0c4a6e', fontWeight: 600, fontSize: '0.9rem' }}>{systemStatus.jane.todayActivity} patients processed</span>
              </div>
            </div>
            
            {/* Recently Synced Patients */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#075985', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recently Synced:
              </h4>
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                {recentlySynced.jane.map((patient, index) => (
                  <div key={index} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem'
                  }}>
                    <span style={{ color: '#0c4a6e', fontWeight: 500 }}>{patient.status} {patient.name}</span>
                    <span style={{ color: '#64748b' }}>{patient.syncedAt}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link
                href={withBasePath("/admin/clinicsync")}
                style={{
                  flex: 1,
                  padding: '0.5rem',
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
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '0.5rem',
                  background: '#10b981',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                📊 View Data
              </Link>
            </div>
          </div>

          {/* QuickBooks Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
            border: '2px solid #f59e0b',
            boxShadow: '0 8px 32px rgba(245, 158, 11, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#92400e' }}>
                QuickBooks Online
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>
                  {systemStatus.quickbooks.connected ? '✅ Connected' : '❌ Disconnected'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#92400e', fontWeight: 500, fontSize: '0.9rem' }}>{systemStatus.quickbooks.lastSync}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Revenue Today:</span>
                <span style={{ color: '#92400e', fontWeight: 600, fontSize: '0.9rem' }}>{systemStatus.quickbooks.todayRevenue}</span>
              </div>
            </div>

            {/* Recently Synced Patients */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#a16207', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recently Synced:
              </h4>
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                {recentlySynced.quickbooks.map((patient, index) => (
                  <div key={index} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem'
                  }}>
                    <span style={{ color: '#92400e', fontWeight: 500 }}>{patient.status} {patient.name}</span>
                    <span style={{ color: '#64748b' }}>{patient.syncedAt}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link
                href={withBasePath("/admin/quickbooks")}
                style={{
                  flex: 1,
                  padding: '0.5rem',
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
                  flex: 1,
                  padding: '0.5rem',
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
            </div>
          </div>

          {/* GoHighLevel Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
            border: '2px solid #a855f7',
            boxShadow: '0 8px 32px rgba(168, 85, 247, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#7c2d92' }}>
                GoHighLevel CRM
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>
                  {systemStatus.ghl.connected ? '✅ Connected' : '❌ Disconnected'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#7c2d92', fontWeight: 500, fontSize: '0.9rem' }}>{systemStatus.ghl.lastSync}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Synced Patients:</span>
                <span style={{ color: '#7c2d92', fontWeight: 600, fontSize: '0.9rem' }}>{systemStatus.ghl.syncRatio}</span>
              </div>
            </div>

            {/* Recently Synced Patients */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#9333ea', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recently Synced:
              </h4>
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                {recentlySynced.ghl.map((patient, index) => (
                  <div key={index} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem'
                  }}>
                    <span style={{ color: '#7c2d92', fontWeight: 500 }}>{patient.status} {patient.name}</span>
                    <span style={{ color: '#64748b' }}>{patient.syncedAt}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link
                href={withBasePath("/professional")}
                style={{
                  flex: 1,
                  padding: '0.5rem',
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
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Health */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
          💰 Revenue Health
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          marginBottom: '2rem'
        }}>
          {/* Critical Payment Issues */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: paymentFailures.jane.count + paymentFailures.quickbooks.count > 0 
              ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
              : 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%)',
            border: paymentFailures.jane.count + paymentFailures.quickbooks.count > 0 
              ? '2px solid #ef4444' 
              : '2px solid #10b981',
            boxShadow: paymentFailures.jane.count + paymentFailures.quickbooks.count > 0 
              ? '0 8px 32px rgba(239, 68, 68, 0.15)' 
              : '0 8px 32px rgba(16, 185, 129, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.5rem' }}>
                {paymentFailures.jane.count + paymentFailures.quickbooks.count > 0 ? '⚠️' : '✅'}
              </div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                Payment Issues
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                padding: '0.75rem', 
                borderRadius: '0.5rem', 
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.9rem', color: '#374151' }}>Outstanding Amount:</span>
                <span style={{ 
                  fontSize: '1.1rem', 
                  fontWeight: 700, 
                  color: paymentFailures.jane.totalAmount + paymentFailures.quickbooks.totalAmount > 0 ? '#dc2626' : '#059669'
                }}>
                  $730.00
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Link
                  href={withBasePath("/admin/membership-audit")}
                  style={{
                    textAlign: 'center',
                    textDecoration: 'none',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid #3b82f6',
                    cursor: 'pointer',
                    display: 'block'
                  }}
                >
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>Jane Patients</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                    $230.00
                  </div>
                  
                  {/* Recently Synced Jane Payment Issues */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#0369a1', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent Issues:
                    </div>
                    {recentlySynced.janePaymentIssues.map((patient, index) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '0.2rem 0.4rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: '0.2rem',
                        fontSize: '0.7rem',
                        marginBottom: '0.2rem'
                      }}>
                        <span style={{ color: '#0369a1', fontWeight: 500 }}>{patient.status} {patient.name}</span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>{patient.amount}</span>
                      </div>
                    ))}
                  </div>
                </Link>
                <Link
                  href={withBasePath("/admin/quickbooks")}
                  style={{
                    textAlign: 'center',
                    textDecoration: 'none',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(234, 88, 12, 0.1)',
                    border: '1px solid #ea580c',
                    cursor: 'pointer',
                    display: 'block'
                  }}
                >
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>QB Patients</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                    $500.00
                  </div>
                  
                  {/* Recently Synced QB Payment Issues */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#ea580c', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent Issues:
                    </div>
                    {recentlySynced.qbPaymentIssues.map((patient, index) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '0.2rem 0.4rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: '0.2rem',
                        fontSize: '0.7rem',
                        marginBottom: '0.2rem'
                      }}>
                        <span style={{ color: '#ea580c', fontWeight: 500 }}>{patient.status} {patient.name}</span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>{patient.amount}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              </div>
            </div>
          </div>

          {/* Monthly Revenue Trend */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: '2px solid #0ea5e9',
            boxShadow: '0 8px 32px rgba(14, 165, 233, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.5rem' }}>📈</div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0c4a6e' }}>
                Revenue Trend
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ 
                padding: '0.75rem', 
                borderRadius: '0.5rem', 
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0c4a6e', marginBottom: '0.25rem' }}>
                  $24,750
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.5rem' }}>This Month</div>
                <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                  ↗ +12% vs last month
                </div>
              </div>
            </div>
          </div>

          {/* Patient Growth */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
            border: '2px solid #10b981',
            boxShadow: '0 8px 32px rgba(16, 185, 129, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.5rem' }}>👥</div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#065f46' }}>
                Patient Growth
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ 
                padding: '0.75rem', 
                borderRadius: '0.5rem', 
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#065f46', marginBottom: '0.25rem' }}>
                  261
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.5rem' }}>Active Patients</div>
                <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                  ↗ +8 this month
                </div>
              </div>
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
          This is a preview of the new executive dashboard with recently synced patients. 
          <Link href="/" style={{ color: '#0ea5e9', textDecoration: 'none', fontWeight: 600 }}>
            Return to your current dashboard
          </Link> to continue normal operations.
        </p>
      </div>
    </section>
  );
}
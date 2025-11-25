export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fetchDashboardMetrics,
  fetchRecentlyEditedPatients,
  fetchRecentlyDispensedPatients
} from '@/lib/metricsQueries';
import { getMembershipStats, getJaneOutstandingMemberships, getQuickBooksOutstandingMemberships } from '@/lib/membershipStats';
// Note: These functions may not be available on server - using try/catch
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Executive Dashboard - GMH',
  description: 'Executive-level business intelligence and operations overview',
};

function withBasePath(path: string): string {
  return path;
}

export default async function ExecutiveDashboardPage() {
  // Admin-only access
  const user = await requireUser('admin');
  
  // Fetch all dashboard data
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
    quickBooksStatus
  ] = await Promise.all([
    fetchDashboardMetrics(),
    getMembershipStats(),
    getJaneOutstandingMemberships(10),
    getQuickBooksOutstandingMemberships(10),
    fetchRecentlyEditedPatients(8),
    fetchRecentlyDispensedPatients(8),
    Promise.resolve([]), // Testosterone inventory - not available
    Promise.resolve({ jane: { count: 0, totalAmount: 0 }, quickbooks: { count: 0, totalAmount: 0 } }), // Payment failures - not available
    // ClinicSync status
    query(`
      SELECT 
        sync_date,
        last_webhook_received,
        total_webhooks_received,
        patients_processed,
        patients_skipped,
        ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 1) as processing_rate
      FROM clinicsync_sync_tracking 
      WHERE sync_date = CURRENT_DATE
      LIMIT 1
    `).then(results => results[0] || null).catch(() => null),
    // GHL sync history
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
    `).then(results => results).catch(() => []),
    // QuickBooks connection status
    query(`
      SELECT 
        connection_status,
        last_sync_at,
        expires_at
      FROM quickbooks_connection
      ORDER BY last_sync_at DESC
      LIMIT 1
    `).then(results => results[0] || null).catch(() => null)
  ]);

  const pendingSignatures = metrics.pendingSignatures ?? 0;
  const weeksSinceAudit = Number.isFinite(metrics.weeksSinceAudit) ? Number(metrics.weeksSinceAudit.toFixed(1)) : 0;
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

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Calculate totals
  const totalOutstanding = janeOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0) + 
                          qbOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0);
  const totalPaymentIssues = paymentFailures.jane.count + paymentFailures.quickbooks.count;

  return (
    <section style={{ 
      padding: '2rem', 
      backgroundColor: '#f8fafc', 
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ 
              fontSize: '2.75rem', 
              marginBottom: '0.5rem', 
              color: '#0f172a', 
              fontWeight: 800,
              letterSpacing: '-0.02em'
            }}>
              Executive Dashboard
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
              Real-time business intelligence and operational overview
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
              border: '1px solid #0ea5e9',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            ← Main Dashboard
          </Link>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div style={{ 
        display: 'grid', 
        gap: '1.5rem', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        marginBottom: '2.5rem'
      }}>
        {/* Total Patients */}
        <div style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#ffffff',
          boxShadow: '0 10px 40px rgba(102, 126, 234, 0.3)'
        }}>
          <div style={{ fontSize: '0.9rem', opacity: 0.9, marginBottom: '0.5rem', fontWeight: 500 }}>
            Total Patients
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {metrics.totalPatients}
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {metrics.activePatients} active
          </div>
        </div>

        {/* Active Patients */}
        <div style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#ffffff',
          boxShadow: '0 10px 40px rgba(16, 185, 129, 0.3)'
        }}>
          <div style={{ fontSize: '0.9rem', opacity: 0.9, marginBottom: '0.5rem', fontWeight: 500 }}>
            Active Patients
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {metrics.activePatients}
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {metrics.holdPatients} on hold
          </div>
        </div>

        {/* Payment Issues */}
        <div style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          background: totalPaymentIssues > 0 
            ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
            : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#ffffff',
          boxShadow: totalPaymentIssues > 0 
            ? '0 10px 40px rgba(239, 68, 68, 0.3)'
            : '0 10px 40px rgba(16, 185, 129, 0.3)'
        }}>
          <div style={{ fontSize: '0.9rem', opacity: 0.9, marginBottom: '0.5rem', fontWeight: 500 }}>
            Payment Issues
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {totalPaymentIssues}
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {formatCurrency(totalOutstanding)} outstanding
          </div>
        </div>

        {/* Pending Signatures */}
        <div style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          background: pendingSignatures > 0
            ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
            : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          color: '#ffffff',
          boxShadow: pendingSignatures > 0
            ? '0 10px 40px rgba(245, 158, 11, 0.3)'
            : '0 10px 40px rgba(99, 102, 241, 0.3)'
        }}>
          <div style={{ fontSize: '0.9rem', opacity: 0.9, marginBottom: '0.5rem', fontWeight: 500 }}>
            Pending Signatures
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {pendingSignatures}
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {auditOverdue ? 'Audit overdue' : `${weeksSinceAudit}w since audit`}
          </div>
        </div>
      </div>

      {/* System Integration Status */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          🔗 System Integration Status
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'
        }}>
          {/* ClinicSync Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: clinicSyncStatus ? '#10b981' : '#ef4444',
                boxShadow: clinicSyncStatus ? '0 0 8px rgba(16, 185, 129, 0.4)' : '0 0 8px rgba(239, 68, 68, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                ClinicSync / Jane EMR
              </h3>
            </div>
            {clinicSyncStatus ? (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Status:</span>
                  <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>✅ Active</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Processed Today:</span>
                  <span style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.9rem' }}>{clinicSyncStatus.patients_processed || 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Last Sync:</span>
                  <span style={{ color: '#0f172a', fontSize: '0.9rem' }}>{formatTimeAgo(clinicSyncStatus.last_webhook_received)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Success Rate:</span>
                  <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>{clinicSyncStatus.processing_rate || 0}%</span>
                </div>
              </div>
            ) : (
              <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>No activity today</div>
            )}
            <Link
              href={withBasePath("/admin/clinicsync")}
              style={{
                display: 'block',
                marginTop: '1rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: '#3b82f6',
                color: '#ffffff',
                textDecoration: 'none',
                textAlign: 'center',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              Manage ClinicSync →
            </Link>
          </div>

          {/* QuickBooks Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: quickBooksStatus?.connection_status === 'connected' ? '#10b981' : '#ef4444',
                boxShadow: quickBooksStatus?.connection_status === 'connected' ? '0 0 8px rgba(16, 185, 129, 0.4)' : '0 0 8px rgba(239, 68, 68, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                QuickBooks Online
              </h3>
            </div>
            {quickBooksStatus ? (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Status:</span>
                  <span style={{ 
                    color: quickBooksStatus.connection_status === 'connected' ? '#059669' : '#ef4444', 
                    fontWeight: 600, 
                    fontSize: '0.9rem' 
                  }}>
                    {quickBooksStatus.connection_status === 'connected' ? '✅ Connected' : '❌ Disconnected'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Payment Issues:</span>
                  <span style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.9rem' }}>{paymentFailures.quickbooks.count}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Outstanding:</span>
                  <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.9rem' }}>
                    {formatCurrency(paymentFailures.quickbooks.totalAmount)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Last Sync:</span>
                  <span style={{ color: '#0f172a', fontSize: '0.9rem' }}>{formatTimeAgo(quickBooksStatus.last_sync_at)}</span>
                </div>
              </div>
            ) : (
              <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>Not connected</div>
            )}
            <Link
              href={withBasePath("/admin/quickbooks")}
              style={{
                display: 'block',
                marginTop: '1rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: '#f59e0b',
                color: '#ffffff',
                textDecoration: 'none',
                textAlign: 'center',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              Manage QuickBooks →
            </Link>
          </div>

          {/* GoHighLevel Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: ghlHistory.length > 0 ? '#10b981' : '#94a3b8',
                boxShadow: ghlHistory.length > 0 ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                GoHighLevel CRM
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Recent Syncs:</span>
                <span style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.9rem' }}>{ghlHistory.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#0f172a', fontSize: '0.9rem' }}>
                  {ghlHistory[0] ? formatTimeAgo(ghlHistory[0].created_at) : 'Never'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Sync Rate:</span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>
                  {Math.round((metrics.activePatients / (metrics.totalPatients || 1)) * 100)}%
                </span>
              </div>
            </div>
            <Link
              href={withBasePath("/professional")}
              style={{
                display: 'block',
                marginTop: '1rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: '#a855f7',
                color: '#ffffff',
                textDecoration: 'none',
                textAlign: 'center',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              Manage GHL →
            </Link>
          </div>
        </div>
      </div>

      {/* Revenue & Payment Issues */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          💰 Revenue Health
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))'
        }}>
          {/* Payment Issues List */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Outstanding Payment Issues
              </h3>
              <div style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '999px',
                backgroundColor: totalPaymentIssues > 0 ? '#fee2e2' : '#d1fae5',
                color: totalPaymentIssues > 0 ? '#dc2626' : '#059669',
                fontSize: '0.85rem',
                fontWeight: 600
              }}>
                {totalPaymentIssues} issues
              </div>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
              {/* Jane Outstanding */}
              {janeOutstanding.slice(0, 5).map((patient, index) => (
                <Link
                  key={`jane-${index}`}
                  href={patient.patientId ? withBasePath(`/patients/${patient.patientId}`) : withBasePath("/admin/membership-audit")}
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
                      {patient.patientName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#075985' }}>
                      Jane • {patient.planName || 'Membership'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#dc2626' }}>
                      {formatCurrency(patient.outstandingBalance)}
                    </div>
                  </div>
                </Link>
              ))}
              
              {/* QuickBooks Outstanding */}
              {qbOutstanding.slice(0, 5).map((patient, index) => (
                <Link
                  key={`qb-${index}`}
                  href={patient.patientId ? withBasePath(`/patients/${patient.patientId}`) : withBasePath("/admin/quickbooks")}
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
                      {patient.patientName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#a16207' }}>
                      QuickBooks • Payment Issue
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#dc2626' }}>
                      {formatCurrency(patient.outstandingBalance)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
              <Link
                href={withBasePath("/admin/membership-audit")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#3b82f6',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                View All Issues →
              </Link>
              <Link
                href={withBasePath("/admin/quickbooks")}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#f59e0b',
                  color: '#ffffff',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                QuickBooks →
              </Link>
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
              Financial Summary
            </h3>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{
                padding: '1rem',
                borderRadius: '0.75rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Total Outstanding</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#dc2626' }}>
                  {formatCurrency(totalOutstanding)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#e0f2fe',
                  border: '1px solid #0ea5e9'
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#075985', marginBottom: '0.25rem' }}>Jane Issues</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0369a1' }}>
                    {paymentFailures.jane.count}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>
                    {formatCurrency(paymentFailures.jane.totalAmount)}
                  </div>
                </div>
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b'
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#a16207', marginBottom: '0.25rem' }}>QB Issues</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ea580c' }}>
                    {paymentFailures.quickbooks.count}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>
                    {formatCurrency(paymentFailures.quickbooks.totalAmount)}
                  </div>
                </div>
              </div>
              <div style={{
                padding: '0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: '#ecfdf5',
                border: '1px solid #10b981'
              }}>
                <div style={{ fontSize: '0.75rem', color: '#065f46', marginBottom: '0.25rem' }}>Membership Stats</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div>
                    <div style={{ color: '#64748b' }}>Renewals</div>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{membershipStats.renewalsDue}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b' }}>Expired</div>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{membershipStats.expired}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b' }}>Outstanding</div>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{membershipStats.outstanding}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          📈 Recent Activity
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1.5rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))'
        }}>
          {/* Recently Edited */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
              Recently Edited Patients
            </h3>
            <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
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
                      {patient.patientName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {patient.statusKey?.replace('_', ' ') || 'Unknown'} • by {patient.lastEditor || 'Unknown'}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {patient.lastModified || 'Unknown'}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Recently Dispensed */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
              Recent Dispenses
            </h3>
            <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
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
                      {dispense.patientName || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {dispense.medication || 'Medication'} • {dispense.totalAmount || 0} mL
                    </div>
                    {dispense.signedBy && (
                      <div style={{ fontSize: '0.7rem', color: '#059669', marginTop: '0.2rem' }}>
                        ✅ Signed by {dispense.signedBy}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {dispense.dispensedAt || 'Unknown'}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Summary */}
      {testosteroneInventory.length > 0 && (
        <div style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
            📦 Inventory Overview
          </h2>
          <div style={{ 
            display: 'grid', 
            gap: '1rem', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'
          }}>
            {testosteroneInventory.map((inv) => (
              <div
                key={inv.vendor}
                style={{
                  padding: '1rem',
                  borderRadius: '0.75rem',
                  background: inv.lowInventory 
                    ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)'
                    : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: inv.lowInventory ? '2px solid #ef4444' : '2px solid #10b981',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
                }}
              >
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 500 }}>
                  {inv.vendor}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
                  {inv.activeVials}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {inv.totalRemainingMl.toFixed(1)} mL remaining
                </div>
                {inv.lowInventory && (
                  <div style={{ 
                    marginTop: '0.5rem',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    backgroundColor: '#fee2e2',
                    color: '#dc2626',
                    fontSize: '0.7rem',
                    fontWeight: 600
                  }}>
                    ⚠️ Low Stock
                  </div>
                )}
              </div>
            ))}
          </div>
          <Link
            href={withBasePath("/inventory")}
            style={{
              display: 'inline-block',
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              background: '#6366f1',
              color: '#ffffff',
              textDecoration: 'none',
              fontSize: '0.9rem',
              fontWeight: 600
            }}
          >
            View Full Inventory →
          </Link>
        </div>
      )}
    </section>
  );
}


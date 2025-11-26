export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fetchDashboardMetrics,
  fetchRecentlyEditedPatients,
  fetchRecentlyDispensedPatients,
  type RecentlyDispensedPatient
} from '@/lib/metricsQueries';
import { getJaneOutstandingMemberships, getQuickBooksOutstandingMemberships, getCombinedOutstandingMemberships, type CombinedOutstandingMembership } from '@/lib/membershipStats';
import { getTestosteroneInventoryByVendor, getPaymentFailureStats } from '@/lib/testosteroneInventory';
import { fetchInventorySummary } from '@/lib/inventoryQueries';
import { getPatientAnalyticsBreakdown } from '@/lib/patientAnalytics';
import { requireUser, userHasRole } from '@/lib/auth';

function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  alternates: {
    canonical: '/ops'
  },
  robots: {
    index: false,
    follow: false
  }
};

// Reusable Clickable Metric Card Component
function ClickableMetricCard({
  href,
  label,
  value,
  subLabel,
  icon,
  gradient,
  borderColor,
  shadowColor
}: {
  href?: string;
  label: string;
  value: string | number;
  subLabel?: string;
  icon?: string;
  gradient: string;
  borderColor: string;
  shadowColor: string;
}) {
  const cardStyle = {
    padding: '1.75rem',
    borderRadius: '1rem',
    background: gradient,
    border: `2px solid ${borderColor}`,
    boxShadow: `0 10px 40px ${shadowColor}`,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    position: 'relative' as const,
    overflow: 'hidden' as const,
    textDecoration: 'none' as const,
    display: 'block' as const,
    color: 'inherit' as const
  };

  const content = (
    <>
      {icon && (
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{icon}</div>
      )}
      <div style={{ fontSize: '0.9rem', opacity: 0.95, marginBottom: '0.5rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#ffffff', textAlign: 'center' }}>
        {label}
      </div>
      <div style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '0.25rem', lineHeight: 1, color: '#ffffff', textAlign: 'center' }}>
        {value}
      </div>
      {subLabel && (
        <div style={{ fontSize: '0.85rem', opacity: 0.95, marginTop: '0.5rem', color: '#ffffff', textAlign: 'center' }}>
          {subLabel}
        </div>
      )}
      <div style={{
        position: 'absolute' as const,
        bottom: '1rem',
        right: '1rem',
        fontSize: '1.5rem',
        opacity: 0.3,
        color: '#ffffff'
      }}>
        →
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={withBasePath(href)} style={cardStyle}>
        {content}
      </Link>
    );
  }

  return (
    <div style={cardStyle}>
      {content}
    </div>
  );
}

export default async function HomePage() {
  const user = await requireUser('read');
  const showExecutiveEmbed = userHasRole(user, 'admin');
  
  const [
    metrics,
    janeOutstanding,
    qbOutstanding,
    combinedOutstanding,
    recentlyEdited,
    recentlyDispensed,
    testosteroneInventory,
    paymentFailures,
    inventorySummary,
    analytics
  ] = await Promise.all([
    fetchDashboardMetrics(),
    getJaneOutstandingMemberships(8),
    getQuickBooksOutstandingMemberships(8),
    getCombinedOutstandingMemberships(50),
    fetchRecentlyEditedPatients(5),
    fetchRecentlyDispensedPatients(5),
    getTestosteroneInventoryByVendor().catch(() => []),
    getPaymentFailureStats().catch(() => ({ jane: { count: 0, totalAmount: 0 }, quickbooks: { count: 0, totalAmount: 0 } })),
    fetchInventorySummary().catch(() => ({ active_vials: 0, expired_vials: 0, total_remaining_ml: 0 })),
    getPatientAnalyticsBreakdown().catch(() => ({
      totalPatients: 0,
      activePatients: 0,
      primaryCare: 0,
      mensHealth: 0,
      other: 0,
      byClientType: [],
      byPaymentMethod: [],
      byClientTypeAndPayment: [],
      byMembershipPlan: []
    }))
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

  // Calculate total outstanding from combined outstanding memberships
  const totalOutstanding = combinedOutstanding.reduce((sum, r) => sum + parseFloat(r.totalBalance || '0'), 0);
  const totalPaymentFailures = paymentFailures.jane.count + paymentFailures.quickbooks.count;

  return (
    <section style={{ 
        padding: '1.5rem 2rem',
        backgroundColor: '#f8fafc',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '1600px',
        margin: '0 auto'
      }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ 
          fontSize: '2.5rem', 
          marginBottom: '0.5rem', 
          color: '#0f172a', 
          fontWeight: 800,
          letterSpacing: '-0.02em'
        }}>
          GMH Executive Dashboard
        </h1>
        <p style={{ color: '#64748b', fontSize: '1rem', maxWidth: '48rem' }}>
          Real-time business intelligence across all systems. Click any metric to drill down into details.
        </p>
      </div>

      {/* Executive Summary KPIs - Top Priority */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          📊 Executive Summary
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))'
        }}>
          <ClickableMetricCard
            href="/patients?status=active"
            label="Active Patients"
            value={metrics.activePatients}
            subLabel={`${metrics.totalPatients} total (${metrics.holdPatients} on hold)`}
            icon="👥"
            gradient="linear-gradient(135deg, #10b981 0%, #059669 100%)"
            borderColor="#10b981"
            shadowColor="rgba(16, 185, 129, 0.3)"
          />
          
          <ClickableMetricCard
            href="/admin/membership-audit?filter=outstanding"
            label="Outstanding Balances"
            value={formatCurrency(totalOutstanding)}
            subLabel={`${combinedOutstanding.length} patients with balances`}
            icon="💰"
            gradient={totalOutstanding > 0 
              ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
              : "linear-gradient(135deg, #10b981 0%, #059669 100%)"}
            borderColor={totalOutstanding > 0 ? "#ef4444" : "#10b981"}
            shadowColor={totalOutstanding > 0 
              ? "rgba(239, 68, 68, 0.3)"
              : "rgba(16, 185, 129, 0.3)"}
          />

          <ClickableMetricCard
            href="/provider/signatures"
            label="Pending Signatures"
            value={pendingSignatures}
            subLabel={pendingSignatures > 0 ? "Action required" : "All signed"}
            icon="✍️"
            gradient={pendingSignatures > 0
              ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
              : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"}
            borderColor={pendingSignatures > 0 ? "#f59e0b" : "#6366f1"}
            shadowColor={pendingSignatures > 0
              ? "rgba(245, 158, 11, 0.3)"
              : "rgba(99, 102, 241, 0.3)"}
          />
        </div>
      </div>

      {/* Inventory & Supply Chain - Moved to Top */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          📦 Inventory & Supply Chain
        </h2>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {testosteroneInventory && Array.isArray(testosteroneInventory) && testosteroneInventory.map((inventory) => {
            const isCarrieBoyd = inventory.vendor.includes('Carrie Boyd');
            const vendorShort = isCarrieBoyd ? 'Carrie Boyd (30ML)' : 'TopRX (10ML)';
            const dispensingCount = inventory.vialDetails?.filter(v => v.isDispensing).length || 0;
            
            return (
              <Link
                key={inventory.vendor}
                href={withBasePath("/inventory")}
                style={{
                  padding: '1.75rem',
                  borderRadius: '1rem',
                  background: inventory.lowInventory 
                    ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)'
                    : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: inventory.lowInventory ? '2px solid #ef4444' : '2px solid #10b981',
                  boxShadow: inventory.lowInventory
                    ? '0 10px 40px rgba(239, 68, 68, 0.2)'
                    : '0 10px 40px rgba(16, 185, 129, 0.2)',
                  textDecoration: 'none',
                  color: 'inherit',
                  position: 'relative',
                  transition: 'all 0.3s ease',
                  display: 'block'
                }}
              >
                {inventory.lowInventory && (
                  <div style={{
                    position: 'absolute',
                    top: '-10px',
                    right: '12px',
                    background: '#ef4444',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                  }}>
                    ⚠️ ORDER ALERT
                  </div>
                )}
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, textAlign: 'center' }}>
                  {vendorShort}
                </div>
                <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: inventory.lowInventory ? '#dc2626' : '#0f172a', lineHeight: 1 }}>
                    {inventory.activeVials}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500, marginTop: '0.25rem' }}>
                    active vials
                  </div>
                </div>
                <div style={{ 
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  marginBottom: '0.5rem',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: inventory.lowInventory ? '#dc2626' : '#059669', marginBottom: '0.25rem' }}>
                    {inventory.totalRemainingMl.toFixed(1)} mL
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Remaining</div>
                </div>
                {dispensingCount > 0 && (
                  <div style={{ 
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    textAlign: 'center',
                    marginBottom: '0.5rem'
                  }}>
                    <div style={{ fontSize: '0.85rem', color: '#1e40af', fontWeight: 600 }}>
                      {dispensingCount} vial{dispensingCount !== 1 ? 's' : ''} actively dispensing
                    </div>
                  </div>
                )}
                {inventory.vialDetails && inventory.vialDetails.length > 0 && (
                  <div style={{ 
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>
                      Top Vials
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {inventory.vialDetails.slice(0, 5).map((vial, idx) => (
                        <div key={idx} style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          fontSize: '0.75rem',
                          padding: '0.25rem 0'
                        }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{vial.externalId}</span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {vial.isDispensing && (
                              <span style={{ 
                                fontSize: '0.65rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                fontWeight: 600
                              }}>ACTIVE</span>
                            )}
                            <span style={{ color: '#64748b', fontWeight: 500 }}>{vial.remainingMl.toFixed(1)}mL</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {inventory.lowInventory && (
                  <div style={{ 
                    marginTop: '0.75rem',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#dc2626',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textAlign: 'center'
                  }}>
                    Low inventory - order immediately
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Patient Breakdown by Service Type & Payment Method */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          👥 Patient Breakdown by Service Type & Payment Method
        </h2>
        <Link
          href={withBasePath("/admin/membership-audit")}
          style={{
            padding: '2rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: '2px solid #0ea5e9',
            boxShadow: '0 10px 40px rgba(14, 165, 233, 0.2)',
            textDecoration: 'none',
            color: 'inherit',
            display: 'block',
            transition: 'all 0.3s ease'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Primary Care
              </div>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#0369a1', marginBottom: '0.5rem' }}>
                {analytics.primaryCare}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {analytics.totalPatients > 0 ? ((analytics.primaryCare / analytics.totalPatients) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Men's Health
              </div>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#92400e', marginBottom: '0.5rem' }}>
                {analytics.mensHealth}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {analytics.totalPatients > 0 ? ((analytics.mensHealth / analytics.totalPatients) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Other Services
              </div>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#7c2d92', marginBottom: '0.5rem' }}>
                {analytics.other}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {analytics.totalPatients > 0 ? ((analytics.other / analytics.totalPatients) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
          </div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1.5rem'
          }}>
            {analytics.byClientTypeAndPayment.slice(0, 12).map((row, idx) => (
              <div
                key={`${row.clientTypeKey}-${row.paymentMethodKey}-${idx}`}
                style={{
                  padding: '1rem',
                  borderRadius: '0.75rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  border: '1px solid rgba(14, 165, 233, 0.2)'
                }}
              >
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 500 }}>
                  {row.clientTypeName}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                  {row.paymentMethodName}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1' }}>
                  {row.count}
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: '1rem', color: '#0369a1', fontWeight: 600, fontSize: '0.9rem' }}>
            Click to view full breakdown →
          </div>
        </Link>
      </div>

      {/* Outstanding Balances - Simplified */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          💰 Outstanding Balances
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1rem', 
          gridTemplateColumns: '1fr 1fr'
        }}>
          {/* Jane Patients */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #1e40af',
            boxShadow: '0 10px 40px rgba(30, 64, 175, 0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e40af' }}>
                Jane Patients
              </h3>
              <Link 
                href={withBasePath("/admin/membership-audit?filter=outstanding&source=jane")}
                style={{ 
                  fontSize: '0.8rem', 
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontWeight: 600
                }}
              >
                View All →
              </Link>
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#1e40af', marginBottom: '0.5rem' }}>
              {formatCurrency(combinedOutstanding.reduce((sum, r) => sum + parseFloat(r.janeBalance || '0'), 0).toString())}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              {combinedOutstanding.filter(r => parseFloat(r.janeBalance || '0') > 0).length} patients with balances
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {combinedOutstanding.filter(r => parseFloat(r.janeBalance || '0') > 0).slice(0, 8).map((row) => (
                <div key={row.patientId || row.patientName} style={{ 
                  padding: '0.75rem',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    {row.patientId ? (
                      <Link 
                        href={withBasePath(`/patients/${row.patientId}`)} 
                        style={{ color: '#0f172a', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}
                      >
                        {row.patientName}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{row.patientName}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>
                    {formatCurrency(row.janeBalance || '0')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* QuickBooks Patients */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #ea580c',
            boxShadow: '0 10px 40px rgba(234, 88, 12, 0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#ea580c' }}>
                QuickBooks Patients
              </h3>
              <Link 
                href={withBasePath("/admin/membership-audit?filter=outstanding&source=quickbooks")}
                style={{ 
                  fontSize: '0.8rem', 
                  color: '#f97316',
                  textDecoration: 'none',
                  fontWeight: 600
                }}
              >
                View All →
              </Link>
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.5rem' }}>
              {formatCurrency(combinedOutstanding.reduce((sum, r) => sum + parseFloat(r.quickbooksBalance || '0'), 0).toString())}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              {combinedOutstanding.filter(r => parseFloat(r.quickbooksBalance || '0') > 0).length} patients with balances
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {combinedOutstanding.filter(r => parseFloat(r.quickbooksBalance || '0') > 0).slice(0, 8).map((row) => (
                <div key={row.patientId || row.patientName} style={{ 
                  padding: '0.75rem',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    {row.patientId ? (
                      <Link 
                        href={withBasePath(`/patients/${row.patientId}`)} 
                        style={{ color: '#0f172a', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}
                      >
                        {row.patientName}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{row.patientName}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>
                    {formatCurrency(row.quickbooksBalance || '0')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Operational Metrics */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          🏥 Operational Metrics
        </h2>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          <ClickableMetricCard
            href="/patients"
            label="Total Patients"
            value={metrics.totalPatients}
            subLabel={`${metrics.activePatients} active, ${metrics.holdPatients} on hold`}
            icon="👥"
            gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
            borderColor="#667eea"
            shadowColor="rgba(102, 126, 234, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?status=active"
            label="Active Patients"
            value={metrics.activePatients}
            subLabel="Currently receiving care"
            icon="✅"
            gradient="linear-gradient(135deg, #10b981 0%, #059669 100%)"
            borderColor="#10b981"
            shadowColor="rgba(16, 185, 129, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?status=hold_payment_research"
            label="Hold - Payment Research"
            value={metrics.holdPaymentResearch}
            subLabel="Requires card follow-up"
            icon="🔍"
            gradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
            borderColor="#f59e0b"
            shadowColor="rgba(245, 158, 11, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?status=hold_contract_renewal"
            label="Hold - Contract Renewal"
            value={metrics.holdContractRenewal}
            subLabel="Less than 2 cycles remaining"
            icon="📋"
            gradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
            borderColor="#f59e0b"
            shadowColor="rgba(245, 158, 11, 0.3)"
          />

          <ClickableMetricCard
            href="/patients"
            label="Labs Due ≤30 Days"
            value={metrics.upcomingLabs}
            subLabel="Requires scheduling"
            icon="🧪"
            gradient="linear-gradient(135deg, #ea580c 0%, #c2410c 100%)"
            borderColor="#ea580c"
            shadowColor="rgba(234, 88, 12, 0.3)"
          />

          <ClickableMetricCard
            href="/dea"
            label="Controlled Dispenses (30d)"
            value={metrics.controlledDispensesLast30}
            subLabel="DEA compliance tracking"
            icon="💊"
            gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
            borderColor="#3b82f6"
            shadowColor="rgba(59, 130, 246, 0.3)"
          />

          <ClickableMetricCard
            href="/provider/signatures"
            label="Pending Signatures"
            value={pendingSignatures}
            subLabel={pendingSignatures > 0 ? "Action required" : "All signed"}
            icon="✍️"
            gradient={pendingSignatures > 0
              ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
              : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"}
            borderColor={pendingSignatures > 0 ? "#f59e0b" : "#6366f1"}
            shadowColor={pendingSignatures > 0
              ? "rgba(245, 158, 11, 0.3)"
              : "rgba(99, 102, 241, 0.3)"}
          />

          <ClickableMetricCard
            href="/audit"
            label="Weeks Since Audit"
            value={weeksSinceAudit}
            subLabel={auditOverdue ? "⚠️ Overdue" : "✅ Current"}
            icon="📊"
            gradient={auditOverdue
              ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
              : "linear-gradient(135deg, #10b981 0%, #059669 100%)"}
            borderColor={auditOverdue ? "#ef4444" : "#10b981"}
            shadowColor={auditOverdue
              ? "rgba(239, 68, 68, 0.3)"
              : "rgba(16, 185, 129, 0.3)"}
          />
        </div>
      </div>

          {testosteroneInventory && Array.isArray(testosteroneInventory) && testosteroneInventory.map((inventory) => {
            const isCarrieBoyd = inventory.vendor.includes('Carrie Boyd');
            const vendorShort = isCarrieBoyd ? 'Carrie Boyd (30ML)' : 'TopRX (10ML)';
            const dispensingCount = inventory.vialDetails?.filter(v => v.isDispensing).length || 0;
            
            return (
              <Link
                key={inventory.vendor}
                href={withBasePath("/inventory")}
                style={{
                  padding: '1.75rem',
                  borderRadius: '1rem',
                  background: inventory.lowInventory 
                    ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)'
                    : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: inventory.lowInventory ? '2px solid #ef4444' : '2px solid #10b981',
                  boxShadow: inventory.lowInventory
                    ? '0 10px 40px rgba(239, 68, 68, 0.2)'
                    : '0 10px 40px rgba(16, 185, 129, 0.2)',
                  textDecoration: 'none',
                  color: 'inherit',
                  position: 'relative',
                  transition: 'all 0.3s ease',
                  display: 'block'
                }}
              >
                {inventory.lowInventory && (
                  <div style={{
                    position: 'absolute',
                    top: '-10px',
                    right: '12px',
                    background: '#ef4444',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                  }}>
                    ⚠️ ORDER ALERT
                  </div>
                )}
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, textAlign: 'center' }}>
                  {vendorShort}
                </div>
                <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: inventory.lowInventory ? '#dc2626' : '#0f172a', lineHeight: 1 }}>
                    {inventory.activeVials}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500, marginTop: '0.25rem' }}>
                    active vials
                  </div>
                </div>
                <div style={{ 
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  marginBottom: '0.5rem',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: inventory.lowInventory ? '#dc2626' : '#059669', marginBottom: '0.25rem' }}>
                    {inventory.totalRemainingMl.toFixed(1)} mL
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Remaining</div>
                </div>
                {dispensingCount > 0 && (
                  <div style={{ 
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    textAlign: 'center',
                    marginBottom: '0.5rem'
                  }}>
                    <div style={{ fontSize: '0.85rem', color: '#1e40af', fontWeight: 600 }}>
                      {dispensingCount} vial{dispensingCount !== 1 ? 's' : ''} actively dispensing
                    </div>
                  </div>
                )}
                {inventory.vialDetails && inventory.vialDetails.length > 0 && (
                  <div style={{ 
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>
                      Top Vials
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {inventory.vialDetails.slice(0, 5).map((vial, idx) => (
                        <div key={idx} style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          fontSize: '0.75rem',
                          padding: '0.25rem 0'
                        }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{vial.externalId}</span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {vial.isDispensing && (
                              <span style={{ 
                                fontSize: '0.65rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                fontWeight: 600
                              }}>ACTIVE</span>
                            )}
                            <span style={{ color: '#64748b', fontWeight: 500 }}>{vial.remainingMl.toFixed(1)}mL</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {inventory.lowInventory && (
                  <div style={{ 
                    marginTop: '0.75rem',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#dc2626',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textAlign: 'center'
                  }}>
                    Low inventory - order immediately
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* System Integration Health */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          🔗 System Integration Health
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))'
        }}>
          <Link
            href={withBasePath("/admin/clinicsync")}
            style={{
              padding: '1.75rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
              border: '2px solid #0ea5e9',
              boxShadow: '0 10px 40px rgba(14, 165, 233, 0.2)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'all 0.3s ease',
              display: 'block'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#0c4a6e' }}>
                Jane EMR / ClinicSync
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#0c4a6e', fontWeight: 500, fontSize: '0.9rem' }}>Active</span>
              </div>
            </div>
          </Link>

          <Link
            href={withBasePath("/admin/quickbooks")}
            style={{
              padding: '1.75rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
              border: '2px solid #f59e0b',
              boxShadow: '0 10px 40px rgba(245, 158, 11, 0.2)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'all 0.3s ease',
              display: 'block'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#92400e' }}>
                QuickBooks Online
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Payment Issues:</span>
                <span style={{ color: paymentFailures.quickbooks.count > 0 ? '#dc2626' : '#059669', fontWeight: 600, fontSize: '0.9rem' }}>
                  {paymentFailures.quickbooks.count}
                </span>
              </div>
            </div>
          </Link>

          <Link
            href={withBasePath("/professional")}
            style={{
              padding: '1.75rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
              border: '2px solid #a855f7',
              boxShadow: '0 10px 40px rgba(168, 85, 247, 0.2)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'all 0.3s ease',
              display: 'block'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#7c2d92' }}>
                GoHighLevel CRM
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Synced Patients:</span>
                <span style={{ color: '#7c2d92', fontWeight: 600, fontSize: '0.9rem' }}>Active</span>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          📈 Recent Activity
        </h2>
        <div style={{ 
          display: 'grid', 
          gap: '1rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))'
        }}>
          <div style={{
            padding: '1.75rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Recently Edited Patients
              </h3>
              <Link 
                href={withBasePath("/patients")} 
                style={{ fontSize: '0.85rem', color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}
              >
                View All →
              </Link>
            </div>
            {recentlyEdited.length === 0 ? (
              <p style={{ color: '#94a3b8', margin: 0, textAlign: 'center', padding: '2rem' }}>
                No recent edits recorded today.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
                {recentlyEdited.map((patient) => (
                  <Link
                    key={patient.patientId}
                    href={withBasePath(`/patients/${patient.patientId}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      borderRadius: '0.75rem',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                        {patient.patientName}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {patient.statusKey?.replace(/_/g, ' ') || 'Unknown'} · by {patient.lastEditor || 'Unknown'}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      {patient.lastModified || 'just now'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div style={{
            padding: '1.75rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Recent Dispenses
              </h3>
              <Link 
                href={withBasePath("/transactions")} 
                style={{ fontSize: '0.85rem', color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}
              >
                View All →
              </Link>
            </div>
            {recentlyDispensed.length === 0 ? (
              <p style={{ color: '#94a3b8', margin: 0, textAlign: 'center', padding: '2rem' }}>
                No dispenses recorded today.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
                {recentlyDispensed.map((dispense) => (
                  <Link
                    key={dispense.dispenseId}
                    href={dispense.patientId ? withBasePath(`/patients/${dispense.patientId}`) : withBasePath("/transactions")}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      padding: '1rem',
                      borderRadius: '0.75rem',
                      backgroundColor: dispense.signedBy ? '#ecfdf5' : '#fef3c7',
                      border: dispense.signedBy ? '1px solid #10b981' : '1px solid #f59e0b',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                        {dispense.patientName ?? 'Unknown patient'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {dispense.medication ?? 'Medication TBD'} · {dispense.totalAmount || 0} mL
                      </div>
                      {dispense.signedBy && (
                        <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '0.25rem', fontWeight: 600 }}>
                          ✅ Signed by {dispense.signedBy}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', textAlign: 'right' }}>
                      {dispense.dispensedAt ?? 'Pending'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Executive Embed */}
      {showExecutiveEmbed && (
        <details
          style={{
            marginBottom: '2.5rem',
            borderRadius: '1rem',
            border: '2px solid #e2e8f0',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)',
            background: '#ffffff',
            overflow: 'hidden'
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              padding: '1.5rem',
              fontWeight: 600,
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '1.1rem',
              color: '#0f172a'
            }}
          >
            <span>Executive Metrics (Admins Only)</span>
            <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 400 }}>Click to expand</span>
          </summary>
          <div style={{ width: '100%', height: '680px' }}>
            <iframe
              src="https://lookerstudio.google.com/embed/reporting/bc7759ba-4825-49a0-b51d-2e3687b02526/page/E8kIF"
              width="100%"
              height="100%"
              title="GMH Executive Dashboard"
              frameBorder="0"
              allowFullScreen
              sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        </details>
      )}

      <div style={{ marginTop: '3rem' }} />
    </section>
  );
}

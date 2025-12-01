export const dynamic = 'force-dynamic';

import React from 'react';
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
import { getTotalJaneRevenue, getJaneRevenueMonthly } from '@/lib/janeRevenueQueries';
import { getMembershipMonthlyRevenue, type MembershipRevenueSummary } from '@/lib/membershipRevenue';
import { getAllIntegrationStatuses, type IntegrationStatus } from '@/lib/integrationStatus';
import QuickBooksCard from './components/QuickBooksCard';
import {
  getQuickBooksDashboardMetrics,
  getQuickBooksPaymentIssues,
  getQuickBooksUnmatchedPatients,
} from '@/lib/quickbooksDashboard';
import ClinicSyncAdminActions from './components/ClinicSyncAdminActions';
import PaymentCheckerButton from './components/PaymentCheckerButton';

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
  const isOwner = user.email === 'admin@nowoptimal.com'; // Only owner can see MRR details
  
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
    analytics,
    janeRevenue,
    janeRevenueMonthly,
    membershipRevenue,
    integrationStatuses,
    quickBooksDashboardMetrics,
    quickBooksPaymentIssues,
    quickBooksUnmatchedPatients,
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
    })),
    getTotalJaneRevenue().catch(() => ({
      totalRevenue: 0,
      totalPayments: 0,
      totalPurchased: 0,
      outstandingBalance: 0,
      totalPatients: 0,
      averageRevenuePerPatient: 0,
      revenueByMonth: []
    })),
    (async () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6); // Last 6 months
      return getJaneRevenueMonthly(startDate, endDate).catch(() => []);
    })(),
    getMembershipMonthlyRevenue().catch((): MembershipRevenueSummary => ({
      totalMonthlyRevenue: 0,
      totalAnnualRevenue: 0,
      primaryCareMemberships: {
        monthlyRevenue: 0,
        annualRevenue: 0,
        memberCount: 0,
        memberships: []
      },
      mensHealthMemberships: {
        monthlyRevenue: 0,
        annualRevenue: 0,
        memberCount: 0,
        memberships: []
      }
    })),
    getAllIntegrationStatuses().catch((error) => {
      console.error('Error fetching integration statuses:', error);
      // Return placeholder statuses so user can see there was an error
      return [
        {
          name: 'QuickBooks',
          connected: false,
          status: 'critical' as const,
          lastChecked: null,
          error: error.message || 'Failed to check status',
          healthScore: null,
          canRefresh: false,
        },
        {
          name: 'Jane (ClinicSync)',
          connected: false,
          status: 'critical' as const,
          lastChecked: null,
          error: 'Status check failed',
          healthScore: null,
          canRefresh: false,
        },
        {
          name: 'GoHighLevel',
          connected: false,
          status: 'critical' as const,
          lastChecked: null,
          error: 'Status check failed',
          healthScore: null,
          canRefresh: false,
        }
      ];
    }),
    getQuickBooksDashboardMetrics().catch((error) => {
      console.error('Error fetching QuickBooks dashboard metrics:', error);
      return null;
    }),
    getQuickBooksPaymentIssues(20).catch((error) => {
      console.error('Error fetching QuickBooks payment issues:', error);
      return [];
    }),
    getQuickBooksUnmatchedPatients(20).catch((error) => {
      console.error('Error fetching QuickBooks unmatched patients:', error);
      return [];
    }),
  ]);

  const quickBooksIntegration = integrationStatuses.find((integration) => integration.name === 'QuickBooks');
  const quickBooksLastChecked = quickBooksIntegration?.lastChecked ?? null;
  const quickBooksConnection = {
    connected: quickBooksIntegration?.connected ?? false,
    status: quickBooksIntegration?.status ?? null,
    error: quickBooksIntegration?.error ?? null,
    lastChecked: quickBooksLastChecked
      ? typeof quickBooksLastChecked === 'string'
        ? quickBooksLastChecked
        : quickBooksLastChecked.toISOString()
      : null,
  };

  const pendingSignatures = metrics?.pendingSignatures ?? 0;
  const weeksSinceAudit = Number.isFinite(metrics?.weeksSinceAudit)
    ? Number((metrics?.weeksSinceAudit ?? 0).toFixed(1))
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
  const combinedOutstandingSafe = Array.isArray(combinedOutstanding) ? combinedOutstanding : [];
  const totalOutstanding = combinedOutstandingSafe.reduce(
    (sum, r) => sum + parseFloat(r.totalBalance || '0'),
    0
  );

  const paymentFailuresSafe =
    paymentFailures && typeof paymentFailures === 'object'
      ? paymentFailures
      : { jane: { count: 0, totalAmount: 0 }, quickbooks: { count: 0, totalAmount: 0 } };

  const totalPaymentFailures =
    (paymentFailuresSafe?.jane?.count ?? 0) + (paymentFailuresSafe?.quickbooks?.count ?? 0);

  return (
    <>
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

      {/* Integration Status - Critical Alerts First - Admin Only */}
      {isOwner && integrationStatuses && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
            🔌 Integration Status
          </h2>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {integrationStatuses.map((integration) => {
              const statusColors = {
                healthy: { bg: '#10b981', border: '#059669', text: '#ffffff' },
                warning: { bg: '#f59e0b', border: '#d97706', text: '#ffffff' },
                critical: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },
                unknown: { bg: '#6b7280', border: '#4b5563', text: '#ffffff' },
              };
              const colors = statusColors[integration.status] || statusColors.unknown;
              const statusIcon = {
                healthy: '✅',
                warning: '⚠️',
                critical: '🚨',
                unknown: '❓',
              }[integration.status] || '❓';

              return (
                <div
                  key={integration.name}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '1rem',
                    background: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.border} 100%)`,
                    border: `2px solid ${colors.border}`,
                    boxShadow: `0 10px 40px rgba(${colors.bg === '#ef4444' ? '239, 68, 68' : colors.bg === '#f59e0b' ? '245, 158, 11' : '16, 185, 129'}, 0.3)`,
                    color: colors.text,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                      {statusIcon} {integration.name}
                    </div>
                    <div style={{ 
                      fontSize: '0.85rem', 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '0.5rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.2)',
                      fontWeight: 600,
                      textTransform: 'uppercase'
                    }}>
                      {integration.status}
                    </div>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                    {integration.connected ? 'Connected' : 'Disconnected'}
                  </div>
                  {integration.error && (
                    <div style={{ fontSize: '0.85rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                      ⚠️ {integration.error}
                    </div>
                  )}
                  {integration.healthScore !== null && (
                    <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                      Health: {integration.healthScore}%
                    </div>
                  )}
                  {integration.name === 'Jane (ClinicSync)' && (
                    <div
                      style={{
                        marginTop: '1rem',
                        backgroundColor: 'rgba(255,255,255,0.92)',
                        borderRadius: '0.75rem',
                        padding: '1rem',
                        boxShadow: '0 6px 20px rgba(15, 23, 42, 0.15)',
                        color: '#0f172a',
                      }}
                    >
                      <ClinicSyncAdminActions />
                    </div>
                  )}
                  {integration.lastChecked && (
                    <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.5rem' }}>
                      Last checked: {new Date(integration.lastChecked).toLocaleString('en-US', {
                        timeZone: 'America/Phoenix',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                      })}
                    </div>
                  )}
                  {!integration.connected && integration.name === 'QuickBooks' && (
                    <a
                      href="/ops/admin/quickbooks"
                      style={{
                        display: 'inline-block',
                        marginTop: '0.75rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '0.5rem',
                        color: colors.text,
                        textDecoration: 'none',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                      }}
                    >
                      Fix Connection →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Checker - Manual Button */}
      <div style={{ marginBottom: '2rem' }}>
        <PaymentCheckerButton />
      </div>

      {isOwner && (
        <QuickBooksCard
          metrics={quickBooksDashboardMetrics}
          paymentIssues={quickBooksPaymentIssues}
          unmatchedPatients={quickBooksUnmatchedPatients}
          paymentStats={paymentFailures.quickbooks}
          connection={quickBooksConnection}
        />
      )}

      {/* Operational Metrics - Moved to Top */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          🏥 Operational Metrics
        </h2>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
            icon="💳"
            gradient="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
            borderColor="#ef4444"
            shadowColor="rgba(239, 68, 68, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?status=hold_patient_research"
            label="Hold - Patient Research"
            value={metrics.holdPatientResearch}
            subLabel="Care team outreach needed"
            icon="🧠"
            gradient="linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)"
            borderColor="#f43f5e"
            shadowColor="rgba(244, 63, 94, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?status=hold_contract_renewal"
            label="Hold - Contract Renewal"
            value={metrics.holdContractRenewal}
            subLabel="Less than 2 cycles remaining"
            icon="📋"
            gradient="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
            borderColor="#ef4444"
            shadowColor="rgba(239, 68, 68, 0.3)"
          />

          <ClickableMetricCard
            href="/patients?labs_due=30"
            label="Labs Due ≤30 Days"
            value={metrics.upcomingLabs}
            subLabel="Requires scheduling"
            icon="🧪"
            gradient="linear-gradient(135deg, #facc15 0%, #f59e0b 100%)"
            borderColor="#facc15"
            shadowColor="rgba(250, 204, 21, 0.3)"
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

      {/* Executive Summary KPIs - Owner Only */}
      {isOwner && (
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
              href="#membership-revenue"
              label="Primary Care MRR"
              value={formatCurrency(membershipRevenue.primaryCareMemberships.monthlyRevenue)}
              subLabel={`${membershipRevenue.primaryCareMemberships.memberCount} members • ${formatCurrency(membershipRevenue.primaryCareMemberships.annualRevenue)} annual`}
              icon="🏥"
              gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
              borderColor="#3b82f6"
              shadowColor="rgba(59, 130, 246, 0.3)"
            />
            <ClickableMetricCard
              href="#membership-revenue"
              label="Men's Health MRR"
              value={formatCurrency(membershipRevenue.mensHealthMemberships.monthlyRevenue)}
              subLabel={`${membershipRevenue.mensHealthMemberships.memberCount} members • ${formatCurrency(membershipRevenue.mensHealthMemberships.annualRevenue)} annual`}
              icon="💪"
              gradient="linear-gradient(135deg, #f97316 0%, #ea580c 100%)"
              borderColor="#f97316"
              shadowColor="rgba(249, 115, 22, 0.3)"
            />
          </div>
        </div>
      )}

      {/* Membership Revenue Breakdown - Primary Care | Men's Health - Owner Only */}
      {isOwner && membershipRevenue.totalMonthlyRevenue > 0 && (
        <div id="membership-revenue" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
            📅 Monthly Membership Revenue (MRR)
          </h2>
          
          {/* Total Summary */}
          <div style={{
            marginBottom: '1rem',
            padding: '1rem',
            backgroundColor: 'white',
            border: '2px solid #8b5cf6',
            borderRadius: '0.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 4px rgba(139, 92, 246, 0.15)'
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Monthly Recurring Revenue</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#8b5cf6' }}>
                {formatCurrency(membershipRevenue.totalMonthlyRevenue)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Projected Annual</div>
              <div style={{ fontSize: '1.25rem', color: '#059669', fontWeight: 600 }}>
                {formatCurrency(membershipRevenue.totalAnnualRevenue)}
              </div>
            </div>
          </div>

          {/* Two Column Layout: Primary Care | Men's Health */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem'
          }}>
            {/* LEFT COLUMN: Primary Care Memberships */}
            <div style={{
              backgroundColor: 'white',
              border: '2px solid #3b82f6',
              borderRadius: '0.75rem',
              padding: '1rem',
              boxShadow: '0 2px 4px rgba(59, 130, 246, 0.15)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Primary Care Header & Summary */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
                paddingBottom: '0.75rem',
                borderBottom: '2px solid #3b82f6'
              }}>
                <div style={{
                  fontSize: '0.875rem',
                  color: '#3b82f6',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  🏥 Primary Care
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#2563eb', lineHeight: '1.2' }}>
                    {formatCurrency(membershipRevenue.primaryCareMemberships.monthlyRevenue)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.125rem' }}>
                    {membershipRevenue.primaryCareMemberships.memberCount} members
                  </div>
                </div>
              </div>

              {/* Primary Care Membership Cards - Color-coded by Jane (green) vs QuickBooks (orange) */}
              {membershipRevenue.primaryCareMemberships.memberships.length > 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  flex: 1
                }}>
                  {membershipRevenue.primaryCareMemberships.memberships.map((membership, idx) => (
                    <div
                      key={`pc-${idx}`}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: membership.isJane ? '#f0fdf4' : '#fffbeb',
                        border: `2px solid ${membership.isJane ? '#10b981' : '#f59e0b'}`,
                        borderRadius: '0.5rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: membership.isJane ? '#059669' : '#d97706', 
                          marginBottom: '0.125rem', 
                          fontWeight: 600 
                        }}>
                          {membership.membershipType}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                          {membership.patientCount} members × {formatCurrency(membership.monthlyPrice)}/mo
                          <span style={{ 
                            marginLeft: '0.5rem', 
                            color: membership.isJane ? '#10b981' : '#f59e0b',
                            fontWeight: 600
                          }}>
                            {membership.isJane ? '💚 Jane' : '📊 QBO'}
                          </span>
                        </div>
                      </div>
                      <div style={{ 
                        fontSize: '1rem', 
                        fontWeight: 'bold', 
                        color: membership.isJane ? '#059669' : '#d97706', 
                        marginLeft: '0.5rem' 
                      }}>
                        {formatCurrency(membership.monthlyRevenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                  No Primary Care memberships
                </div>
              )}

              {/* Primary Care Annual Total */}
              <div style={{
                marginTop: '0.75rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #bfdbfe',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.125rem' }}>Annual Revenue</div>
                <div style={{ fontSize: '0.875rem', color: '#2563eb', fontWeight: 600 }}>
                  {formatCurrency(membershipRevenue.primaryCareMemberships.annualRevenue)}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Men's Health Memberships */}
            <div style={{
              backgroundColor: 'white',
              border: '2px solid #f97316',
              borderRadius: '0.75rem',
              padding: '1rem',
              boxShadow: '0 2px 4px rgba(249, 115, 22, 0.15)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Men's Health Header & Summary */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
                paddingBottom: '0.75rem',
                borderBottom: '2px solid #f97316'
              }}>
                <div style={{
                  fontSize: '0.875rem',
                  color: '#f97316',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  💪 Men's Health
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#ea580c', lineHeight: '1.2' }}>
                    {formatCurrency(membershipRevenue.mensHealthMemberships.monthlyRevenue)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.125rem' }}>
                    {membershipRevenue.mensHealthMemberships.memberCount} members
                  </div>
                </div>
              </div>

              {/* Men's Health Membership Cards - Color-coded by Jane (green) vs QuickBooks (orange) */}
              {membershipRevenue.mensHealthMemberships.memberships.length > 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  flex: 1
                }}>
                  {membershipRevenue.mensHealthMemberships.memberships.map((membership, idx) => (
                    <div
                      key={`mh-${idx}`}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: membership.isJane ? '#f0fdf4' : '#fffbeb',
                        border: `2px solid ${membership.isJane ? '#10b981' : '#f59e0b'}`,
                        borderRadius: '0.5rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: membership.isJane ? '#059669' : '#d97706', 
                          marginBottom: '0.125rem', 
                          fontWeight: 600 
                        }}>
                          {membership.membershipType}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                          {membership.patientCount} members × {formatCurrency(membership.monthlyPrice)}/mo
                          <span style={{ 
                            marginLeft: '0.5rem', 
                            color: membership.isJane ? '#10b981' : '#f59e0b',
                            fontWeight: 600
                          }}>
                            {membership.isJane ? '💚 Jane' : '📊 QBO'}
                          </span>
                        </div>
                      </div>
                      <div style={{ 
                        fontSize: '1rem', 
                        fontWeight: 'bold', 
                        color: membership.isJane ? '#059669' : '#d97706', 
                        marginLeft: '0.5rem' 
                      }}>
                        {formatCurrency(membership.monthlyRevenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                  No Men's Health memberships
                </div>
              )}

              {/* Men's Health Annual Total */}
              <div style={{
                marginTop: '0.75rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #fed7aa',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.125rem' }}>Annual Revenue</div>
                <div style={{ fontSize: '0.875rem', color: '#ea580c', fontWeight: 600 }}>
                  {formatCurrency(membershipRevenue.mensHealthMemberships.annualRevenue)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


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

      {/* Patient Breakdown by Service Type - Side by Side */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 700 }}>
          👥 Patient Breakdown by Service Type
        </h2>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr',
          gap: '1.5rem'
        }}>
          {/* Primary Care Patient Breakdown */}
          <Link
            href={withBasePath("/admin/membership-audit")}
            style={{
              padding: '2rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              border: '2px solid #3b82f6',
              boxShadow: '0 10px 40px rgba(59, 130, 246, 0.2)',
              textDecoration: 'none',
              color: 'inherit',
              display: 'block',
              transition: 'all 0.3s ease'
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
                🏥 Primary Care
              </div>
              <div style={{ fontSize: '3.5rem', fontWeight: 800, color: '#1e40af', marginBottom: '0.5rem' }}>
                {analytics.primaryCare}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {analytics.totalPatients > 0 ? ((analytics.primaryCare / analytics.totalPatients) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginTop: '1.5rem'
            }}>
              {(() => {
                const primaryCareRows = analytics.byClientTypeAndPayment.filter(row => {
                  const isInsuranceSupplemental = row.clientTypeName?.includes('Ins. Supp.') || row.clientTypeName?.includes('Insurance Supplemental');
                  return row.isPrimaryCare || isInsuranceSupplemental;
                });
                return primaryCareRows.map((row, idx) => (
                  <div
                    key={`primary-${row.clientTypeKey}-${row.paymentMethodKey}-${idx}`}
                    style={{
                      padding: '0.875rem',
                      borderRadius: '0.75rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      boxShadow: '0 2px 8px rgba(59, 130, 246, 0.1)'
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 500 }}>
                      {row.clientTypeName}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                      {row.paymentMethodName}
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e40af' }}>
                      {row.count}
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div style={{ textAlign: 'center', marginTop: '1rem', color: '#1e40af', fontWeight: 600, fontSize: '0.85rem' }}>
              View full breakdown →
            </div>
          </Link>

          {/* Men's Health Patient Breakdown */}
          <Link
            href={withBasePath("/admin/membership-audit")}
            style={{
              padding: '2rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
              border: '2px solid #ea580c',
              boxShadow: '0 10px 40px rgba(234, 88, 12, 0.2)',
              textDecoration: 'none',
              color: 'inherit',
              display: 'block',
              transition: 'all 0.3s ease'
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
                💪 Men's Health
              </div>
              <div style={{ fontSize: '3.5rem', fontWeight: 800, color: '#c2410c', marginBottom: '0.5rem' }}>
                {analytics.mensHealth}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {analytics.totalPatients > 0 ? ((analytics.mensHealth / analytics.totalPatients) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginTop: '1.5rem'
            }}>
              {(() => {
                const mensHealthTypes = [
                  'QBO TCMH $180/Month',
                  'QBO F&F/FR/Veteran $140/Month',
                  'Jane TCMH $180/Month',
                  'Jane F&F/FR/Veteran $140/Month',
                  'Approved Disc / Pro-Bono PT',
                  "Men's Health (QBO)"
                ];
                const mensHealthRows = analytics.byClientTypeAndPayment.filter(row => 
                  mensHealthTypes.includes(row.clientTypeName || '')
                );
                
                // Group by membership type (consolidate payment methods)
                const groupedByMembership: Map<string, Array<{ method: string; count: number }>> = new Map();
                
                mensHealthRows.forEach(row => {
                  const membershipType = row.clientTypeName || 'Unknown';
                  if (!groupedByMembership.has(membershipType)) {
                    groupedByMembership.set(membershipType, []);
                  }
                  const existing = groupedByMembership.get(membershipType)!;
                  existing.push({ method: row.paymentMethodName || 'Unknown', count: row.count });
                });
                
                // Convert to array and sort by total count
                const groupedRows = Array.from(groupedByMembership.entries())
                  .map(([membershipType, paymentMethods]) => {
                    const totalCount = paymentMethods.reduce((sum, pm) => sum + pm.count, 0);
                    return {
                      clientTypeName: membershipType,
                      totalCount,
                      paymentBreakdown: paymentMethods
                    };
                  })
                  .sort((a, b) => b.totalCount - a.totalCount);
                
                return groupedRows.map((row, idx) => (
                  <div
                    key={`menshealth-${idx}`}
                    style={{
                      padding: '0.875rem',
                      borderRadius: '0.75rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      border: '1px solid rgba(234, 88, 12, 0.3)',
                      boxShadow: '0 2px 8px rgba(234, 88, 12, 0.1)'
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 500 }}>
                      {row.clientTypeName}
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#c2410c', marginBottom: '0.4rem' }}>
                      {row.totalCount}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                      {row.paymentBreakdown.map((pb, pIdx) => (
                        <div key={pIdx} style={{ marginBottom: '0.2rem' }}>
                          {pb.method}: {pb.count}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div style={{ textAlign: 'center', marginTop: '1rem', color: '#c2410c', fontWeight: 600, fontSize: '0.85rem' }}>
              View full breakdown →
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
    </>
  );
}

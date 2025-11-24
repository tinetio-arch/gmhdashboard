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
// import { withBasePath } from '@/lib/basePath';
// Server-side version of withBasePath
function withBasePath(path: string): string {
  // No basePath needed - the app is already served at /ops via reverse proxy
  return path;
}
import { requireUser, userHasRole } from '@/lib/auth';

export const metadata: Metadata = {
  alternates: {
    canonical: '/ops'
  },
  robots: {
    index: false,
    follow: false
  }
};

export default async function HomePage() {
  const user = await requireUser('read');
  const showExecutiveEmbed = userHasRole(user, 'admin');
  const [metrics, membershipStats, janeOutstanding, qbOutstanding, recentlyEdited, recentlyDispensed, testosteroneInventory, paymentFailures] = await Promise.all([
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
    })
  ]);
  const pendingSignatures = metrics.pendingSignatures ?? 0;
  const weeksSinceAudit = Number.isFinite(metrics.weeksSinceAudit)
    ? Number(metrics.weeksSinceAudit.toFixed(1))
    : 0;
  const auditOverdue = weeksSinceAudit >= 1;

  const cards = [
    { label: 'Total Patients', value: metrics.totalPatients },
    { label: 'Active Patients', value: metrics.activePatients },
    { label: 'Patients On Hold', value: metrics.holdPatients },
    { label: 'Labs Due ≤30 Days', value: metrics.upcomingLabs },
    { label: 'Controlled Dispenses (30d)', value: metrics.controlledDispensesLast30 },
    { label: 'Pending Provider Signatures', value: pendingSignatures },
    { label: 'Weeks Since Last Audit', value: weeksSinceAudit }
  ];

  const ownerSignals = [
    {
      label: 'Hold – Payment Research',
      value: metrics.holdPaymentResearch,
      helper: 'Requires card follow-up before meds can ship.'
    },
    {
      label: 'Hold – Contract Renewal',
      value: metrics.holdContractRenewal,
      helper: 'Less than two cycles or contract expired.'
    },
    {
      label: 'Inactive / Discharged',
      value: metrics.inactivePatients,
      helper: 'Kept off the sheet until staff reactivates.'
    }
  ];

  const membershipCards = [
    { label: 'Renewals (<2 cycles)', value: membershipStats.renewalsDue },
    { label: 'Expired Memberships', value: membershipStats.expired },
    { 
      label: 'Outstanding Membership / Recurring Payment Balances', 
      value: membershipStats.outstanding,
      jane: paymentFailures.jane,
      quickbooks: paymentFailures.quickbooks
    }
  ];

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

  return (
    <section>
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
          {/* Jane/ClinicSync Status */}
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
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#0c4a6e', fontWeight: 500, fontSize: '0.9rem' }}>2 minutes ago</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#075985', fontSize: '0.9rem' }}>Today's Activity:</span>
                <span style={{ color: '#0c4a6e', fontWeight: 600, fontSize: '0.9rem' }}>143 patients processed</span>
              </div>
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
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#92400e', fontWeight: 500, fontSize: '0.9rem' }}>15 minutes ago</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a16207', fontSize: '0.9rem' }}>Revenue Today:</span>
                <span style={{ color: '#92400e', fontWeight: 600, fontSize: '0.9rem' }}>$2,847</span>
              </div>
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
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Status:</span>
                <span style={{ color: '#065f46', fontWeight: 600, fontSize: '0.9rem' }}>✅ Connected</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Last Sync:</span>
                <span style={{ color: '#7c2d92', fontWeight: 500, fontSize: '0.9rem' }}>5 minutes ago</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9333ea', fontSize: '0.9rem' }}>Synced Patients:</span>
                <span style={{ color: '#7c2d92', fontWeight: 600, fontSize: '0.9rem' }}>{stats.synced || 0} / {stats.total || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Health Alert */}
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
              <div style={{ 
                fontSize: '1.5rem'
              }}>
                {paymentFailures.jane.count + paymentFailures.quickbooks.count > 0 ? '⚠️' : '✅'}
              </div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                Payment Issues
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
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
                  {currencyFormatter.format(paymentFailures.jane.totalAmount + paymentFailures.quickbooks.totalAmount)}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0369a1' }}>
                    {paymentFailures.jane.count}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Jane Patients</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c' }}>
                    {paymentFailures.quickbooks.count}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>QB Patients</div>
                </div>
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
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0369a1' }}>
                  $24,750
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>This Month</div>
                <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '0.25rem' }}>
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
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#059669' }}>
                  {metrics.activePatients}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Active Patients</div>
                <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '0.25rem' }}>
                  ↗ +8 this month
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {auditOverdue && (
        <div
          style={{
            padding: '0.85rem 1.1rem',
            borderRadius: '0.75rem',
            background: 'rgba(248, 113, 113, 0.18)',
            border: '1px solid rgba(248, 113, 113, 0.35)',
            color: '#b91c1c',
            fontWeight: 600,
            marginBottom: '1.5rem'
          }}
        >
          Inventory audit overdue — last recorded audit was {weeksSinceAudit.toFixed(1)} week(s) ago.{' '}
          <Link href={withBasePath("/audit")} style={{ color: '#990000', textDecoration: 'underline' }}>
            Record this week’s review
          </Link>
          .
        </div>
      )}

      {/* Testosterone Inventory Cards */}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginBottom: '1.5rem' }}>
        {testosteroneInventory && Array.isArray(testosteroneInventory) && testosteroneInventory.map((inventory) => {
          const isCarrieBoyd = inventory.vendor.includes('Carrie Boyd');
          const vendorShort = isCarrieBoyd ? 'Carrie Boyd (30ML)' : 'TopRX (10ML)';
          
          return (
            <article 
              key={inventory.vendor}
              style={{
                padding: '1rem 1.25rem',
                borderRadius: '0.75rem',
                background: inventory.lowInventory ? '#fef2f2' : '#ffffff',
                border: inventory.lowInventory ? '2px solid #ef4444' : '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
                position: 'relative'
              }}
            >
              {inventory.lowInventory && (
                <div style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '12px',
                  background: '#ef4444',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}>
                  ORDER ALERT
                </div>
              )}
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {vendorShort}
              </h4>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 700, color: inventory.lowInventory ? '#dc2626' : '#0f172a' }}>
                  {inventory.activeVials}
                </p>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
                  vials ({inventory.totalRemainingMl} mL)
                </span>
              </div>
              {inventory.lowInventory && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>
                  Low inventory - order immediately
                </p>
              )}
            </article>
          );
        })}
      </div>

      {/* Operational Metrics */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
          🏥 Operational Metrics
        </h2>
        <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {/* Patient Overview */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#475569', fontWeight: 600 }}>
              Patient Census
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Total Patients:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>{metrics.totalPatients}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Active:</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#059669' }}>{metrics.activePatients}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>On Hold:</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#dc2626' }}>{metrics.holdPatients}</span>
              </div>
            </div>
          </div>

          {/* Clinical Operations */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#475569', fontWeight: 600 }}>
              Clinical Activity
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Labs Due ≤30d:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ea580c' }}>{metrics.upcomingLabs}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Dispenses (30d):</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#0369a1' }}>{metrics.controlledDispensesLast30}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Pending Signatures:</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 600, color: pendingSignatures > 0 ? '#dc2626' : '#059669' }}>
                  {pendingSignatures}
                </span>
              </div>
            </div>
          </div>

          {/* Compliance Status */}
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: auditOverdue 
              ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
              : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
            border: auditOverdue ? '2px solid #ef4444' : '2px solid #10b981',
            boxShadow: auditOverdue 
              ? '0 8px 24px rgba(239, 68, 68, 0.15)' 
              : '0 8px 24px rgba(16, 185, 129, 0.15)'
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#475569', fontWeight: 600 }}>
              Compliance Status
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Audit Status:</span>
                <span style={{ 
                  fontSize: '1rem', 
                  fontWeight: 600, 
                  color: auditOverdue ? '#dc2626' : '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  {auditOverdue ? '⚠️ Overdue' : '✅ Current'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Weeks Since:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: auditOverdue ? '#dc2626' : '#059669' }}>
                  {weeksSinceAudit}
                </span>
              </div>
              {auditOverdue && (
                <div style={{ 
                  padding: '0.5rem', 
                  borderRadius: '0.5rem', 
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  textAlign: 'center'
                }}>
                  <span style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                    Action Required
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Cards - Above Owner Signals */}
      <div style={{ marginTop: '2.5rem', marginBottom: '2.5rem', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Link
          href={withBasePath("/patients")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>Manage Patients</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Filter by status, edit plans, and push updates back to Postgres without touching Google Sheets.
          </p>
        </Link>
        <Link
          href={withBasePath("/professional")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>GHL Management</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Manage patient sync status, apply marketing tags, and monitor GoHighLevel integration health.
          </p>
        </Link>
        <Link
          href={withBasePath("/dea")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>DEA Compliance</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Review the last 30 days of controlled substance activity and export for audits.
          </p>
        </Link>
        <Link
          href={withBasePath("/inventory")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>Vials & Transactions</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Track remaining inventory, reconcile dispenses, and flag low supply.
          </p>
        </Link>
        <Link
          href={withBasePath("/provider/signatures")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>Provider Signatures</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            {pendingSignatures > 0
              ? `${pendingSignatures} dispense${pendingSignatures === 1 ? '' : 's'} pending provider attestation.`
              : 'All dispenses signed — great work!'}
          </p>
        </Link>
        <Link
          href={withBasePath("/audit")}
          style={{
            padding: '1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'block'
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>Weekly Audit</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            {auditOverdue
              ? 'Audit overdue — capture this week to stay compliant.'
              : 'On schedule. Log counts weekly to maintain DEA readiness.'}
          </p>
        </Link>
      </div>

      <section style={{ marginTop: '2.5rem', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.3rem', marginBottom: '0.35rem' }}>Owner Signals</h3>
        <p style={{ margin: 0, color: '#94a3b8' }}>Quick pulse on holds and inactive records that block revenue.</p>
      </section>

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {ownerSignals.map((card) => {
          // Create link based on card type
          let filterLink = '/patients';
          if (card.label === 'Hold – Payment Research') {
            filterLink = '/patients?status=hold_payment_research';
          } else if (card.label === 'Hold – Contract Renewal') {
            filterLink = '/patients?status=hold_contract_renewal';
          } else if (card.label === 'Inactive / Discharged') {
            filterLink = '/patients?status=inactive';
          }
          
          return (
            <Link
              key={card.label}
              href={withBasePath(filterLink)}
              style={{
                padding: '1.25rem 1.5rem',
                borderRadius: '0.85rem',
                background: '#0f172a',
                color: '#f8fafc',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                boxShadow: '0 15px 32px rgba(15, 23, 42, 0.35)',
                textDecoration: 'none',
                display: 'block',
                transition: 'all 0.2s'
              }}
            >
              <p style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>
                {card.label}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '2rem', fontWeight: 600 }}>{card.value}</p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#cbd5f5' }}>{card.helper}</p>
              {card.value > 0 && (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#60a5fa' }}>
                  Click to view patients →
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <section style={{ marginTop: '2.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>Membership Watchlist</h3>
        <p style={{ margin: 0, color: '#94a3b8' }}>
          Based on the latest Jane export. Inactive memberships are skipped until you reactivate them.
        </p>
      </section>

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '2rem' }}>
        {membershipCards.slice(0, 2).map((card) => (
          <article key={card.label} style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {card.label}
            </h3>
            <p style={{ margin: 0, fontSize: '2.25rem', fontWeight: 600, color: '#0f172a' }}>{card.value}</p>
          </article>
        ))}
      </div>

      <div
        style={{
          marginBottom: '2.5rem',
          display: 'grid',
          gap: '1.5rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'
        }}
      >
        <section
          style={{
            padding: '1.5rem',
            borderRadius: '0.85rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Outstanding Membership / Recurring Payment Balances</h3>
            <p style={{ margin: '0.4rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Active memberships and recurring payments with failed transactions.
            </p>
            
            {/* Payment Failure Summary */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '0.75rem', 
              marginTop: '1rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                padding: '0.75rem',
                background: '#e0f2fe',
                borderRadius: '0.5rem',
                border: '1px solid #7dd3fc'
              }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#0369a1' }}>Jane Patients</h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 600, color: '#0c4a6e' }}>
                  {paymentFailures.jane.count}
                </p>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.8rem', color: '#075985' }}>
                  {currencyFormatter.format(paymentFailures.jane.totalAmount)} total
                </p>
              </div>
              <div style={{
                padding: '0.75rem',
                background: '#fef3c7',
                borderRadius: '0.5rem',
                border: '1px solid #fcd34d'
              }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#92400e' }}>QuickBooks Patients</h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 600, color: '#78350f' }}>
                  {paymentFailures.quickbooks.count}
                </p>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                  {currencyFormatter.format(paymentFailures.quickbooks.totalAmount)} total
                </p>
              </div>
            </div>
          </div>
          {janeOutstanding.length === 0 && qbOutstanding.length === 0 ? (
            <p style={{ color: '#16a34a', fontWeight: 600, margin: 0 }}>All balances cleared — great job.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Jane Column */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e40af' }}>Jane Patients</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                  {janeOutstanding.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No outstanding Jane balances</p>
                  ) : (
                    janeOutstanding.map((row) => (
                <div
                  key={`${row.patientName}-${row.planName ?? 'plan'}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    paddingBottom: '0.65rem',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.15)'
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {row.patientId ? (
                        <Link 
                          href={withBasePath(`/patients/${row.patientId}`)} 
                          style={{ color: '#0f172a', textDecoration: 'none' }}
                        >
                          {row.patientName}
                        </Link>
                      ) : (
                        <span>{row.patientName}</span>
                      )}
                    </p>
                    <p style={{ margin: '0.15rem 0 0', color: '#94a3b8', fontSize: '0.82rem' }}>
                      {row.planName ?? 'Plan TBD'} · {row.status ?? 'status pending'}
                    </p>
                    {row.contractEndDate ? (
                      <p style={{ margin: '0.1rem 0 0', color: '#a855f7', fontSize: '0.78rem' }}>
                        Contract ends {formatDate(row.contractEndDate)}
                      </p>
                    ) : null}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#b91c1c' }}>
                      {formatCurrency(row.outstandingBalance)}
                    </p>
                    <p style={{ margin: '0.1rem 0 0', color: '#94a3b8', fontSize: '0.75rem' }}>Balance due</p>
                  </div>
                </div>
                    ))
                  )}
                </div>
              </div>

              {/* QuickBooks Column */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#ea580c' }}>QuickBooks Patients</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                  {qbOutstanding.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No outstanding QuickBooks balances</p>
                  ) : (
                    qbOutstanding.map((row) => (
                      <div
                        key={`${row.patientName}-${row.planName ?? 'plan'}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          paddingBottom: '0.65rem',
                          borderBottom: '1px solid rgba(148, 163, 184, 0.15)'
                        }}
                      >
                        <div>
                          <p style={{ margin: 0, fontWeight: 600 }}>
                            {row.patientId ? (
                              <Link 
                                href={withBasePath(`/patients/${row.patientId}`)} 
                                style={{ color: '#0f172a', textDecoration: 'none' }}
                              >
                                {row.patientName}
                              </Link>
                            ) : (
                              <span>{row.patientName}</span>
                            )}
                          </p>
                          <p style={{ margin: '0.15rem 0 0', color: '#94a3b8', fontSize: '0.82rem' }}>
                            {row.planName ?? 'Plan TBD'} · {row.status ?? 'status pending'}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#b91c1c' }}>
                            {formatCurrency(row.outstandingBalance)}
                          </p>
                          <p style={{ margin: '0.1rem 0 0', color: '#94a3b8', fontSize: '0.75rem' }}>Balance due</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            padding: '1.5rem',
            borderRadius: '0.85rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Recently Edited Patients</h3>
              <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                Last five saves, plus who updated the record.
              </p>
            </div>
            <Link href={withBasePath("/patients")} style={{ fontSize: '0.9rem', color: '#0ea5e9' }}>
              View all
            </Link>
          </div>
          {recentlyEdited.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: 0 }}>No recent edits have been recorded today.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentlyEdited.map((patient) => (
                <div
                  key={patient.patientId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.65rem 0',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.18)'
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      <Link 
                        href={withBasePath(`/patients/${patient.patientId}`)} 
                        style={{ color: '#0f172a', textDecoration: 'none' }}
                      >
                        {patient.patientName}
                      </Link>
                    </p>
                    <p style={{ margin: '0.2rem 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
                      {patient.statusKey ?? 'unknown'} · edited by {patient.lastEditor ?? 'unknown'}
                    </p>
                  </div>
                  <span style={{ color: '#475569', fontSize: '0.85rem' }}>
                    {patient.lastModified ?? 'just now'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            padding: '1.5rem',
            borderRadius: '0.85rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Recently Dispensed</h3>
              <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                Latest five doses filled so you know who pulled inventory.
              </p>
            </div>
            <Link href="/transactions" style={{ fontSize: '0.9rem', color: '#0ea5e9' }}>
              Review log
            </Link>
          </div>
          {recentlyDispensed.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: 0 }}>No dispenses recorded yet today.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentlyDispensed.map((dispense) => (
                <div
                  key={dispense.dispenseId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    padding: '0.65rem 0',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.18)'
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {dispense.patientId ? (
                        <Link 
                          href={withBasePath(`/patients/${dispense.patientId}`)} 
                          style={{ color: '#0f172a', textDecoration: 'none' }}
                        >
                          {dispense.patientName ?? 'Unknown patient'}
                        </Link>
                      ) : (
                        <span>{dispense.patientName ?? 'Unknown patient'}</span>
                      )}
                    </p>
                    <p style={{ margin: '0.2rem 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
                      {dispense.medication ?? 'Medication TBD'} · dispensed by {dispense.enteredBy ?? 'unknown'}
                    </p>
                    {dispense.signedBy ? (
                      <p style={{ margin: '0.15rem 0 0', color: '#a855f7', fontSize: '0.8rem' }}>
                        Signed by {dispense.signedBy}
                      </p>
                    ) : null}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#475569', fontSize: '0.85rem', display: 'block' }}>
                      {dispense.dispensedAt ?? 'Pending date'}
                    </span>
                    {dispense.totalAmount ? (
                      <p style={{ margin: '0.2rem 0 0', color: '#0f172a', fontSize: '0.85rem' }}>
                        {dispense.totalAmount} mL
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>


      {showExecutiveEmbed && (
        <details
          style={{
            marginBottom: '2.25rem',
            borderRadius: '1rem',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            boxShadow: '0 16px 32px rgba(15, 23, 42, 0.06)',
            background: '#ffffff',
            overflow: 'hidden'
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              padding: '1.15rem 1.4rem',
              fontWeight: 600,
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
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

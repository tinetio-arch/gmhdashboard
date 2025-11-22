export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fetchDashboardMetrics,
  fetchRecentlyEditedPatients,
  fetchRecentlyDispensedPatients
} from '@/lib/metricsQueries';
import { getMembershipStats, getOutstandingMemberships } from '@/lib/membershipStats';
import { getTestosteroneInventoryByVendor, getPaymentFailureStats } from '@/lib/testosteroneInventory';
// import { withBasePath } from '@/lib/basePath';
// Server-side version of withBasePath
function withBasePath(path: string): string {
  const basePath = '/ops';
  return path.startsWith('/') ? `${basePath}${path}` : `${basePath}/${path}`;
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
  const [metrics, membershipStats, outstandingMemberships, recentlyEdited, recentlyDispensed, testosteroneInventory, paymentFailures] = await Promise.all([
    fetchDashboardMetrics(),
    getMembershipStats(),
    getOutstandingMemberships(8),
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
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Operational Overview</h2>
      <p style={{ marginBottom: '2rem', color: '#64748b', maxWidth: '48rem' }}>
        Data below is pulled live from the Postgres database via the new schema extensions.
        Updates to patients, vials, or DEA transactions are reflected immediately once saved.
      </p>

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

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {cards.map((card) => (
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
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#0f172a' }}>Professional Dashboard</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Read-only mirror of the clinician sheet with memberships, lab cadence, and DEA summaries.
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
          {outstandingMemberships.length === 0 ? (
            <p style={{ color: '#16a34a', fontWeight: 600, margin: 0 }}>All balances cleared — great job.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {outstandingMemberships.map((row) => (
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

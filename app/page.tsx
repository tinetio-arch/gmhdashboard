export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchDashboardMetrics } from '@/lib/metricsQueries';
import { requireUser } from '@/lib/auth';

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
  await requireUser('read');
  const metrics = await fetchDashboardMetrics();
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
          <Link href="/audit" style={{ color: '#990000', textDecoration: 'underline' }}>
            Record this week’s review
          </Link>
          .
        </div>
      )}

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

      <div style={{ marginTop: '3rem', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Link
          href="/patients"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>Manage Patients</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            Filter by status, edit plans, and push updates back to Postgres without touching Google Sheets.
          </p>
        </Link>
        <Link
          href="/professional"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>Professional Dashboard</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            Read-only mirror of the clinician sheet with memberships, lab cadence, and DEA summaries.
          </p>
        </Link>
        <Link
          href="/dea"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>DEA Compliance</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            Review the last 30 days of controlled substance activity and export for audits.
          </p>
        </Link>
        <Link
          href="/inventory"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>Vials & Transactions</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            Track remaining inventory, reconcile dispenses, and flag low supply.
          </p>
        </Link>
        <Link
          href="/provider/signatures"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>Provider Signatures</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            {pendingSignatures > 0
              ? `${pendingSignatures} dispense${pendingSignatures === 1 ? '' : 's'} pending provider attestation.`
              : 'All dispenses signed — great work!'}
          </p>
        </Link>
        <Link
          href="/audit"
          style={{
            padding: '1.5rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem' }}>Weekly Audit</h3>
          <p style={{ margin: 0, color: '#64748b' }}>
            {auditOverdue
              ? 'Audit overdue — capture this week to stay compliant.'
              : 'On schedule. Log counts weekly to maintain DEA readiness.'}
          </p>
        </Link>
      </div>
    </section>
  );
}

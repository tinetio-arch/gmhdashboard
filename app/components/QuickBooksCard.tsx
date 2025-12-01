'use client';

import React, { useState } from 'react';
import type {
  QuickBooksDashboardMetrics,
  QuickBooksPaymentIssue,
  QuickBooksUnmatchedPatient,
} from '@/lib/quickbooksDashboard';

type QuickBooksCardProps = {
  metrics: QuickBooksDashboardMetrics | null;
  paymentIssues: QuickBooksPaymentIssue[];
  unmatchedPatients: QuickBooksUnmatchedPatient[];
  paymentStats: {
    count: number;
    totalAmount: number;
  };
  connection: {
    connected: boolean;
    status?: string | null;
    error?: string | null;
    lastChecked?: string | null;
  };
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

export default function QuickBooksCard({
  metrics,
  paymentIssues = [],
  unmatchedPatients = [],
  paymentStats = { count: 0, totalAmount: 0 },
  connection,
}: QuickBooksCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null);
  const [mappingPatientId, setMappingPatientId] = useState<string | null>(null);
  const [qbCustomers, setQbCustomers] = useState<Array<{ Id: string; DisplayName: string }>>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const handleSync = async () => {
    setOperationMessage(null);
    setOperationError(null);
    setSyncing(true);
    try {
      const response = await fetch('/ops/api/admin/quickbooks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Sync failed with status ${response.status}`);
      }

      const result = await response.json().catch(() => ({}));
      const message =
        result?.message ||
        `QuickBooks sync completed. Processed ${result?.summary?.processed ?? 'n/a'} records.`;
      setOperationMessage(message);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'QuickBooks sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handlePaymentCheck = async () => {
    setOperationMessage(null);
    setOperationError(null);
    setChecking(true);
    try {
      const response = await fetch('/ops/api/admin/quickbooks/check-payment-failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.details || `Payment check failed with status ${response.status}`);
      }

      const result = await response.json();
      const summary = result?.summary ?? {};
      setOperationMessage(
        `Payment check complete: ${summary.issuesCreated ?? 0} new issues, ${
          summary.issuesResolved ?? 0
        } resolved, ${summary.patientsPlacedOnHold ?? 0} patients placed on hold.`,
      );
      // Refresh page to show updated data
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : 'Payment failure check failed. Please try again.',
      );
    } finally {
      setChecking(false);
    }
  };

  const handleResolveIssue = async (issueId: string) => {
    setResolvingIssueId(issueId);
    try {
      const response = await fetch('/ops/api/admin/quickbooks/resolve-payment-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to resolve issue`);
      }

      setOperationMessage('Payment issue resolved successfully.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Failed to resolve issue.');
    } finally {
      setResolvingIssueId(null);
    }
  };

  const handleLoadCustomers = async () => {
    if (qbCustomers.length > 0) return; // Already loaded
    setLoadingCustomers(true);
    try {
      const response = await fetch('/ops/api/admin/quickbooks/patient-matching');
      if (!response.ok) throw new Error('Failed to load customers');
      const data = await response.json();
      // Extract customers from potential matches or unmapped recurring customers
      const customers = [
        ...(data.potentialMatches?.map((m: any) => m.qbCustomer) || []),
        ...(data.unmappedRecurringCustomers || []),
      ];
      setQbCustomers(customers);
    } catch (error) {
      setOperationError('Failed to load QuickBooks customers.');
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleMapPatient = async (patientId: string, qbCustomerId: string) => {
    try {
      const response = await fetch('/ops/api/admin/quickbooks/patient-matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, qbCustomerId, matchMethod: 'manual' }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to map patient`);
      }

      setOperationMessage('Patient mapped successfully.');
      setMappingPatientId(null);
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Failed to map patient.');
    }
  };

  return (
    <div
      style={{
        marginBottom: '2rem',
        borderRadius: '1rem',
        border: '2px solid #f59e0b',
        background: '#fff8ed',
        boxShadow: '0 20px 45px rgba(245, 158, 11, 0.2)',
        padding: '2rem',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: connection.connected ? '#10b981' : '#ef4444',
                  boxShadow: connection.connected
                    ? '0 0 10px rgba(16, 185, 129, 0.4)'
                    : '0 0 10px rgba(239, 68, 68, 0.4)',
                }}
              />
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>
                QuickBooks Operations Center
              </h2>
            </div>
            <p style={{ margin: 0, color: '#7c2d12', fontSize: '0.9rem' }}>
              {connection.connected ? 'Connected to QuickBooks' : 'Connection required'}
              {connection.lastChecked && (
                <span style={{ marginLeft: '0.5rem', color: '#a16207' }}>
                  · Last checked {new Date(connection.lastChecked).toLocaleString()}
                </span>
              )}
            </p>
            {connection.error && (
              <p style={{ margin: '0.25rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>
                ⚠️ {connection.error}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <a
              href="/ops/api/auth/quickbooks"
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.6rem',
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 600,
                textDecoration: 'none',
                boxShadow: '0 10px 20px rgba(37, 99, 235, 0.25)',
              }}
            >
              {connection.connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}
            </a>
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.6rem',
                background: syncing ? '#94a3b8' : '#059669',
                color: '#ffffff',
                fontWeight: 600,
                border: 'none',
                cursor: syncing ? 'wait' : 'pointer',
                boxShadow: '0 10px 20px rgba(5, 150, 105, 0.25)',
              }}
            >
              {syncing ? 'Syncing…' : 'Sync QuickBooks'}
            </button>
            <button
              onClick={handlePaymentCheck}
              disabled={checking}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.6rem',
                background: checking ? '#94a3b8' : '#dc2626',
                color: '#ffffff',
                fontWeight: 600,
                border: 'none',
                cursor: checking ? 'wait' : 'pointer',
                boxShadow: '0 10px 20px rgba(220, 38, 38, 0.25)',
              }}
            >
              {checking ? 'Checking…' : 'Run Payment Check'}
            </button>
            <a
              href="/ops/admin/quickbooks"
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.6rem',
                background: '#7c3aed',
                color: '#ffffff',
                fontWeight: 600,
                textDecoration: 'none',
                boxShadow: '0 10px 20px rgba(124, 58, 237, 0.25)',
              }}
            >
              Open QuickBooks Admin →
            </a>
          </div>
        </div>

        {(operationMessage || operationError) && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              border: `1px solid ${operationError ? '#fee2e2' : '#dcfce7'}`,
              backgroundColor: operationError ? '#fef2f2' : '#ecfdf5',
              color: operationError ? '#b91c1c' : '#047857',
              fontSize: '0.85rem',
            }}
          >
            {operationError || operationMessage}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <MetricTile label="Daily Revenue" value={formatCurrency(metrics?.dailyRevenue ?? 0)} accent="#047857" />
        <MetricTile label="Weekly Revenue" value={formatCurrency(metrics?.weeklyRevenue ?? 0)} accent="#2563eb" />
        <MetricTile label="Monthly Revenue" value={formatCurrency(metrics?.monthlyRevenue ?? 0)} accent="#7c3aed" />
        <MetricTile
          label="Payment Issues"
          value={formatNumber(metrics?.paymentIssues ?? 0)}
          accent={metrics && metrics.paymentIssues > 0 ? '#dc2626' : '#059669'}
          helper={`Outstanding QuickBooks issues · ${formatCurrency((paymentStats ?? {
            count: 0,
            totalAmount: 0,
          }).totalAmount)}`}
        />
        <MetricTile
          label="Patients on Recurring"
          value={formatNumber(metrics?.totalPatientsOnRecurring ?? 0)}
          accent="#1d4ed8"
        />
        <MetricTile
          label="Unmatched Patients"
          value={formatNumber(metrics?.unmatchedPatients ?? 0)}
          accent={metrics && metrics.unmatchedPatients > 0 ? '#f97316' : '#059669'}
          helper="Need QuickBooks mapping"
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <CardPanel
          title="Critical Payment Issues"
          emptyMessage="All QuickBooks payments are current."
          footer={
            <a
              href="/ops/admin/quickbooks"
              style={{ fontSize: '0.8rem', color: '#b91c1c', fontWeight: 600, textDecoration: 'none' }}
            >
              Manage payment issues →
            </a>
          }
        >
          {paymentIssues.slice(0, 5).map((issue) => (
            <div
              key={issue.issue_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                background: '#fff',
                border: '1px solid rgba(220, 38, 38, 0.15)',
                marginBottom: '0.5rem',
                gap: '0.75rem',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.15rem', color: '#991b1b' }}>{issue.patient_name}</div>
                <div style={{ fontSize: '0.8rem', color: '#7f1d1d' }}>
                  {issue.issue_type.replace(/_/g, ' ')} · {issue.days_overdue ?? 0} days overdue
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Opened {new Date(issue.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                <div style={{ fontWeight: 700, color: '#dc2626' }}>{formatCurrency(issue.amount_owed ?? 0)}</div>
                <button
                  onClick={() => handleResolveIssue(issue.issue_id)}
                  disabled={resolvingIssueId === issue.issue_id}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '0.4rem',
                    background: resolvingIssueId === issue.issue_id ? '#94a3b8' : '#10b981',
                    color: '#ffffff',
                    fontWeight: 600,
                    border: 'none',
                    cursor: resolvingIssueId === issue.issue_id ? 'wait' : 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  {resolvingIssueId === issue.issue_id ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>
          ))}
        </CardPanel>

        <CardPanel
          title="Patients Requiring QuickBooks Mapping"
          emptyMessage="All QuickBooks patients are mapped."
          footer={
            <a
              href="/ops/admin/quickbooks"
              style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600, textDecoration: 'none' }}
            >
              Resolve unmatched patients →
            </a>
          }
        >
          {unmatchedPatients.slice(0, 5).map((patient) => (
            <div
              key={patient.patient_id}
              style={{
                padding: '0.75rem',
                borderRadius: '0.75rem',
                background: '#fff',
                border: '1px solid rgba(251, 146, 60, 0.2)',
                marginBottom: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#c2410c', marginBottom: '0.2rem' }}>{patient.full_name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#7c2d12' }}>{patient.email ?? 'No email on file'}</div>
                  <div style={{ fontSize: '0.8rem', color: '#7c2d12' }}>{patient.phone_primary ?? 'No phone on file'}</div>
                </div>
                <button
                  onClick={() => {
                    setMappingPatientId(patient.patient_id);
                    handleLoadCustomers();
                  }}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '0.4rem',
                    background: '#f97316',
                    color: '#ffffff',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Map
                </button>
              </div>
              {mappingPatientId === patient.patient_id && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fffbeb', borderRadius: '0.5rem' }}>
                  {loadingCustomers ? (
                    <div style={{ fontSize: '0.8rem', color: '#92400e' }}>Loading customers...</div>
                  ) : qbCustomers.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#92400e' }}>No QuickBooks customers found. Please sync first.</div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: '0.5rem' }}>
                        Select QuickBooks Customer:
                      </div>
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handleMapPatient(patient.patient_id, e.target.value);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '0.4rem',
                          border: '1px solid rgba(251, 146, 60, 0.3)',
                          fontSize: '0.8rem',
                        }}
                      >
                        <option value="">Choose customer...</option>
                        {qbCustomers.map((customer) => (
                          <option key={customer.Id} value={customer.Id}>
                            {customer.DisplayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardPanel>
      </div>
    </div>
  );
}

type CardPanelProps = {
  title: string;
  emptyMessage: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

function CardPanel({ title, emptyMessage, children, footer }: CardPanelProps) {
  const content = React.Children.toArray(children);
  const hasContent = content.length > 0;

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '1rem',
        border: '1px solid rgba(15, 23, 42, 0.08)',
        boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
        padding: '1.5rem',
        minHeight: '220px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>{title}</div>
      {hasContent ? (
        <div>{content}</div>
      ) : (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            background: '#f8fafc',
            border: '1px dashed rgba(148, 163, 184, 0.4)',
            color: '#475569',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          {emptyMessage}
        </div>
      )}
      {footer && <div style={{ marginTop: '0.75rem' }}>{footer}</div>}
    </div>
  );
}

type MetricTileProps = {
  label: string;
  value: string;
  accent: string;
  helper?: string;
};

function MetricTile({ label, value, accent, helper }: MetricTileProps) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '0.9rem',
        padding: '1rem',
        border: `1px solid ${accent}1A`,
        boxShadow: `0 12px 24px ${accent}33`,
      }}
    >
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: accent }}>{value}</div>
      {helper && (
        <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.25rem', fontWeight: 500 }}>{helper}</div>
      )}
    </div>
  );
}



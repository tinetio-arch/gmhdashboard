'use client';
import { formatDateUTC } from '@/lib/dateUtils';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';

type PaymentIssue = {
  issueId: string;
  issueType: string;
  severity: string;
  amountOwed: number;
  daysOverdue: number;
  createdAt: string;
  resolutionNotes?: string | null;
};

type Props = {
  paymentIssues: PaymentIssue[];
  patientId: string;
};

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatDateUTC(date);
}

export default function PatientDetailClient({ paymentIssues, patientId }: Props) {
  const router = useRouter();
  const [resolvingIssue, setResolvingIssue] = useState<string | null>(null);
  const [resolvedIssues, setResolvedIssues] = useState<Set<string>>(new Set());

  const handleResolve = async (issueId: string, issueType: string) => {
    // First confirmation - are they sure?
    if (!confirm('Are you sure you want to mark this payment issue as resolved?')) {
      return;
    }

    // For contract_expired issues, different confirmation message
    if (issueType === 'contract_expired') {
      const newContractActive = confirm(
        'Has a new contract been activated for this patient?\n\n' +
        'Click OK if a new contract is now active.\n' +
        'Click Cancel if you need to set up the new contract first.'
      );

      if (!newContractActive) {
        alert('Please set up the new contract first, then try again.');
        return;
      }
    } else {
      // For payment issues, confirm it was cleared in the financial system
      const clearedInSystem = confirm(
        'Have you cleared this charge in the financial system (QuickBooks/Jane)?\n\n' +
        'Click OK if the charge has been cleared in the system.\n' +
        'Click Cancel if you need to clear it in the system first.'
      );

      if (!clearedInSystem) {
        alert('Please clear the charge in QuickBooks or Jane first, then try again.');
        return;
      }
    }

    setResolvingIssue(issueId);

    try {
      const response = await fetch(withBasePath('/api/admin/quickbooks/resolve-payment-issue'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issueId,
          updatePatientStatus: true,
          resolutionNote: issueType === 'contract_expired'
            ? 'Contract expiration issue resolved - new contract active'
            : 'Charge cleared in financial system and confirmed by user'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to resolve payment issue');
      }

      // Mark as resolved locally
      setResolvedIssues(prev => new Set([...prev, issueId]));

      // Show success message
      alert('Payment issue resolved successfully! Patient status has been updated to Active.');

      // Refresh the page after a short delay to show the updated data
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch (error) {
      console.error('Error resolving payment issue:', error);
      alert('Failed to resolve payment issue. Please try again.');
    } finally {
      setResolvingIssue(null);
    }
  };

  // Filter out issues that have been resolved locally
  const activeIssues = paymentIssues.filter(issue => !resolvedIssues.has(issue.issueId));

  if (activeIssues.length === 0) {
    return null;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Open Payment Issues</h3>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 700 }}>
        <thead>
          <tr>
            {['Issue', 'Severity', 'Amount Owed', 'Days Overdue', 'Created', 'Actions'].map((header) => (
              <th
                key={header}
                style={{
                  padding: '0.65rem 0.9rem',
                  textAlign: 'left',
                  fontSize: '0.75rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#475569',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid rgba(148,163,184,0.3)'
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeIssues.map((issue) => {
            return (
              <tr key={issue.issueId}>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', textTransform: 'capitalize' }}>
                  {issue.issueType.replace('_', ' ')}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{issue.severity}</td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', color: '#dc2626', fontWeight: 600 }}>
                  {formatCurrency(issue.amountOwed)}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {issue.daysOverdue > 0 ? `${issue.daysOverdue} days` : '—'}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {formatDate(issue.createdAt)}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  <button
                    onClick={() => handleResolve(issue.issueId, issue.issueType)}
                    disabled={resolvingIssue === issue.issueId}
                    style={{
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: '#ffffff',
                      backgroundColor: resolvingIssue === issue.issueId ? '#94a3b8' : '#15803d',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: resolvingIssue === issue.issueId ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (resolvingIssue !== issue.issueId) {
                        e.currentTarget.style.backgroundColor = '#14532d';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (resolvingIssue !== issue.issueId) {
                        e.currentTarget.style.backgroundColor = '#15803d';
                      }
                    }}
                  >
                    {resolvingIssue === issue.issueId ? 'Resolving...' : 'Mark Resolved'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

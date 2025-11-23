'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ClinicSyncMembership = {
  clinicsyncId: string;
  plan: string | null;
  passId: number | null;
  tier: string | null;
  status: string | null;
  balanceOwing: number | null;
  amountDue: number | null;
  nextPaymentDue: string | null;
  contractEnd: string | null;
  isActive: boolean;
  updatedAt: string | null;
};

type Props = {
  memberships: ClinicSyncMembership[];
  patientId: string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default function ClinicSyncMembershipsClient({ memberships, patientId }: Props) {
  const router = useRouter();
  const [resolvingMembership, setResolvingMembership] = useState<string | null>(null);

  const handleResolve = async (membershipId: string) => {
    // First confirmation - are they sure?
    if (!confirm('Are you sure you want to clear this outstanding balance?')) {
      return;
    }

    // Second confirmation - was it cleared in Jane?
    const clearedInJane = confirm(
      'Have you cleared this charge in Jane?\n\n' +
      'Click OK if the charge has been cleared in Jane.\n' +
      'Click Cancel if you need to clear it in Jane first.'
    );

    if (!clearedInJane) {
      alert('Please clear the charge in Jane first, then try again.');
      return;
    }

    setResolvingMembership(membershipId);
    
    try {
      const response = await fetch('/ops/api/admin/clinicsync/clear-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          patientId,
          membershipId 
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to clear balance');
      }

      const result = await response.json();
      
      // Show success message
      if (result.statusUpdated) {
        alert('Balance cleared successfully! Patient status has been updated to Active.');
      } else {
        alert('Balance cleared successfully!');
      }

      // Refresh the page after a short delay to show the updated data
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch (error) {
      console.error('Error clearing balance:', error);
      alert('Failed to clear balance. Please try again.');
    } finally {
      setResolvingMembership(null);
    }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>ClinicSync Memberships</h3>
      {/* Show active memberships count if multiple */}
      {memberships.filter(m => m.isActive).length > 1 && (
        <div style={{ 
          padding: '0.5rem 1rem', 
          backgroundColor: '#dbeafe', 
          borderRadius: '0.375rem',
          marginBottom: '0.75rem',
          color: '#1e40af',
          fontSize: '0.875rem'
        }}>
          ℹ️ This patient has {memberships.filter(m => m.isActive).length} active memberships
        </div>
      )}
      
      {/* Show info about clearing balances */}
      {memberships.some(m => m.isActive && (m.balanceOwing || m.amountDue || 0) > 0) && (
        <div style={{ 
          padding: '0.5rem 1rem', 
          backgroundColor: '#fef3c7', 
          borderRadius: '0.375rem',
          marginBottom: '0.75rem',
          color: '#92400e',
          fontSize: '0.875rem'
        }}>
          💡 Clearing a balance here will also resolve any related payment issues automatically
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 820 }}>
        <thead>
          <tr>
            {['Plan', 'Pass ID', 'Tier', 'Status', 'Balance', 'Next Payment', 'End Date', 'Actions'].map((header) => (
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
          {memberships.map((membership) => {
            const hasBalance = (membership.balanceOwing || membership.amountDue || 0) > 0;
            
            return (
              <tr key={`${membership.clinicsyncId}-${membership.updatedAt ?? ''}`}
                  style={{ 
                    backgroundColor: membership.isActive ? 'transparent' : 'rgba(243, 244, 246, 0.5)'
                  }}>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {membership.plan ?? membership.clinicsyncId}
                  {!membership.isActive && membership.contractEnd && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>
                      Expired
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {membership.passId ?? '—'}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{membership.tier ?? '—'}</td>
                <td
                  style={{
                    padding: '0.65rem 0.9rem',
                    borderBottom: '1px solid rgba(148,163,184,0.15)',
                    color: membership.isActive ? '#15803d' : '#64748b'
                  }}
                >
                  {membership.status ?? (membership.isActive ? 'active' : 'expired')}
                </td>
                <td style={{ 
                  padding: '0.65rem 0.9rem', 
                  borderBottom: '1px solid rgba(148,163,184,0.15)',
                  color: hasBalance ? '#dc2626' : '#0f172a',
                  fontWeight: hasBalance ? 600 : 400
                }}>
                  {formatCurrency(membership.balanceOwing || membership.amountDue)}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {formatDate(membership.nextPaymentDue)}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {formatDate(membership.contractEnd)}
                </td>
                <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                  {hasBalance && membership.isActive && (
                    <button
                      onClick={() => handleResolve(membership.clinicsyncId)}
                      disabled={resolvingMembership === membership.clinicsyncId}
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: '#ffffff',
                        backgroundColor: resolvingMembership === membership.clinicsyncId ? '#94a3b8' : '#15803d',
                        border: 'none',
                        borderRadius: '0.375rem',
                        cursor: resolvingMembership === membership.clinicsyncId ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (resolvingMembership !== membership.clinicsyncId) {
                          e.currentTarget.style.backgroundColor = '#14532d';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (resolvingMembership !== membership.clinicsyncId) {
                          e.currentTarget.style.backgroundColor = '#15803d';
                        }
                      }}
                    >
                      {resolvingMembership === membership.clinicsyncId ? 'Clearing...' : 'Clear Balance'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

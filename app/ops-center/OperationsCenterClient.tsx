'use client';

import { useState } from 'react';
import Link from 'next/link';

interface OperationsCenterProps {
  janeOutstanding: any[];
  qbOutstanding: any[];
  paymentFailures: any;
  membershipHolds: any[];
  recentPaymentIssues: any[];
  systemHealth: any[];
  clinicSyncActivity: any[];
  ghlSyncHistory: any[];
  quickActionsNeeded: any[];
}

function withBasePath(path: string): string {
  return path;
}

export default function OperationsCenterClient({
  janeOutstanding,
  qbOutstanding,
  paymentFailures,
  membershipHolds,
  recentPaymentIssues,
  systemHealth,
  clinicSyncActivity,
  ghlSyncHistory,
  quickActionsNeeded
}: OperationsCenterProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'jane' | 'quickbooks' | 'ghl' | 'bulk-actions'>('overview');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);

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
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const totalOutstanding = janeOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0) + 
                          qbOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0);

  return (
    <div>
      {/* Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '0.5rem', 
        marginBottom: '2rem',
        borderBottom: '2px solid #e2e8f0',
        paddingBottom: '1rem'
      }}>
        {[
          { key: 'overview', label: '🎯 Overview', count: janeOutstanding.length + qbOutstanding.length + membershipHolds.length },
          { key: 'jane', label: '🏥 Jane Issues', count: janeOutstanding.length },
          { key: 'quickbooks', label: '💰 QuickBooks Issues', count: qbOutstanding.length },
          { key: 'ghl', label: '🔗 GHL Issues', count: ghlSyncHistory.filter((h: any) => h.error_message).length },
          { key: 'bulk-actions', label: '⚡ Bulk Actions', count: quickActionsNeeded.reduce((sum: number, action: any) => sum + action.count, 0) }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: activeTab === tab.key 
                ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' 
                : '#ffffff',
              color: activeTab === tab.key ? '#ffffff' : '#64748b',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: activeTab === tab.key 
                ? '0 4px 12px rgba(59, 130, 246, 0.3)' 
                : '0 2px 4px rgba(0, 0, 0, 0.1)'
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                padding: '0.2rem 0.5rem',
                borderRadius: '999px',
                backgroundColor: activeTab === tab.key ? 'rgba(255, 255, 255, 0.2)' : '#ef4444',
                color: activeTab === tab.key ? '#ffffff' : '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 700
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div>
          {/* System Health Overview */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
              🔗 System Health Status
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1.5rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
            }}>
              {systemHealth.map((system: any, index: number) => (
                <div
                  key={index}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '1rem',
                    background: system.issues_count > 0 
                      ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
                      : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                    border: system.issues_count > 0 ? '2px solid #ef4444' : '2px solid #10b981',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ 
                      width: '12px', 
                      height: '12px', 
                      borderRadius: '50%', 
                      backgroundColor: system.issues_count > 0 ? '#ef4444' : '#10b981',
                      boxShadow: `0 0 8px ${system.issues_count > 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                    }} />
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                      {system.system_name}
                    </h3>
                  </div>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Total Records:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>{system.total_records}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Recent Updates:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#059669' }}>{system.recent_updates}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Issues:</span>
                      <span style={{ 
                        fontSize: '0.9rem', 
                        fontWeight: 600, 
                        color: system.issues_count > 0 ? '#dc2626' : '#059669'
                      }}>
                        {system.issues_count}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Last Update:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#0f172a' }}>
                        {formatTimeAgo(system.last_update)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions Needed */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
              ⚡ Quick Actions Available
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
            }}>
              {quickActionsNeeded.filter((action: any) => action.count > 0).map((action: any, index: number) => (
                <button
                  key={index}
                  onClick={() => setActiveTab('bulk-actions')}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '1rem',
                    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                    border: '2px solid #3b82f6',
                    boxShadow: '0 8px 24px rgba(59, 130, 246, 0.15)',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                      {action.description}
                    </h3>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '999px',
                      backgroundColor: '#3b82f6',
                      color: '#ffffff',
                      fontSize: '0.8rem',
                      fontWeight: 700
                    }}>
                      {action.count}
                    </span>
                  </div>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
                    Click to perform bulk action on {action.count} items
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Issues Summary */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#0f172a', fontWeight: 600 }}>
              🚨 All Issues Summary
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1.5rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))'
            }}>
              {/* Jane Issues Summary */}
              <div style={{
                padding: '1.5rem',
                borderRadius: '1rem',
                background: '#ffffff',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                    🏥 Jane Issues ({janeOutstanding.length})
                  </h3>
                  <button
                    onClick={() => setActiveTab('jane')}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      background: '#3b82f6',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    View All →
                  </button>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem' }}>
                  Total Outstanding: {formatCurrency(janeOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0))}
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {janeOutstanding.slice(0, 5).map((patient, index) => (
                    <Link
                      key={index}
                      href={withBasePath(`/patients/${patient.patientId}`)}
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
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0c4a6e' }}>
                          {patient.patientName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#075985' }}>
                          {patient.planName || 'Membership'} • {formatCurrency(patient.outstandingBalance)}
                        </div>
                      </div>
                      <div style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#3b82f6',
                        color: '#ffffff',
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}>
                        FIX
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* QuickBooks Issues Summary */}
              <div style={{
                padding: '1.5rem',
                borderRadius: '1rem',
                background: '#ffffff',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                    💰 QuickBooks Issues ({qbOutstanding.length})
                  </h3>
                  <button
                    onClick={() => setActiveTab('quickbooks')}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      background: '#f59e0b',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    View All →
                  </button>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem' }}>
                  Total Outstanding: {formatCurrency(qbOutstanding.reduce((sum, p) => sum + Number(p.outstandingBalance || 0), 0))}
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {qbOutstanding.slice(0, 5).map((patient, index) => (
                    <Link
                      key={index}
                      href={withBasePath(`/patients/${patient.patientId}`)}
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
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#92400e' }}>
                          {patient.patientName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#a16207' }}>
                          Payment Issue • {formatCurrency(patient.outstandingBalance)}
                        </div>
                      </div>
                      <div style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#f59e0b',
                        color: '#ffffff',
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}>
                        FIX
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Membership Holds Summary */}
              <div style={{
                padding: '1.5rem',
                borderRadius: '1rem',
                background: '#ffffff',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                    ⏸️ Membership Holds ({membershipHolds.length})
                  </h3>
                  <Link
                    href={withBasePath("/patients?status=hold")}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      background: '#dc2626',
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}
                  >
                    View All →
                  </Link>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem' }}>
                  Critical: {membershipHolds.filter((h: any) => h.days_on_hold > 7).length} holds over 7 days
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {membershipHolds.slice(0, 5).map((hold: any, index: number) => (
                    <Link
                      key={index}
                      href={withBasePath(`/patients/${hold.patient_id}`)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: hold.days_on_hold > 7 ? '#fee2e2' : '#fef3c7',
                        border: hold.days_on_hold > 7 ? '1px solid #ef4444' : '1px solid #f59e0b',
                        textDecoration: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
                          {hold.patient_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {hold.hold_reason} • {Math.round(hold.days_on_hold)} days
                        </div>
                      </div>
                      <div style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: hold.days_on_hold > 7 ? '#dc2626' : '#f59e0b',
                        color: '#ffffff',
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}>
                        RESOLVE
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Other tab content will be added here */}
      {activeTab !== 'overview' && (
        <div style={{ 
          padding: '2rem', 
          textAlign: 'center',
          backgroundColor: '#f1f5f9',
          borderRadius: '1rem',
          border: '1px solid #cbd5e1'
        }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#64748b' }}>
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Section
          </h3>
          <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
            Detailed {activeTab} management interface coming next...
          </p>
        </div>
      )}
    </div>
  );
}

function formatCurrency(value: string | number | null): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
  
  if (!value) return formatter.format(0);
  const parsed = Number(value);
  return formatter.format(Number.isFinite(parsed) ? parsed : 0);
}




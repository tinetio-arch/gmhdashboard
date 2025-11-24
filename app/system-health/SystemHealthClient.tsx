'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface SystemHealthProps {
  clinicSyncHealth: any;
  quickBooksHealth: any;
  ghlHealth: any;
  integrationErrors: any[];
  syncPerformance: any[];
  dataQuality: any[];
}

function withBasePath(path: string): string {
  return path;
}

export default function SystemHealthClient({
  clinicSyncHealth,
  quickBooksHealth,
  ghlHealth,
  integrationErrors,
  syncPerformance,
  dataQuality
}: SystemHealthProps) {
  const [activeView, setActiveView] = useState<'overview' | 'clinicsync' | 'quickbooks' | 'ghl' | 'data-quality'>('overview');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Auto-refresh every 30 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      window.location.reload();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

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

  const formatCurrency = (value: string | number | null) => {
    if (!value) return '$0.00';
    const parsed = Number(value);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    }).format(Number.isFinite(parsed) ? parsed : 0);
  };

  const getHealthStatus = (system: string, data: any) => {
    if (system === 'ClinicSync') {
      const recentActivity = data.recent_updates || 0;
      const totalRecords = data.total_memberships || 0;
      if (recentActivity === 0) return { status: 'warning', label: 'No Recent Activity' };
      if (recentActivity / totalRecords > 0.1) return { status: 'excellent', label: 'High Activity' };
      return { status: 'good', label: 'Normal Activity' };
    }
    
    if (system === 'QuickBooks') {
      const unresolved = data.unresolved_issues || 0;
      const newToday = data.new_issues_today || 0;
      if (unresolved > 10) return { status: 'critical', label: 'Many Unresolved Issues' };
      if (newToday > 5) return { status: 'warning', label: 'High Issue Creation Rate' };
      return { status: 'good', label: 'Issues Under Control' };
    }
    
    if (system === 'GoHighLevel') {
      const successRate = data.success_rate || 0;
      const failedSyncs = data.failed_syncs || 0;
      if (successRate < 80) return { status: 'critical', label: 'Low Success Rate' };
      if (failedSyncs > 10) return { status: 'warning', label: 'Multiple Failures' };
      return { status: 'excellent', label: 'High Success Rate' };
    }
    
    return { status: 'unknown', label: 'Status Unknown' };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return '#059669';
      case 'good': return '#10b981';
      case 'warning': return '#f59e0b';
      case 'critical': return '#dc2626';
      default: return '#64748b';
    }
  };

  const getStatusBackground = (status: string) => {
    switch (status) {
      case 'excellent': return 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)';
      case 'good': return 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)';
      case 'warning': return 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)';
      case 'critical': return 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)';
      default: return 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)';
    }
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        padding: '1rem 1.5rem',
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0'
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[
            { key: 'overview', label: '🎯 Overview' },
            { key: 'clinicsync', label: '🏥 ClinicSync' },
            { key: 'quickbooks', label: '💰 QuickBooks' },
            { key: 'ghl', label: '🔗 GoHighLevel' },
            { key: 'data-quality', label: '📊 Data Quality' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key as any)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: activeView === tab.key ? '#3b82f6' : 'transparent',
                color: activeView === tab.key ? '#ffffff' : '#64748b',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              background: '#10b981',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🔄 Refresh Now
          </button>
        </div>
      </div>

      {/* Overview */}
      {activeView === 'overview' && (
        <div>
          {/* System Status Cards */}
          <div style={{ 
            display: 'grid', 
            gap: '1.5rem', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            marginBottom: '3rem'
          }}>
            {/* ClinicSync Status */}
            {(() => {
              const health = getHealthStatus('ClinicSync', clinicSyncHealth);
              return (
                <div style={{
                  padding: '2rem',
                  borderRadius: '1rem',
                  background: getStatusBackground(health.status),
                  border: `2px solid ${getStatusColor(health.status)}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      borderRadius: '50%', 
                      backgroundColor: getStatusColor(health.status),
                      boxShadow: `0 0 12px ${getStatusColor(health.status)}40`
                    }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                        Jane EMR / ClinicSync
                      </h3>
                      <p style={{ margin: '0.25rem 0 0', color: getStatusColor(health.status), fontSize: '0.9rem', fontWeight: 600 }}>
                        {health.label}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Total Memberships:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
                        {clinicSyncHealth.total_memberships || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Updated Today:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#059669' }}>
                        {clinicSyncHealth.recent_updates || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Outstanding Balances:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#dc2626' }}>
                        {clinicSyncHealth.outstanding_balances || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Last Update:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#0f172a' }}>
                        {formatTimeAgo(clinicSyncHealth.last_update)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* QuickBooks Status */}
            {(() => {
              const health = getHealthStatus('QuickBooks', quickBooksHealth);
              return (
                <div style={{
                  padding: '2rem',
                  borderRadius: '1rem',
                  background: getStatusBackground(health.status),
                  border: `2px solid ${getStatusColor(health.status)}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      borderRadius: '50%', 
                      backgroundColor: getStatusColor(health.status),
                      boxShadow: `0 0 12px ${getStatusColor(health.status)}40`
                    }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                        QuickBooks Online
                      </h3>
                      <p style={{ margin: '0.25rem 0 0', color: getStatusColor(health.status), fontSize: '0.9rem', fontWeight: 600 }}>
                        {health.label}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Total Issues:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
                        {quickBooksHealth.total_issues || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>New Today:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ea580c' }}>
                        {quickBooksHealth.new_issues_today || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Unresolved:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#dc2626' }}>
                        {quickBooksHealth.unresolved_issues || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Outstanding:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#dc2626' }}>
                        {formatCurrency(quickBooksHealth.total_outstanding)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* GHL Status */}
            {(() => {
              const health = getHealthStatus('GoHighLevel', ghlHealth);
              return (
                <div style={{
                  padding: '2rem',
                  borderRadius: '1rem',
                  background: getStatusBackground(health.status),
                  border: `2px solid ${getStatusColor(health.status)}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      borderRadius: '50%', 
                      backgroundColor: getStatusColor(health.status),
                      boxShadow: `0 0 12px ${getStatusColor(health.status)}40`
                    }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                        GoHighLevel CRM
                      </h3>
                      <p style={{ margin: '0.25rem 0 0', color: getStatusColor(health.status), fontSize: '0.9rem', fontWeight: 600 }}>
                        {health.label}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Success Rate:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: getStatusColor(health.status) }}>
                        {ghlHealth.success_rate || 0}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Syncs Today:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#059669' }}>
                        {ghlHealth.syncs_today || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Failed Syncs:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#dc2626' }}>
                        {ghlHealth.failed_syncs || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Last Sync:</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#0f172a' }}>
                        {formatTimeAgo(ghlHealth.last_sync_attempt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Data Quality Issues */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
              📊 Data Quality Issues
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
            }}>
              {dataQuality.map((issue: any, index: number) => (
                <div
                  key={index}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '1rem',
                    background: '#ffffff',
                    border: issue.count > 0 ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                      {issue.description}
                    </h3>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '999px',
                      backgroundColor: issue.count > 0 ? '#f59e0b' : '#10b981',
                      color: '#ffffff',
                      fontSize: '0.8rem',
                      fontWeight: 700
                    }}>
                      {issue.count}
                    </span>
                  </div>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
                    {issue.count > 0 
                      ? `${issue.count} records need attention` 
                      : 'All records have complete data'
                    }
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Integration Errors */}
          {integrationErrors.length > 0 && (
            <div style={{ marginBottom: '3rem' }}>
              <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
                🚨 Recent Integration Errors (24h)
              </h2>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {integrationErrors.map((error: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      padding: '1.5rem',
                      borderRadius: '1rem',
                      background: '#fee2e2',
                      border: '2px solid #ef4444',
                      boxShadow: '0 8px 24px rgba(239, 68, 68, 0.15)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#991b1b' }}>
                          {error.system} - {error.error_type}
                        </h3>
                        <p style={{ margin: '0.25rem 0 0', color: '#dc2626', fontSize: '0.85rem' }}>
                          {error.error_count} errors in the last 24 hours
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>
                          Last Error:
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                          {formatTimeAgo(error.last_error)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Other views placeholder */}
      {activeView !== 'overview' && (
        <div style={{ 
          padding: '3rem', 
          textAlign: 'center',
          backgroundColor: '#f1f5f9',
          borderRadius: '1rem',
          border: '1px solid #cbd5e1'
        }}>
          <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#64748b', marginBottom: '1rem' }}>
            {activeView.charAt(0).toUpperCase() + activeView.slice(1).replace('-', ' ')} Monitoring
          </h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '1rem' }}>
            Detailed {activeView.replace('-', ' ')} monitoring interface will be built here next.
          </p>
        </div>
      )}
    </div>
  );
}


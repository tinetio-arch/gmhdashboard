'use client';

import { useState } from 'react';
import Link from 'next/link';

interface BusinessIntelligenceProps {
  metrics: any;
  paymentFailures: any;
  revenueAnalysis: any[];
  patientGrowthTrends: any[];
  operationalEfficiency: any[];
  systemPerformance: any[];
  predictiveInsights: any[];
  financialHealth: any[];
}

function withBasePath(path: string): string {
  return path;
}

export default function BusinessIntelligenceClient({
  metrics,
  paymentFailures,
  revenueAnalysis,
  patientGrowthTrends,
  operationalEfficiency,
  systemPerformance,
  predictiveInsights,
  financialHealth
}: BusinessIntelligenceProps) {
  const [activeView, setActiveView] = useState<'overview' | 'revenue' | 'patients' | 'operations' | 'predictions'>('overview');

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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Calculate key business metrics
  const totalRevenueLost = paymentFailures.jane.totalAmount + paymentFailures.quickbooks.totalAmount;
  const totalPatientsWithIssues = paymentFailures.jane.count + paymentFailures.quickbooks.count;
  const revenueGrowthRate = revenueAnalysis.length >= 2 
    ? ((revenueAnalysis[0]?.total_amount - revenueAnalysis[1]?.total_amount) / revenueAnalysis[1]?.total_amount * 100)
    : 0;

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
          { key: 'overview', label: '🎯 Executive Overview' },
          { key: 'revenue', label: '💰 Revenue Analytics' },
          { key: 'patients', label: '👥 Patient Trends' },
          { key: 'operations', label: '🏥 Operational Efficiency' },
          { key: 'predictions', label: '🔮 Predictive Insights' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key as any)}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: activeView === tab.key 
                ? 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)' 
                : '#ffffff',
              color: activeView === tab.key ? '#ffffff' : '#64748b',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: activeView === tab.key 
                ? '0 4px 12px rgba(124, 58, 237, 0.3)' 
                : '0 2px 4px rgba(0, 0, 0, 0.1)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Executive Overview */}
      {activeView === 'overview' && (
        <div>
          {/* Key Business Metrics */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
              📊 Key Business Metrics
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1.5rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))'
            }}>
              {/* Revenue Health */}
              <div style={{
                padding: '2rem',
                borderRadius: '1rem',
                background: totalRevenueLost > 0 
                  ? 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' 
                  : 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                border: totalRevenueLost > 0 ? '2px solid #ef4444' : '2px solid #10b981',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '2rem' }}>{totalRevenueLost > 0 ? '💸' : '💰'}</div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                      Revenue at Risk
                    </h3>
                    <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                      Outstanding payment issues
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '2.5rem', 
                    fontWeight: 700, 
                    color: totalRevenueLost > 0 ? '#dc2626' : '#059669',
                    marginBottom: '0.5rem'
                  }}>
                    {formatCurrency(totalRevenueLost)}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
                    {totalPatientsWithIssues} patients affected
                  </div>
                </div>
              </div>

              {/* Patient Operations Health */}
              <div style={{
                padding: '2rem',
                borderRadius: '1rem',
                background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
                border: '2px solid #0ea5e9',
                boxShadow: '0 8px 24px rgba(14, 165, 233, 0.15)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '2rem' }}>👥</div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                      Patient Operations
                    </h3>
                    <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                      Active patient management
                    </p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#059669', marginBottom: '0.25rem' }}>
                      {metrics.activePatients}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Active</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                      {Math.round((metrics.activePatients / metrics.totalPatients) * 100)}%
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Active Rate</div>
                  </div>
                </div>
              </div>

              {/* Clinical Efficiency */}
              <div style={{
                padding: '2rem',
                borderRadius: '1rem',
                background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
                border: '2px solid #a855f7',
                boxShadow: '0 8px 24px rgba(168, 85, 247, 0.15)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '2rem' }}>🏥</div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                      Clinical Efficiency
                    </h3>
                    <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                      Lab and dispensing metrics
                    </p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c3aed', marginBottom: '0.25rem' }}>
                      {metrics.controlledDispensesLast30}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Dispenses (30d)</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: metrics.upcomingLabs > 10 ? '#dc2626' : '#059669', marginBottom: '0.25rem' }}>
                      {metrics.upcomingLabs}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Labs Due</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Predictive Insights */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
              🔮 Predictive Insights
            </h2>
            <div style={{ 
              display: 'grid', 
              gap: '1rem', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))'
            }}>
              {predictiveInsights.map((insight: any, index: number) => (
                <div
                  key={index}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '1rem',
                    background: '#ffffff',
                    border: insight.priority === 'high' ? '2px solid #ef4444' : 
                           insight.priority === 'medium' ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                      {insight.description}
                    </h3>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '999px',
                      backgroundColor: insight.priority === 'high' ? '#ef4444' : 
                                     insight.priority === 'medium' ? '#f59e0b' : '#10b981',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      fontWeight: 700
                    }}>
                      {insight.count}
                    </span>
                  </div>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
                    {insight.priority === 'high' ? '🚨 Requires immediate attention' :
                     insight.priority === 'medium' ? '⚠️ Should be addressed soon' :
                     '📋 Monitor and plan accordingly'}
                  </p>
                </div>
              ))}
            </div>
          </div>
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
            {activeView.charAt(0).toUpperCase() + activeView.slice(1)} Analytics
          </h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '1rem' }}>
            Detailed {activeView} analytics and trends will be built here next.
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











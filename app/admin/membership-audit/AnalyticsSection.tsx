"use client";

import type { PatientAnalyticsBreakdown } from '@/lib/patientAnalytics';

type Props = {
  analytics: PatientAnalyticsBreakdown;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

export default function AnalyticsSection({ analytics }: Props) {
  const total = analytics.totalPatients;
  const active = analytics.activePatients;

  return (
    <section
      style={{
        border: '1px solid rgba(148,163,184,0.3)',
        borderRadius: '1rem',
        padding: '1.5rem',
        background: '#ffffff',
        boxShadow: '0 10px 25px rgba(15,23,42,0.05)',
        marginBottom: '2rem'
      }}
    >
      <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.4rem', fontWeight: 600, color: '#0f172a' }}>
        📊 Patient Analytics Breakdown
      </h2>
      <p style={{ margin: '0 0 1.5rem', color: '#64748b', fontSize: '0.95rem' }}>
        Comprehensive breakdown of patients by service type, membership plans, and payment methods.
      </p>

      {/* Overall Summary */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          padding: '1rem',
          borderRadius: '0.75rem',
          background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
          border: '1px solid #0ea5e9'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Total Patients</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0369a1' }}>{total}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {active} active
          </div>
        </div>

        <div style={{
          padding: '1rem',
          borderRadius: '0.75rem',
          background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%)',
          border: '1px solid #3b82f6'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Primary Care</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1e40af' }}>{analytics.primaryCare}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {formatPercent(analytics.primaryCare, total)}
          </div>
        </div>

        <div style={{
          padding: '1rem',
          borderRadius: '0.75rem',
          background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
          border: '1px solid #f59e0b'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Men's Health</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#92400e' }}>{analytics.mensHealth}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {formatPercent(analytics.mensHealth, total)}
          </div>
        </div>

        <div style={{
          padding: '1rem',
          borderRadius: '0.75rem',
          background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
          border: '1px solid #a855f7'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Other Services</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c2d92' }}>{analytics.other}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {formatPercent(analytics.other, total)}
          </div>
        </div>
      </div>

      {/* By Client Type */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
          By Membership Type
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Membership Type</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Count</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Percentage</th>
                <th style={{
                  textAlign: 'left',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byClientType.map((row, idx) => (
                <tr key={row.clientTypeKey} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 500 }}>{row.clientTypeName}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                    {formatPercent(row.count, total)}
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    {row.isPrimaryCare ? (
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: '#dbeafe',
                        color: '#1e40af',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>Primary Care</span>
                    ) : row.clientTypeKey === 'mens_health_qbo' ? (
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: '#fef3c7',
                        color: '#92400e',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>Men's Health</span>
                    ) : (
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: '#f3e8ff',
                        color: '#7c2d92',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>Other</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* By Payment Method */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
          By Payment Method
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Payment Method</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Count</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Percentage</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byPaymentMethod.map((row) => (
                <tr key={row.paymentMethodKey} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 500 }}>{row.paymentMethodName}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                    {formatPercent(row.count, total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Combined Breakdown */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
          By Membership Type & Payment Method
        </h3>
        <div style={{ overflowX: 'auto', maxHeight: '500px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9', zIndex: 10 }}>
              <tr>
                <th style={{
                  textAlign: 'left',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Membership Type</th>
                <th style={{
                  textAlign: 'left',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Payment Method</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Count</th>
                <th style={{
                  textAlign: 'right',
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>Percentage</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byClientTypeAndPayment.map((row, idx) => (
                <tr key={`${row.clientTypeKey}-${row.paymentMethodKey}-${idx}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.75rem' }}>{row.clientTypeName}</td>
                  <td style={{ padding: '0.75rem' }}>{row.paymentMethodName}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                    {formatPercent(row.count, total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* By Membership Plan (from Jane) */}
      {analytics.byMembershipPlan.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
            By Jane Membership Plan
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{
                    textAlign: 'left',
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>Plan Name</th>
                  <th style={{
                    textAlign: 'right',
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>Active Patients</th>
                  <th style={{
                    textAlign: 'right',
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>Total Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byMembershipPlan.map((row, idx) => (
                  <tr key={`${row.planName}-${idx}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 500 }}>{row.planName}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'right',
                      color: row.totalOutstanding > 0 ? '#dc2626' : '#64748b',
                      fontWeight: row.totalOutstanding > 0 ? 600 : 400
                    }}>
                      {formatCurrency(row.totalOutstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}


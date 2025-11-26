'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type RevenueSummary = {
  totalRevenue: number;
  totalPayments: number;
  totalPurchased: number;
  outstandingBalance: number;
  totalPatients: number;
  averageRevenuePerPatient: number;
};

type DailyRevenue = {
  date: string;
  revenue: number;
  paymentCount: number;
  patientCount: number;
};

type WeeklyRevenue = {
  week: string;
  revenue: number;
  paymentCount: number;
  patientCount: number;
};

type MonthlyRevenue = {
  month: string;
  revenue: number;
  paymentCount: number;
  patientCount: number;
};

export default function JaneRevenuePage() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [daily, setDaily] = useState<DailyRevenue[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRevenue[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  useEffect(() => {
    fetchRevenueData();
    
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchRevenueData, 60000);
    return () => clearInterval(interval);
  }, [period]);

  async function fetchRevenueData() {
    try {
      setLoading(true);
      setError(null);

      // Fetch summary
      const summaryRes = await fetch('/api/jane-revenue?period=total');
      const summaryData = await summaryRes.json();
      if (summaryData.success) {
        setSummary(summaryData.data);
      }

      // Fetch time-based data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3); // Last 3 months

      const params = new URLSearchParams({
        period: period,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      });

      const timeRes = await fetch(`/api/jane-revenue?${params.toString()}`);
      const timeData = await timeRes.json();
      if (timeData.success) {
        if (period === 'daily') {
          setDaily(timeData.data);
        } else if (period === 'weekly') {
          setWeekly(timeData.data);
        } else {
          setMonthly(timeData.data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load revenue data');
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            💰 Jane Revenue Analytics
          </h1>
          <p style={{ color: '#666' }}>Real-time revenue tracking from ClinicSync Pro webhooks</p>
        </div>
        <Link 
          href="/ops" 
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#3b82f6',
            color: 'white',
            borderRadius: '0.5rem',
            textDecoration: 'none',
            fontWeight: '500'
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '0.5rem',
          marginBottom: '2rem',
          color: '#c33'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            padding: '1.5rem',
            backgroundColor: '#f0fdf4',
            border: '2px solid #86efac',
            borderRadius: '0.75rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ color: '#166534', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
              Total Lifetime Revenue
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#15803d' }}>
              {formatCurrency(summary.totalRevenue)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              From {summary.totalPatients} patients
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            backgroundColor: '#fef3c7',
            border: '2px solid #fcd34d',
            borderRadius: '0.75rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ color: '#92400e', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
              Average per Patient
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#b45309' }}>
              {formatCurrency(summary.averageRevenuePerPatient)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Based on active patients
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            backgroundColor: '#dbeafe',
            border: '2px solid #93c5fd',
            borderRadius: '0.75rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ color: '#1e40af', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
              Total Payments
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2563eb' }}>
              {formatCurrency(summary.totalPayments)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Payments received
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            backgroundColor: '#fce7f3',
            border: '2px solid #f9a8d4',
            borderRadius: '0.75rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ color: '#831843', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
              Outstanding Balance
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#be185d' }}>
              {formatCurrency(summary.outstandingBalance)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Amount owed
            </div>
          </div>
        </div>
      )}

      {/* Period Selector */}
      <div style={{
        marginBottom: '1.5rem',
        display: 'flex',
        gap: '0.5rem',
        borderBottom: '2px solid #e5e7eb',
        paddingBottom: '1rem'
      }}>
        <button
          onClick={() => setPeriod('daily')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderRadius: '0.5rem',
            backgroundColor: period === 'daily' ? '#3b82f6' : '#f3f4f6',
            color: period === 'daily' ? 'white' : '#374151',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Daily
        </button>
        <button
          onClick={() => setPeriod('weekly')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderRadius: '0.5rem',
            backgroundColor: period === 'weekly' ? '#3b82f6' : '#f3f4f6',
            color: period === 'weekly' ? 'white' : '#374151',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Weekly
        </button>
        <button
          onClick={() => setPeriod('monthly')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderRadius: '0.5rem',
            backgroundColor: period === 'monthly' ? '#3b82f6' : '#f3f4f6',
            color: period === 'monthly' ? 'white' : '#374151',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Monthly
        </button>
      </div>

      {/* Revenue Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
          Loading revenue data...
        </div>
      ) : (
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '0.75rem',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                  {period === 'daily' ? 'Date' : period === 'weekly' ? 'Week' : 'Month'}
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                  Revenue
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                  Payments
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                  Patients
                </th>
              </tr>
            </thead>
            <tbody>
              {(period === 'daily' ? daily : period === 'weekly' ? weekly : monthly).map((item, idx) => (
                <tr 
                  key={idx}
                  style={{
                    borderBottom: '1px solid #e5e7eb',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <td style={{ padding: '1rem', color: '#374151', fontWeight: '500' }}>
                    {period === 'daily' 
                      ? formatDate((item as DailyRevenue).date) 
                      : period === 'weekly' 
                        ? (item as WeeklyRevenue).week 
                        : (item as MonthlyRevenue).month}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', color: '#15803d', fontWeight: '600' }}>
                    {formatCurrency(item.revenue)}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', color: '#374151' }}>
                    {item.paymentCount || 0}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', color: '#374151' }}>
                    {item.patientCount || 0}
                  </td>
                </tr>
              ))}
              {((period === 'daily' ? daily : period === 'weekly' ? weekly : monthly).length === 0) && (
                <tr>
                  <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    No revenue data available for this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Total for displayed period */}
      {((period === 'daily' ? daily : period === 'weekly' ? weekly : monthly).length > 0) && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          backgroundColor: '#f0fdf4',
          border: '2px solid #86efac',
          borderRadius: '0.5rem',
          textAlign: 'right'
        }}>
          <strong style={{ color: '#15803d', fontSize: '1.25rem' }}>
            Period Total: {formatCurrency(
              (period === 'daily' ? daily : period === 'weekly' ? weekly : monthly)
                .reduce((sum, item) => sum + item.revenue, 0)
            )}
          </strong>
        </div>
      )}
    </div>
  );
}


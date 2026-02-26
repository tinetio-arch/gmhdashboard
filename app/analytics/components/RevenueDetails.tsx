'use client';

import { useState, useEffect } from 'react';

interface Transaction {
    id: string;
    date: string;
    source: string;
    amount: number;
    customer?: string;
    description?: string;
}

interface PeriodData {
    total: number;
    quickbooks: number;
    healthie: number;
    count: number;
}

interface RevenueData {
    periods: {
        day1: PeriodData;
        day7: PeriodData;
        day30: PeriodData;
    };
    daily: Array<{ date: string; quickbooks: number; healthie: number; total: number }>;
    recentTransactions: Transaction[];
}

const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export default function RevenueDetails() {
    const [data, setData] = useState<RevenueData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showTransactions, setShowTransactions] = useState(false);
    const [showDaily, setShowDaily] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch all three periods in parallel
            const [res1, res7, res30] = await Promise.all([
                fetch('/ops/api/analytics/revenue-details?days=1'),
                fetch('/ops/api/analytics/revenue-details?days=7'),
                fetch('/ops/api/analytics/revenue-details?days=30')
            ]);

            const [d1, d7, d30] = await Promise.all([
                res1.json(),
                res7.json(),
                res30.json()
            ]);

            if (d1.error || d7.error || d30.error) {
                throw new Error(d30.error || d7.error || d1.error);
            }

            setData({
                periods: {
                    day1: {
                        total: d1.summary?.total || 0,
                        quickbooks: d1.summary?.quickbooks?.total || 0,
                        healthie: d1.summary?.healthie?.total || 0,
                        count: d1.summary?.quickbooks?.count || 0
                    },
                    day7: {
                        total: d7.summary?.total || 0,
                        quickbooks: d7.summary?.quickbooks?.total || 0,
                        healthie: d7.summary?.healthie?.total || 0,
                        count: d7.summary?.quickbooks?.count || 0
                    },
                    day30: {
                        total: d30.summary?.total || 0,
                        quickbooks: d30.summary?.quickbooks?.total || 0,
                        healthie: d30.summary?.healthie?.total || 0,
                        count: d30.summary?.quickbooks?.count || 0
                    }
                },
                daily: d30.daily || [],
                recentTransactions: d30.recentTransactions || []
            });
            setError(null);
        } catch (e: any) {
            console.error('Failed to fetch revenue:', e);
            setError(e.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>💰</span>
                    <span style={{ color: '#64748b' }}>Loading revenue data...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
                <div style={{ color: '#ef4444', fontWeight: 500, marginBottom: '0.5rem' }}>
                    ❌ Revenue Error
                </div>
                <div style={{ color: '#7f1d1d', fontSize: '0.875rem', background: '#fef2f2', padding: '1rem', borderRadius: '8px' }}>
                    {error}
                </div>
                <button
                    onClick={fetchData}
                    style={{
                        marginTop: '1rem',
                        padding: '0.5rem 1rem',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                    }}
                >
                    🔄 Retry
                </button>
            </div>
        );
    }

    if (!data) return null;

    const { periods } = data;

    return (
        <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem'
            }}>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.25rem' }}>
                    💰 Revenue Command Center
                </h3>
                <button
                    onClick={fetchData}
                    style={{
                        padding: '0.5rem 1rem',
                        background: '#f1f5f9',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: '#475569',
                        fontSize: '0.875rem'
                    }}
                >
                    🔄 Refresh
                </button>
            </div>

            {/* Period Comparison Cards - 1d, 7d, 30d */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1rem',
                marginBottom: '1.5rem'
            }}>
                {/* Today */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                    borderRadius: '12px',
                    border: '1px solid #bbf7d0'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Today (1d)
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#15803d', marginTop: '0.5rem' }}>
                        {formatCurrency(periods.day1.total)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.25rem' }}>
                        {periods.day1.count} transactions
                    </div>
                </div>

                {/* 7 Days */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                    borderRadius: '12px',
                    border: '1px solid #93c5fd'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Last 7 Days
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1d4ed8', marginTop: '0.5rem' }}>
                        {formatCurrency(periods.day7.total)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#1e40af', marginTop: '0.25rem' }}>
                        {periods.day7.count} transactions
                    </div>
                </div>

                {/* 30 Days */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
                    borderRadius: '12px',
                    border: '1px solid #d8b4fe'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Last 30 Days
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#7c3aed', marginTop: '0.5rem' }}>
                        {formatCurrency(periods.day30.total)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b21a8', marginTop: '0.25rem' }}>
                        {periods.day30.count} transactions
                    </div>
                </div>
            </div>

            {/* Source Breakdown for 30 Days */}
            <div style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                marginBottom: '1rem'
            }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', marginBottom: '0.75rem' }}>
                    30-Day Revenue by Source
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {/* QuickBooks */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        background: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0'
                    }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>QuickBooks</div>
                            <div style={{ fontWeight: 600, color: '#0891b2' }}>{formatCurrency(periods.day30.quickbooks)}</div>
                        </div>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            background: '#e0f2fe',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.25rem'
                        }}>💳</div>
                    </div>

                    {/* Healthie */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        background: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0'
                    }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Healthie Billing</div>
                            <div style={{ fontWeight: 600, color: '#7c3aed' }}>{formatCurrency(periods.day30.healthie)}</div>
                        </div>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            background: '#f3e8ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.25rem'
                        }}>💊</div>
                    </div>
                </div>
            </div>

            {/* Daily Breakdown Toggle */}
            <button
                onClick={() => setShowDaily(!showDaily)}
                style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: '#475569',
                    marginBottom: '0.5rem'
                }}
            >
                <span>📊 Daily Breakdown</span>
                <span style={{ transform: showDaily ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    ▼
                </span>
            </button>

            {showDaily && data.daily.length > 0 && (
                <div style={{ marginBottom: '1rem', maxHeight: '250px', overflowY: 'auto' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto auto auto',
                        gap: '0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#64748b',
                        padding: '0.5rem',
                        borderBottom: '2px solid #e2e8f0'
                    }}>
                        <span>Date</span>
                        <span style={{ textAlign: 'right' }}>QuickBooks</span>
                        <span style={{ textAlign: 'right' }}>Healthie</span>
                        <span style={{ textAlign: 'right' }}>Total</span>
                    </div>
                    {data.daily.slice(0, 14).map(day => (
                        <div
                            key={day.date}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr auto auto auto',
                                gap: '0.5rem',
                                padding: '0.5rem',
                                borderBottom: '1px solid #f1f5f9',
                                fontSize: '0.875rem'
                            }}
                        >
                            <span style={{ color: '#64748b' }}>
                                {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                            <span style={{ textAlign: 'right', color: '#0891b2' }}>
                                {formatCurrency(day.quickbooks)}
                            </span>
                            <span style={{ textAlign: 'right', color: '#7c3aed' }}>
                                {formatCurrency(day.healthie)}
                            </span>
                            <span style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                                {formatCurrency(day.total)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Recent Transactions Toggle */}
            <button
                onClick={() => setShowTransactions(!showTransactions)}
                style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: '#475569'
                }}
            >
                <span>📋 Recent Transactions ({data.recentTransactions.length})</span>
                <span style={{ transform: showTransactions ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    ▼
                </span>
            </button>

            {/* Transactions List */}
            {showTransactions && (
                <div style={{ marginTop: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                    {data.recentTransactions.length === 0 ? (
                        <div style={{ padding: '1rem', color: '#64748b', textAlign: 'center' }}>
                            No transactions in this period
                        </div>
                    ) : (
                        data.recentTransactions.map(tx => (
                            <div
                                key={tx.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem',
                                    borderBottom: '1px solid #f1f5f9'
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                        {tx.customer || 'Payment'}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                        {new Date(tx.date).toLocaleDateString()} • {tx.source}
                                    </div>
                                </div>
                                <div style={{
                                    fontWeight: 600,
                                    color: '#059669',
                                    fontSize: '1.125rem'
                                }}>
                                    {formatCurrency(tx.amount)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Summary Footer */}
            <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                fontSize: '0.75rem',
                color: '#64748b'
            }}>
                <strong>Note:</strong> QuickBooks shows sales receipts. Healthie shows recurring subscription payments from cache.
                Data refreshes every 30 seconds.
            </div>
        </div>
    );
}

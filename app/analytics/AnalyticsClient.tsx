'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AlertsBar from './components/AlertsBar';
import RevenueDetails from './components/RevenueDetails';
import PatientPipeline from './components/PatientPipeline';
import SystemHealthGrid from './components/SystemHealthGrid';
import DEASummaryPanel from './components/DEASummaryPanel';
import PeptideFinancials from './components/PeptideFinancials';

interface AnalyticsData {
    timestamp: string;
    patients: {
        total: number;
        active: number;
        inactive: number;
        newThisWeek: number;
        newThisMonth: number;
    };
    integrations: {
        ghl: { synced: number; total: number; syncRate: number };
        healthie: { linked: number; total: number; linkRate: number };
    };
    financial: {
        totalReceipts: number;
        totalRevenue: number;
        revenue30d: number;
        revenue7d: number;
    };
    system: {
        services: Array<{
            name: string;
            status: string;
            cpu: number;
            memory: number;
            uptime: number;
            restarts: number;
        }>;
        disk: { used: string; free: string; percent: number };
        servicesOnline: number;
        servicesTotal: number;
        memory?: { used: number; total: number; percent: number };
        cpu?: { loadAvg: number; cores: number };
    };
    revenue?: {
        last7Days: number;
        last30Days: number;
        successRate: number;
        pendingPayments: number;
        healthie7d?: number;
        healthie30d?: number;
    };
    peptide?: {
        revenue_today: number;
        revenue_7d: number;
        revenue_30d: number;
        top_sellers: Array<{ name: string; quantity: number; revenue: number }>;
    };
}

export default function AnalyticsClient() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [activeView, setActiveView] = useState<'overview' | 'revenue' | 'patients' | 'system' | 'dea'>('overview');

    const fetchData = async () => {
        try {
            const res = await fetch('/ops/api/analytics/summary');
            if (!res.ok) throw new Error('Failed to fetch');
            const json = await res.json();
            setData(json);
            setLastUpdate(new Date().toLocaleTimeString());
            setError(null);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const formatCurrency = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

    if (loading) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem' }}>Loading Analytics...</div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div style={{ padding: '2rem' }}>
                <div style={{ color: '#ef4444', padding: '1rem', background: '#fef2f2', borderRadius: '8px' }}>
                    Error loading data: {error}
                </div>
            </div>
        );
    }

    const cardStyle = {
        background: '#fff',
        borderRadius: '12px',
        padding: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    };

    const statStyle = {
        fontSize: '2.5rem',
        fontWeight: 700,
        color: '#1e40af',
        marginBottom: '0.25rem',
    };

    const labelStyle = {
        fontSize: '0.875rem',
        color: '#64748b',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
    };

    const tabStyle = (isActive: boolean) => ({
        padding: '0.75rem 1.5rem',
        border: 'none',
        background: isActive ? '#3b82f6' : 'transparent',
        color: isActive ? 'white' : '#64748b',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '0.875rem',
        fontWeight: isActive ? 600 : 400,
        transition: 'all 0.2s',
    });

    return (
        <div style={{ padding: '2rem', backgroundColor: '#f1f5f9', minHeight: '100vh' }}>
            {/* Alerts Bar - Always visible at top */}
            <AlertsBar />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                        📊 CEO Dashboard
                    </h1>
                    <p style={{ color: '#64748b', marginTop: '0.5rem', marginBottom: 0 }}>
                        Real-time business health monitoring
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                        Last update: {lastUpdate}
                    </span>
                    <button
                        onClick={fetchData}
                        style={{
                            padding: '0.5rem 1rem',
                            background: '#3b82f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer'
                        }}
                    >
                        🔄 Refresh
                    </button>
                    <Link
                        href="/ops"
                        style={{
                            padding: '0.5rem 1rem',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            color: '#475569',
                            textDecoration: 'none'
                        }}
                    >
                        ← Dashboard
                    </Link>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1.5rem',
                background: 'white',
                padding: '0.5rem',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
                <button style={tabStyle(activeView === 'overview')} onClick={() => setActiveView('overview')}>
                    🏠 Overview
                </button>
                <button style={tabStyle(activeView === 'revenue')} onClick={() => setActiveView('revenue')}>
                    💰 Revenue
                </button>
                <button style={tabStyle(activeView === 'patients')} onClick={() => setActiveView('patients')}>
                    👥 Patients
                </button>
                <button style={tabStyle(activeView === 'system')} onClick={() => setActiveView('system')}>
                    🖥️ System
                </button>
                <button style={tabStyle(activeView === 'dea')} onClick={() => setActiveView('dea')}>
                    💊 DEA
                </button>
            </div>

            {/* OVERVIEW TAB */}
            {activeView === 'overview' && (
                <>
                    {/* Quick Stats Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={cardStyle}>
                            <div style={statStyle}>{data.patients.active}</div>
                            <div style={labelStyle}>Active Patients</div>
                        </div>
                        <div style={cardStyle}>
                            <div style={{ ...statStyle, color: '#059669' }}>+{data.patients.newThisWeek}</div>
                            <div style={labelStyle}>New This Week</div>
                        </div>
                        <div style={cardStyle}>
                            <div style={{ ...statStyle, color: '#0891b2' }}>
                                {formatCurrency(data.revenue?.last30Days || 0)}
                            </div>
                            <div style={labelStyle}>QuickBooks 30d</div>
                        </div>
                        <div style={cardStyle}>
                            <div style={{ ...statStyle, color: '#7c3aed' }}>
                                {formatCurrency(data.revenue?.healthie30d || 0)}
                            </div>
                            <div style={labelStyle}>Healthie 30d</div>
                        </div>
                    </div>

                    {/* Overview Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        {/* Mini Revenue Panel */}
                        <div style={cardStyle}>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#1e293b' }}>💰 Revenue Summary</h3>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                <span style={{ color: '#64748b' }}>QuickBooks (30d)</span>
                                <span style={{ fontWeight: 600, color: '#0891b2' }}>
                                    {formatCurrency(data.revenue?.last30Days || 0)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                <span style={{ color: '#64748b' }}>Healthie (30d)</span>
                                <span style={{ fontWeight: 600, color: '#7c3aed' }}>
                                    {formatCurrency(data.revenue?.healthie30d || 0)}
                                </span>
                            </div>
                            <div style={{
                                borderTop: '1px solid #e2e8f0',
                                paddingTop: '0.75rem',
                                display: 'flex',
                                justifyContent: 'space-between'
                            }}>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>Total</span>
                                <span style={{ fontWeight: 700, fontSize: '1.25rem', color: '#059669' }}>
                                    {formatCurrency((data.revenue?.last30Days || 0) + (data.revenue?.healthie30d || 0))}
                                </span>
                            </div>
                            <button
                                onClick={() => setActiveView('revenue')}
                                style={{
                                    marginTop: '1rem',
                                    width: '100%',
                                    padding: '0.5rem',
                                    background: '#f1f5f9',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    color: '#3b82f6',
                                    fontWeight: 500
                                }}
                            >
                                View Details →
                            </button>
                        </div>

                        {/* Mini Patient Panel */}
                        <div style={cardStyle}>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#1e293b' }}>👥 Patient Summary</h3>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                <span style={{ color: '#64748b' }}>Active</span>
                                <span style={{ fontWeight: 600, color: '#22c55e' }}>{data.patients.active}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                <span style={{ color: '#64748b' }}>Total</span>
                                <span style={{ fontWeight: 600 }}>{data.patients.total}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                <span style={{ color: '#64748b' }}>New This Week</span>
                                <span style={{ fontWeight: 600, color: '#22c55e' }}>+{data.patients.newThisWeek}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#64748b' }}>New This Month</span>
                                <span style={{ fontWeight: 600, color: '#3b82f6' }}>+{data.patients.newThisMonth}</span>
                            </div>
                            <button
                                onClick={() => setActiveView('patients')}
                                style={{
                                    marginTop: '1rem',
                                    width: '100%',
                                    padding: '0.5rem',
                                    background: '#f1f5f9',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    color: '#3b82f6',
                                    fontWeight: 500
                                }}
                            >
                                View Pipeline →
                            </button>
                        </div>
                    </div>

                    {/* Services Status */}
                    <div style={{ ...cardStyle, marginTop: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0, color: '#1e293b' }}>⚙️ Services</h3>
                            <span style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '999px',
                                fontSize: '0.875rem',
                                background: data.system.servicesOnline === data.system.servicesTotal ? '#dcfce7' : '#fef2f2',
                                color: data.system.servicesOnline === data.system.servicesTotal ? '#166534' : '#991b1b',
                            }}>
                                {data.system.servicesOnline}/{data.system.servicesTotal} Online
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {data.system.services.map((s, i) => (
                                <span
                                    key={i}
                                    style={{
                                        padding: '0.375rem 0.75rem',
                                        borderRadius: '6px',
                                        fontSize: '0.75rem',
                                        background: s.status === 'online' ? '#dcfce7' : '#fef2f2',
                                        color: s.status === 'online' ? '#166534' : '#991b1b',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.25rem'
                                    }}
                                >
                                    <span style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: s.status === 'online' ? '#22c55e' : '#ef4444'
                                    }} />
                                    {s.name}
                                </span>
                            ))}
                        </div>
                        <button
                            onClick={() => setActiveView('system')}
                            style={{
                                marginTop: '1rem',
                                padding: '0.5rem 1rem',
                                background: '#f1f5f9',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: '#3b82f6',
                                fontWeight: 500
                            }}
                        >
                            View System Health →
                        </button>
                    </div>
                </>
            )}

            {/* REVENUE TAB */}
            {activeView === 'revenue' && (
                <>
                    {data.peptide && <PeptideFinancials data={data.peptide} />}
                    <RevenueDetails />
                </>
            )}

            {/* PATIENTS TAB */}
            {activeView === 'patients' && (
                <PatientPipeline />
            )}

            {/* SYSTEM TAB */}
            {activeView === 'system' && (
                <SystemHealthGrid />
            )}

            {/* DEA TAB */}
            {activeView === 'dea' && (
                <DEASummaryPanel />
            )}
        </div>
    );
}

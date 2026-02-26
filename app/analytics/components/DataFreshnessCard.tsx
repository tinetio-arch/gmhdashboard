'use client';

import { useState, useEffect } from 'react';

interface TableFreshness {
    table_name: string;
    schema_name: string;
    record_count: number;
    last_updated: string | null;
    hours_since_update: number;
    status: 'fresh' | 'stale' | 'critical' | 'unknown';
    message: string;
}

interface DataFreshnessData {
    status: 'healthy' | 'warning' | 'critical';
    tables: TableFreshness[];
    message: string;
    timestamp: string;
}

export default function DataFreshnessCard() {
    const [data, setData] = useState<DataFreshnessData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const res = await fetch('/ops/api/analytics/data-freshness');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData(json);
            setError(null);
        } catch (e: any) {
            setError(e.message);
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
                <div style={{ color: '#64748b' }}>Loading data freshness...</div>
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
                <div style={{ color: '#ef4444', fontWeight: 500 }}>
                    ❌ Data Freshness Error: {error}
                </div>
            </div>
        );
    }

    if (!data) return null;

    const statusColors = {
        healthy: { bg: '#dcfce7', text: '#166534', icon: '✅' },
        warning: { bg: '#fef3c7', text: '#92400e', icon: '⚠️' },
        critical: { bg: '#fecaca', text: '#991b1b', icon: '🚨' }
    };

    const tableStatusColors = {
        fresh: { bg: '#dcfce7', text: '#166534' },
        stale: { bg: '#fef3c7', text: '#92400e' },
        critical: { bg: '#fecaca', text: '#991b1b' },
        unknown: { bg: '#e2e8f0', text: '#64748b' }
    };

    const colors = statusColors[data.status];

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
                marginBottom: '1rem'
            }}>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.25rem' }}>
                    🗄️ Data Freshness (Snowflake)
                </h3>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    borderRadius: '999px',
                    background: colors.bg,
                    color: colors.text,
                    fontSize: '0.875rem',
                    fontWeight: 500
                }}>
                    <span>{colors.icon}</span>
                    {data.message}
                </div>
            </div>

            {/* Tables Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '0.75rem'
            }}>
                {data.tables.map(table => {
                    const tColors = tableStatusColors[table.status];
                    return (
                        <div
                            key={table.table_name}
                            style={{
                                padding: '1rem',
                                borderRadius: '8px',
                                background: '#f8fafc',
                                borderLeft: `4px solid ${tColors.text}`
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start'
                            }}>
                                <div>
                                    <div style={{
                                        fontWeight: 600,
                                        color: '#1e293b',
                                        fontSize: '0.9rem'
                                    }}>
                                        {table.table_name}
                                    </div>
                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: '#64748b',
                                        marginTop: '0.25rem'
                                    }}>
                                        {table.record_count.toLocaleString()} records
                                    </div>
                                </div>
                                <div style={{
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '6px',
                                    background: tColors.bg,
                                    color: tColors.text,
                                    fontSize: '0.7rem',
                                    fontWeight: 600
                                }}>
                                    {table.hours_since_update < 1
                                        ? 'Just now'
                                        : `${table.hours_since_update}h ago`}
                                </div>
                            </div>
                            {table.status !== 'fresh' && (
                                <div style={{
                                    marginTop: '0.5rem',
                                    fontSize: '0.75rem',
                                    color: tColors.text
                                }}>
                                    {table.message}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Last Checked */}
            <div style={{
                marginTop: '1rem',
                fontSize: '0.75rem',
                color: '#94a3b8',
                textAlign: 'right'
            }}>
                Last checked: {new Date(data.timestamp).toLocaleTimeString()}
            </div>
        </div>
    );
}

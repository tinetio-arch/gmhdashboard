'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DEAData {
    timestamp: string;
    inventory: {
        byDrug: Array<{ drugName: string; activeVials: number; remainingMl: number }>;
        totalVials: number;
        totalRemainingMl: number;
    };
    dispensing: {
        volume7d: number;
        volume30d: number;
        count7d: number;
        count30d: number;
        dailyAverage: number;
    };
    reorder: {
        daysRemaining: number;
        status: 'ok' | 'warning' | 'critical';
        threshold: number;
    };
    compliance: {
        unsignedDispenses: number;
        morningCheck: { completed: boolean; checkedAt: string | null; checkedBy: string | null };
        eodCheck: { completed: boolean; checkedAt: string | null; checkedBy: string | null };
    };
}

export default function DEASummaryPanel() {
    const [data, setData] = useState<DEAData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch('/ops/api/analytics/dea-summary');
                if (!res.ok) throw new Error('Failed to fetch DEA data');
                const json = await res.json();
                setData(json);
                setError(null);
            } catch (e) {
                setError(String(e));
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading DEA data...</div>;
    }

    if (error || !data) {
        return (
            <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px', color: '#b91c1c' }}>
                Error loading DEA data: {error}
            </div>
        );
    }

    const reorderColors = {
        ok: { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
        warning: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
        critical: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' }
    };

    const reorderStyle = reorderColors[data.reorder.status];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Reorder Alert Banner */}
            {data.reorder.status !== 'ok' && (
                <div style={{
                    padding: '1rem 1.5rem',
                    borderRadius: '0.75rem',
                    background: reorderStyle.bg,
                    border: `2px solid ${reorderStyle.border}`,
                    color: reorderStyle.text,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <span style={{ fontSize: '1.5rem' }}>{data.reorder.status === 'critical' ? '🚨' : '⚠️'}</span>
                    <div>
                        <strong>
                            {data.reorder.status === 'critical' ? 'CRITICAL: ' : 'Warning: '}
                            {data.reorder.daysRemaining} days of testosterone remaining
                        </strong>
                        <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                            Based on 30-day average usage of {data.dispensing.dailyAverage} mL/day
                        </div>
                    </div>
                </div>
            )}

            {/* Inventory Section */}
            <div>
                <h3 style={sectionTitleStyle}>📦 Inventory At-A-Glance</h3>
                <div style={cardGridStyle}>
                    <MetricCard
                        label="Total Testosterone"
                        value={`${data.inventory.totalRemainingMl.toFixed(1)} mL`}
                        hint={`${data.inventory.totalVials} active vials`}
                    />
                    <MetricCard
                        label="Days Until Reorder"
                        value={data.reorder.daysRemaining > 100 ? '100+' : `${data.reorder.daysRemaining} days`}
                        hint={`@ ${data.dispensing.dailyAverage} mL/day avg`}
                        status={data.reorder.status}
                    />
                    {data.inventory.byDrug.slice(0, 2).map((drug, i) => (
                        <MetricCard
                            key={i}
                            label={drug.drugName}
                            value={`${drug.remainingMl.toFixed(1)} mL`}
                            hint={`${drug.activeVials} vials`}
                        />
                    ))}
                </div>
            </div>

            {/* Dispensing Section */}
            <div>
                <h3 style={sectionTitleStyle}>💉 Dispensing Metrics</h3>
                <div style={cardGridStyle}>
                    <MetricCard
                        label="Last 7 Days"
                        value={`${data.dispensing.volume7d.toFixed(1)} mL`}
                        hint={`${data.dispensing.count7d} dispenses`}
                    />
                    <MetricCard
                        label="Last 30 Days"
                        value={`${data.dispensing.volume30d.toFixed(1)} mL`}
                        hint={`${data.dispensing.count30d} dispenses`}
                    />
                    <MetricCard
                        label="Daily Average"
                        value={`${data.dispensing.dailyAverage} mL`}
                        hint="30-day rolling"
                    />
                </div>
            </div>

            {/* Compliance Section */}
            <div>
                <h3 style={sectionTitleStyle}>✅ Compliance Status</h3>
                <div style={cardGridStyle}>
                    <MetricCard
                        label="Morning Check"
                        value={data.compliance.morningCheck.completed ? '✓ Completed' : '✗ Missing'}
                        hint={data.compliance.morningCheck.checkedBy || 'Not done today'}
                        status={data.compliance.morningCheck.completed ? 'ok' : 'critical'}
                    />
                    <MetricCard
                        label="EOD Check"
                        value={data.compliance.eodCheck.completed ? '✓ Completed' : 'Pending'}
                        hint={data.compliance.eodCheck.checkedBy || 'Not done today'}
                        status={data.compliance.eodCheck.completed ? 'ok' : 'warning'}
                    />
                    <MetricCard
                        label="Unsigned Dispenses"
                        value={data.compliance.unsignedDispenses.toString()}
                        hint="Awaiting provider signature"
                        status={data.compliance.unsignedDispenses > 5 ? 'warning' : 'ok'}
                    />
                </div>
            </div>

            {/* Quick Actions */}
            <div>
                <h3 style={sectionTitleStyle}>🔗 Quick Actions</h3>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <QuickLink href="/ops/dea/" label="View Full DEA Log" />
                    <QuickLink href="/ops/inventory/" label="Manage Inventory" />
                    <QuickLink href="/ops/provider/signatures/" label="Provider Signatures" />
                    <QuickLink href="/ops/transactions/" label="Transaction History" />
                </div>
            </div>
        </div>
    );
}

function MetricCard({
    label,
    value,
    hint,
    status
}: {
    label: string;
    value: string;
    hint?: string;
    status?: 'ok' | 'warning' | 'critical';
}) {
    const statusColors = {
        ok: '#059669',
        warning: '#d97706',
        critical: '#dc2626'
    };

    return (
        <div style={{
            padding: '1rem 1.25rem',
            borderRadius: '0.75rem',
            background: '#ffffff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
            minWidth: '180px'
        }}>
            <div style={{
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#64748b',
                marginBottom: '0.25rem'
            }}>
                {label}
            </div>
            <div style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: status ? statusColors[status] : '#0f172a'
            }}>
                {value}
            </div>
            {hint && (
                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                    {hint}
                </div>
            )}
        </div>
    );
}

function QuickLink({ href, label }: { href: string; label: string }) {
    return (
        <Link
            href={href}
            style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '0.5rem',
                background: '#f1f5f9',
                color: '#0f172a',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                border: '1px solid #e2e8f0',
                transition: 'background 0.2s'
            }}
        >
            {label}
        </Link>
    );
}

const sectionTitleStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#475569',
    margin: '0 0 0.75rem 0'
};

const cardGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '1rem'
};

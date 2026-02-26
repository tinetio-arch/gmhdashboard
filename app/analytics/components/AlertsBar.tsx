'use client';

import { useState, useEffect, useCallback } from 'react';

interface Alert {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: string;
    title: string;
    message: string;
    timestamp: string;
    actionUrl?: string;
    actionLabel?: string;
}

interface AlertsData {
    totalAlerts: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    alerts: Alert[];
}

export default function AlertsBar() {
    const [data, setData] = useState<AlertsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

    const fetchAlerts = useCallback(async () => {
        try {
            const res = await fetch('/ops/api/analytics/alerts');
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (e) {
            console.error('Failed to fetch alerts:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, [fetchAlerts]);

    const dismissAlert = (id: string) => {
        setDismissedIds(prev => new Set([...prev, id]));
    };

    if (loading) return null;
    if (!data || data.totalAlerts === 0) return null;

    const activeAlerts = data.alerts.filter(a => !dismissedIds.has(a.id));
    if (activeAlerts.length === 0) return null;

    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
    const warningAlerts = activeAlerts.filter(a => a.severity === 'warning');
    const infoAlerts = activeAlerts.filter(a => a.severity === 'info');

    const severityColors = {
        critical: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', icon: '🔴' },
        warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e', icon: '🟡' },
        info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', icon: '🔵' }
    };

    const topSeverity = criticalAlerts.length > 0 ? 'critical' : warningAlerts.length > 0 ? 'warning' : 'info';
    const colors = severityColors[topSeverity];

    return (
        <div style={{
            backgroundColor: colors.bg,
            border: `2px solid ${colors.border}`,
            borderRadius: '12px',
            marginBottom: '1.5rem',
            overflow: 'hidden'
        }}>
            {/* Summary Bar */}
            <div
                onClick={() => setExpanded(!expanded)}
                style={{
                    padding: '1rem 1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(0,0,0,0.02)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>{colors.icon}</span>
                    <div>
                        <div style={{ fontWeight: 600, color: colors.text }}>
                            {activeAlerts.length} Active Alert{activeAlerts.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                            {criticalAlerts.length > 0 && `${criticalAlerts.length} critical `}
                            {warningAlerts.length > 0 && `${warningAlerts.length} warning `}
                            {infoAlerts.length > 0 && `${infoAlerts.length} info`}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); fetchAlerts(); }}
                        style={{
                            padding: '0.5rem 1rem',
                            background: 'white',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.875rem'
                        }}
                    >
                        🔄 Refresh
                    </button>
                    <span style={{ fontSize: '1.25rem', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        ▼
                    </span>
                </div>
            </div>

            {/* Expanded Alert List */}
            {expanded && (
                <div style={{ padding: '0 1.5rem 1.5rem' }}>
                    {activeAlerts.map(alert => {
                        const alertColors = severityColors[alert.severity];
                        return (
                            <div
                                key={alert.id}
                                style={{
                                    padding: '1rem',
                                    marginTop: '0.75rem',
                                    background: 'white',
                                    borderRadius: '8px',
                                    borderLeft: `4px solid ${alertColors.border}`,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start'
                                }}
                            >
                                <div>
                                    <div style={{
                                        fontWeight: 600,
                                        color: alertColors.text,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}>
                                        {alertColors.icon} {alert.title}
                                    </div>
                                    <div style={{ color: '#475569', marginTop: '0.25rem', fontSize: '0.875rem' }}>
                                        {alert.message}
                                    </div>
                                    <div style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                                        {alert.category.toUpperCase()} • {new Date(alert.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {alert.actionUrl && (
                                        <a
                                            href={alert.actionUrl}
                                            style={{
                                                padding: '0.375rem 0.75rem',
                                                background: alertColors.border,
                                                color: 'white',
                                                borderRadius: '6px',
                                                textDecoration: 'none',
                                                fontSize: '0.75rem',
                                                fontWeight: 500
                                            }}
                                        >
                                            {alert.actionLabel || 'View'}
                                        </a>
                                    )}
                                    <button
                                        onClick={() => dismissAlert(alert.id)}
                                        style={{
                                            padding: '0.375rem 0.75rem',
                                            background: '#f1f5f9',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.75rem'
                                        }}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

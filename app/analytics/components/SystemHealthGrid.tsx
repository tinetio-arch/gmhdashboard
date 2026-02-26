'use client';

import { useState, useEffect } from 'react';

interface Process {
    name: string;
    status: string;
    cpu: number;
    memoryMB: number;
    restarts: number;
    uptime: string;
}

interface ApiHealth {
    name: string;
    status: string;
    responseTime?: number;
    lastCheck: string;
    message?: string;
}

interface CronJob {
    name: string;
    schedule?: string;
    lastRun: string | null;
    hoursAgo: number;
    status: string;
}

interface SystemHealthData {
    processes: Process[];
    apiHealth: ApiHealth[];
    cronJobs: CronJob[];
    resources: {
        memory: { used: number; total: number; percent: number };
        cpu: { loadAvg: number[]; cores: number; percent?: number };
        disk: { used: number; free: number; total: number; percent: number };
        uptime: string;
    };
    recentErrors: Array<{ process: string; message: string; timestamp: string }>;
    alerts: Array<{ level: string; message: string }>;
    webhookHealth?: {
        status: 'healthy' | 'warning' | 'error';
        lastReceived: string | null;
        hoursAgo: number;
        pending: number;
        recentProcessed: number;
        recentErrors: number;
        message: string;
    };
}

export default function SystemHealthGrid() {
    const [data, setData] = useState<SystemHealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'services' | 'api' | 'cron'>('services');

    useEffect(() => {
        fetchHealth();
        const interval = setInterval(fetchHealth, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchHealth = async () => {
        try {
            const res = await fetch('/ops/api/analytics/system-health');
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
            }
            const json = await res.json();
            if (json.error) {
                throw new Error(json.error);
            }
            setData(json);
            setError(null);
        } catch (e: any) {
            console.error('Failed to fetch system health:', e);
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
                <div style={{ color: '#64748b' }}>Loading system health...</div>
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
                    ❌ System Health Error
                </div>
                <div style={{ color: '#7f1d1d', fontSize: '0.875rem', background: '#fef2f2', padding: '1rem', borderRadius: '8px' }}>
                    {error}
                </div>
                <button
                    onClick={fetchHealth}
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

    const onlineServices = data.processes?.filter(p => p.status === 'online').length || 0;
    const totalServices = data.processes?.length || 0;
    const allHealthy = onlineServices === totalServices;

    // Format disk space - handle both number (GB) and string formats
    const formatDiskSpace = (val: number | string): string => {
        if (typeof val === 'number') return `${val}GB`;
        return String(val);
    };

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
                    🖥️ System Health
                </h3>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    borderRadius: '999px',
                    background: allHealthy ? '#dcfce7' : '#fef2f2',
                    color: allHealthy ? '#166534' : '#991b1b',
                    fontSize: '0.875rem',
                    fontWeight: 500
                }}>
                    <span style={{ fontSize: '1.25rem' }}>{allHealthy ? '✅' : '⚠️'}</span>
                    {onlineServices}/{totalServices} Services Online
                </div>
            </div>

            {/* Alerts */}
            {data.alerts && data.alerts.length > 0 && (
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem',
                    background: data.alerts.some(a => a.level === 'critical') ? '#fef2f2' : '#fffbeb',
                    borderRadius: '8px',
                    borderLeft: `4px solid ${data.alerts.some(a => a.level === 'critical') ? '#ef4444' : '#f59e0b'}`
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#1e293b' }}>
                        ⚠️ Active Alerts ({data.alerts.length})
                    </div>
                    {data.alerts.slice(0, 5).map((alert, i) => (
                        <div key={i} style={{
                            fontSize: '0.875rem',
                            color: alert.level === 'critical' ? '#991b1b' : '#92400e',
                            marginBottom: '0.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: alert.level === 'critical' ? '#ef4444' : '#f59e0b'
                            }} />
                            {alert.message}
                        </div>
                    ))}
                </div>
            )}

            {/* Resource Gauges */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '1rem',
                marginBottom: '1.5rem'
            }}>
                {/* Memory */}
                <div style={{ textAlign: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        color: (data.resources?.memory?.percent || 0) > 80 ? '#ef4444' : '#22c55e'
                    }}>
                        {data.resources?.memory?.percent || 0}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Memory</div>
                    <div style={{ fontSize: '0.625rem', color: '#94a3b8' }}>
                        {data.resources?.memory?.used || 0}MB / {data.resources?.memory?.total || 0}MB
                    </div>
                </div>

                {/* CPU */}
                <div style={{ textAlign: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        color: (data.resources?.cpu?.loadAvg?.[0] || 0) > (data.resources?.cpu?.cores || 2) ? '#ef4444' : '#22c55e'
                    }}>
                        {data.resources?.cpu?.loadAvg?.[0]?.toFixed(2) || '0.00'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>CPU Load (1m)</div>
                    <div style={{ fontSize: '0.625rem', color: '#94a3b8' }}>
                        {data.resources?.cpu?.cores || 0} cores
                    </div>
                </div>

                {/* Disk */}
                <div style={{ textAlign: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        color: (data.resources?.disk?.percent || 0) > 80 ? '#ef4444' : '#22c55e'
                    }}>
                        {data.resources?.disk?.percent || 0}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Disk</div>
                    <div style={{ fontSize: '0.625rem', color: '#94a3b8' }}>
                        {formatDiskSpace(data.resources?.disk?.free || 0)} free
                    </div>
                </div>

                {/* Uptime */}
                <div style={{ textAlign: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#3b82f6' }}>
                        {data.resources?.uptime || 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>System Uptime</div>
                </div>
            </div>

            {/* Webhook Health Card */}
            {data.webhookHealth && (
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem',
                    background: data.webhookHealth.status === 'error' ? '#fef2f2' :
                        data.webhookHealth.status === 'warning' ? '#fffbeb' : '#f0fdf4',
                    borderRadius: '8px',
                    borderLeft: `4px solid ${data.webhookHealth.status === 'error' ? '#ef4444' :
                        data.webhookHealth.status === 'warning' ? '#f59e0b' : '#22c55e'}`
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                🔔 Healthie Webhooks
                                <span style={{
                                    fontSize: '0.75rem',
                                    padding: '0.125rem 0.5rem',
                                    borderRadius: '999px',
                                    background: data.webhookHealth.status === 'healthy' ? '#dcfce7' :
                                        data.webhookHealth.status === 'warning' ? '#fef3c7' : '#fecaca',
                                    color: data.webhookHealth.status === 'healthy' ? '#166534' :
                                        data.webhookHealth.status === 'warning' ? '#92400e' : '#991b1b'
                                }}>
                                    {data.webhookHealth.status}
                                </span>
                            </div>
                            <div style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
                                {data.webhookHealth.message}
                            </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#64748b' }}>
                            {data.webhookHealth.lastReceived && (
                                <div>Last: {new Date(data.webhookHealth.lastReceived).toLocaleString()}</div>
                            )}
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                                <span>📥 {data.webhookHealth.pending} pending</span>
                                <span>✅ {data.webhookHealth.recentProcessed} processed (24h)</span>
                                {data.webhookHealth.recentErrors > 0 && (
                                    <span style={{ color: '#ef4444' }}>❌ {data.webhookHealth.recentErrors} errors</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tab Navigation */}
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1rem',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '0.5rem'
            }}>
                {(['services', 'api', 'cron'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '0.5rem 1rem',
                            border: 'none',
                            background: activeTab === tab ? '#3b82f6' : 'transparent',
                            color: activeTab === tab ? 'white' : '#64748b',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: activeTab === tab ? 600 : 400
                        }}
                    >
                        {tab === 'services' ? `⚙️ Services (${totalServices})` :
                            tab === 'api' ? `🔗 APIs (${data.apiHealth?.length || 0})` :
                                `⏰ Cron (${data.cronJobs?.length || 0})`}
                    </button>
                ))}
            </div>

            {/* Services Tab */}
            {activeTab === 'services' && (
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {data.processes?.map(proc => (
                        <div
                            key={proc.name}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem',
                                borderBottom: '1px solid #f1f5f9',
                                background: proc.status !== 'online' ? '#fef2f2' : 'transparent'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: proc.status === 'online' ? '#22c55e' : '#ef4444'
                                }} />
                                <div>
                                    <div style={{ fontWeight: 500, color: '#1e293b' }}>{proc.name}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                        {proc.status} • {proc.uptime}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
                                <span>CPU: {proc.cpu}%</span>
                                <span>RAM: {proc.memoryMB}MB</span>
                                {proc.restarts > 0 && (
                                    <span style={{ color: proc.restarts > 10 ? '#ef4444' : proc.restarts > 5 ? '#f59e0b' : '#64748b' }}>
                                        ↻ {proc.restarts}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* API Tab */}
            {activeTab === 'api' && (
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {data.apiHealth?.map(api => (
                        <div
                            key={api.name}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem',
                                borderBottom: '1px solid #f1f5f9',
                                background: api.status === 'error' ? '#fef2f2' : api.status === 'warning' ? '#fffbeb' : 'transparent'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: api.status === 'healthy' ? '#22c55e' : api.status === 'warning' ? '#f59e0b' : '#ef4444'
                                }} />
                                <div>
                                    <div style={{ fontWeight: 500, color: '#1e293b' }}>{api.name}</div>
                                    <div style={{ fontSize: '0.75rem', color: api.status === 'error' ? '#991b1b' : '#64748b' }}>
                                        {api.message || api.status}
                                    </div>
                                </div>
                            </div>
                            {api.responseTime !== undefined && api.responseTime > 0 && (
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: api.responseTime > 1000 ? '#f59e0b' : '#64748b'
                                }}>
                                    {api.responseTime}ms
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Cron Tab */}
            {activeTab === 'cron' && (
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {data.cronJobs?.map(job => (
                        <div
                            key={job.name}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem',
                                borderBottom: '1px solid #f1f5f9',
                                background: job.status === 'error' ? '#fef2f2' : job.status === 'warning' ? '#fffbeb' : 'transparent'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: job.status === 'success' ? '#22c55e' : job.status === 'warning' ? '#f59e0b' : job.status === 'error' ? '#ef4444' : '#94a3b8'
                                }} />
                                <div>
                                    <div style={{ fontWeight: 500, color: '#1e293b' }}>{job.name}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                        {job.schedule || 'Manual'} • {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never run'}
                                    </div>
                                </div>
                            </div>
                            <div style={{
                                fontSize: '0.75rem',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '999px',
                                background: job.hoursAgo > 24 ? '#fef2f2' : job.hoursAgo > 12 ? '#fffbeb' : '#f0fdf4',
                                color: job.hoursAgo > 24 ? '#991b1b' : job.hoursAgo > 12 ? '#92400e' : '#166534'
                            }}>
                                {job.hoursAgo >= 0 ? `${job.hoursAgo.toFixed(1)}h ago` : 'Unknown'}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Recent Errors */}
            {data.recentErrors && data.recentErrors.length > 0 && (
                <div style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: '#fef2f2',
                    borderRadius: '8px',
                    borderLeft: '4px solid #ef4444'
                }}>
                    <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '0.5rem' }}>
                        📛 Recent Errors ({data.recentErrors.length})
                    </div>
                    {data.recentErrors.slice(0, 5).map((err, i) => (
                        <div key={i} style={{ fontSize: '0.75rem', color: '#7f1d1d', marginBottom: '0.25rem', fontFamily: 'monospace' }}>
                            {err.message.slice(0, 150)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

'use client';

import { useState, useEffect } from 'react';

interface Patient {
    id: string;
    name: string;
    status: string;
    dateAdded: string;
    clientType: string;
}

interface PipelineStage {
    stage: string;
    count: number;
    percentOfTotal: number;
    change7d: number;
    patients?: Patient[];
}

interface PipelineData {
    summary: {
        total: number;
        active: number;
        hold: number;
        inactive: number;
        newThisWeek: number;
        newThisMonth: number;
    };
    pipeline: PipelineStage[];
    holdBreakdown: Array<{ status: string; count: number }>;
    metrics: {
        retentionRate: string;
        holdRate: string;
        weeklyGrowth: string;
    };
}

const stageColors: Record<string, string> = {
    'new': '#22c55e',
    'active': '#3b82f6',
    'hold': '#f59e0b',
    'inactive': '#94a3b8'
};

export default function PatientPipeline() {
    const [data, setData] = useState<PipelineData | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedStage, setSelectedStage] = useState<string | null>(null);
    const [patients, setPatients] = useState<Patient[]>([]);
    const [loadingPatients, setLoadingPatients] = useState(false);

    useEffect(() => {
        fetchPipeline();
    }, []);

    const fetchPipeline = async () => {
        try {
            const res = await fetch('/ops/api/analytics/patient-pipeline');
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (e) {
            console.error('Failed to fetch pipeline:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchPatients = async (stage: string) => {
        if (selectedStage === stage) {
            setSelectedStage(null);
            setPatients([]);
            return;
        }

        setSelectedStage(stage);
        setLoadingPatients(true);
        try {
            const res = await fetch(`/ops/api/analytics/patient-pipeline?includePatients=true&stage=${stage}`);
            if (res.ok) {
                const json = await res.json();
                const stageData = json.pipeline.find((p: PipelineStage) =>
                    p.stage.toLowerCase().includes(stage.toLowerCase())
                );
                setPatients(stageData?.patients || []);
            }
        } catch (e) {
            console.error('Failed to fetch patients:', e);
        } finally {
            setLoadingPatients(false);
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
                <div style={{ color: '#64748b' }}>Loading patient pipeline...</div>
            </div>
        );
    }

    if (!data) return null;

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
                    👥 Patient Pipeline
                </h3>
                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    fontSize: '0.875rem'
                }}>
                    <span style={{ color: '#22c55e' }}>
                        +{data.summary.newThisWeek} this week
                    </span>
                    <span style={{ color: '#64748b' }}>
                        {data.summary.total} total
                    </span>
                </div>
            </div>

            {/* Funnel Visualization */}
            <div style={{ marginBottom: '1.5rem' }}>
                {data.pipeline.map((stage, idx) => {
                    const stageKey = stage.stage.toLowerCase().split(' ')[0];
                    const color = stageColors[stageKey] || '#64748b';
                    const maxWidth = 100; // percentage
                    const width = Math.max(20, stage.percentOfTotal * 1.5); // Min 20% width
                    const isSelected = selectedStage?.toLowerCase().includes(stageKey);

                    return (
                        <div
                            key={stage.stage}
                            onClick={() => fetchPatients(stageKey)}
                            style={{
                                marginBottom: '0.75rem',
                                cursor: 'pointer',
                                transition: 'transform 0.2s'
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '0.25rem'
                            }}>
                                <span style={{
                                    fontSize: '0.875rem',
                                    color: '#475569',
                                    fontWeight: isSelected ? 600 : 400
                                }}>
                                    {stage.stage}
                                </span>
                                <span style={{
                                    fontSize: '1.125rem',
                                    fontWeight: 600,
                                    color: color
                                }}>
                                    {stage.count}
                                    {stage.change7d !== 0 && (
                                        <span style={{
                                            fontSize: '0.75rem',
                                            marginLeft: '0.5rem',
                                            color: stage.change7d > 0 ? '#22c55e' : '#ef4444'
                                        }}>
                                            {stage.change7d > 0 ? '+' : ''}{stage.change7d}
                                        </span>
                                    )}
                                </span>
                            </div>
                            <div style={{
                                height: '12px',
                                borderRadius: '6px',
                                background: '#f1f5f9',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: `${width}%`,
                                    height: '100%',
                                    background: color,
                                    borderRadius: '6px',
                                    transition: 'width 0.3s'
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Expanded Patient List */}
            {selectedStage && (
                <div style={{
                    marginBottom: '1.5rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    padding: '1rem'
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.75rem'
                    }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>
                            {selectedStage.charAt(0).toUpperCase() + selectedStage.slice(1)} Patients
                        </span>
                        <button
                            onClick={() => { setSelectedStage(null); setPatients([]); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#64748b',
                                cursor: 'pointer',
                                fontSize: '1.25rem'
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    {loadingPatients ? (
                        <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading...</div>
                    ) : patients.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: '0.875rem' }}>No patients in this stage</div>
                    ) : (
                        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                            {patients.map(patient => (
                                <div
                                    key={patient.id}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '0.5rem 0',
                                        borderBottom: '1px solid #e2e8f0'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                            {patient.name}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                            {patient.clientType} • {new Date(patient.dateAdded).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <a
                                        href={`/ops/patients/${patient.id}`}
                                        style={{
                                            padding: '0.25rem 0.75rem',
                                            background: '#3b82f6',
                                            color: 'white',
                                            borderRadius: '6px',
                                            fontSize: '0.75rem',
                                            textDecoration: 'none'
                                        }}
                                    >
                                        View
                                    </a>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Key Metrics */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1rem',
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>
                        {data.metrics.retentionRate}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Retention</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>
                        {data.metrics.holdRate}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>On Hold</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        color: parseFloat(data.metrics.weeklyGrowth) >= 0 ? '#22c55e' : '#ef4444'
                    }}>
                        {parseFloat(data.metrics.weeklyGrowth) >= 0 ? '+' : ''}{data.metrics.weeklyGrowth}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Weekly Growth</div>
                </div>
            </div>

            {/* Hold Breakdown (if any) */}
            {data.holdBreakdown.length > 0 && data.summary.hold > 0 && (
                <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.5rem' }}>
                        ⚠️ Hold Breakdown
                    </div>
                    {data.holdBreakdown.slice(0, 5).map(h => (
                        <div
                            key={h.status}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '0.25rem 0',
                                fontSize: '0.875rem',
                                color: '#475569'
                            }}
                        >
                            <span>{h.status}</span>
                            <span style={{ fontWeight: 500 }}>{h.count}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

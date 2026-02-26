'use client';

import { useState, useEffect, useMemo } from 'react';
import { withBasePath } from '@/lib/basePath';

interface SystemCounts {
    carrieboyd_full_vials: number;
    carrieboyd_partial_ml: number;
    carrieboyd_total_ml: number;
    toprx_vials: number;
    toprx_full_vials: number;
    toprx_partial_ml: number;
    toprx_total_ml: number;
}

interface CheckStatus {
    completed: boolean;
    checkTime?: string;
    checkedBy?: string;
    hasDiscrepancy?: boolean;
    checkType?: 'morning' | 'evening';
}

interface Props {
    checkType?: 'morning' | 'evening';
}

export default function MorningCheckForm({ checkType = 'morning' }: Props) {
    // Status state
    const [checkStatus, setCheckStatus] = useState<CheckStatus | null>(null);
    const [systemCounts, setSystemCounts] = useState<SystemCounts | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Form inputs
    const [cbFull, setCbFull] = useState('');
    const [cbPartial, setCbPartial] = useState('');
    const [trCount, setTrCount] = useState('');
    const [trPartial, setTrPartial] = useState('');
    const [discrepancyReason, setDiscrepancyReason] = useState('');
    const [hadMissingTransactions, setHadMissingTransactions] = useState(false);

    const isMorning = checkType === 'morning';
    const title = isMorning ? 'Morning Controlled Substance Check' : 'End of Day Inventory Check';
    const subtitle = isMorning
        ? 'Verify physical inventory before dispensing today. Enter what you count.'
        : 'Final count before closing. Verify inventory matches dispensing records.';

    // Calculate if there's a significant discrepancy (>2ml triggers required reason)
    // Small differences (<=2ml) are auto-documented as waste
    const hasDiscrepancy = useMemo(() => {
        if (!systemCounts) return false;

        const physicalCbTotal = (parseInt(cbFull) || 0) * 30 + (parseFloat(cbPartial) || 0);
        const physicalTrTotal = (parseInt(trCount) || 0) * 10 + (parseFloat(trPartial) || 0);

        const cbDiff = Math.abs(systemCounts.carrieboyd_total_ml - physicalCbTotal);
        const trDiff = Math.abs(systemCounts.toprx_total_ml - physicalTrTotal);

        // Only require explanation for >2ml difference
        return cbDiff > 2.0 || trDiff > 2.0;
    }, [systemCounts, cbFull, cbPartial, trCount, trPartial]);

    // Load status on mount
    useEffect(() => {
        loadStatus();
    }, [checkType]);

    async function loadStatus() {
        setLoading(true);
        try {
            const [statusRes, countsRes] = await Promise.all([
                fetch(withBasePath(`/api/inventory/controlled-check?action=status&type=${checkType}`)),
                fetch(withBasePath('/api/inventory/controlled-check?action=counts'))
            ]);

            const statusData = await statusRes.json();
            const countsData = await countsRes.json();

            setCheckStatus(statusData);
            setSystemCounts(countsData);

            // Pre-fill with system counts as default
            if (countsData) {
                setCbFull(String(countsData.carrieboyd_full_vials || 0));
                setCbPartial(String(countsData.carrieboyd_partial_ml?.toFixed(1) || 0));
                setTrCount(String(countsData.toprx_full_vials ?? countsData.toprx_vials ?? 0));
                setTrPartial(String(countsData.toprx_partial_ml?.toFixed(1) || 0));
            }
        } catch (err) {
            console.error('Failed to load check status:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        // Require discrepancy reason if counts don't match
        if (hasDiscrepancy && !discrepancyReason.trim()) {
            setMessage({
                type: 'error',
                text: '⚠️ Counts don\'t match system. Please provide a reason for the discrepancy.'
            });
            return;
        }

        setSubmitting(true);
        setMessage(null);

        try {
            const response = await fetch(withBasePath('/api/inventory/controlled-check'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    carrieboyd_full_vials: parseInt(cbFull) || 0,
                    carrieboyd_partial_ml: parseFloat(cbPartial) || 0,
                    toprx_vials: parseInt(trCount) || 0,
                    physicalPartialMlTopRx: parseFloat(trPartial) || 0,
                    check_type: checkType,
                    discrepancyNotes: hasDiscrepancy ? discrepancyReason : null,
                    notes: null
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to record check');
            }

            // Show result
            if (data.hasDiscrepancy) {
                setMessage({
                    type: 'success',
                    text: `✅ ${isMorning ? 'Morning' : 'EOD'} check recorded. Discrepancy noted and inventory adjusted. You may now dispense.`
                });
            } else {
                setMessage({
                    type: 'success',
                    text: `✅ ${isMorning ? 'Morning' : 'EOD'} check completed — inventory matches!`
                });
            }

            // Clear form state
            setDiscrepancyReason('');
            setHadMissingTransactions(false);

            // Reload status
            await loadStatus();
        } catch (err) {
            setMessage({
                type: 'error',
                text: (err as Error).message
            });
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div style={containerStyle(isMorning, false)}>
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading check status...
                </div>
            </div>
        );
    }

    // If check is already done today
    if (checkStatus?.completed) {
        return (
            <div style={{ ...containerStyle(isMorning, true), backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>✅</span>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#166534' }}>
                            {isMorning ? 'Morning' : 'End of Day'} Inventory Check Complete
                        </h3>
                        <p style={{ margin: '0.25rem 0 0', color: '#166534', fontSize: '0.9rem' }}>
                            Completed at {checkStatus.checkTime} by {checkStatus.checkedBy}
                            {checkStatus.hasDiscrepancy && (
                                <span style={{ color: '#b45309', marginLeft: '0.5rem' }}>
                                    ⚠️ Discrepancy noted
                                </span>
                            )}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Show the check form
    return (
        <div style={containerStyle(isMorning, false)}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{isMorning ? '📋' : '🌙'}</span>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>
                        {title}
                    </h3>
                    <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                        {subtitle}
                    </p>
                </div>
            </div>

            {message && (
                <div style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '0.5rem',
                    marginBottom: '1rem',
                    backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                    color: message.type === 'success' ? '#166534' : '#dc2626'
                }}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                {/* System shows what it expects */}
                <div style={{ backgroundColor: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                        <strong>System expects:</strong>{' '}
                        Carrie Boyd: {systemCounts?.carrieboyd_full_vials} full + {systemCounts?.carrieboyd_partial_ml?.toFixed(1)}ml partial = {systemCounts?.carrieboyd_total_ml?.toFixed(1)}ml
                        {' | '}
                        TopRX: {systemCounts?.toprx_full_vials ?? systemCounts?.toprx_vials} full{(systemCounts?.toprx_partial_ml ?? 0) > 0 ? ` + ${systemCounts?.toprx_partial_ml?.toFixed(1)}ml partial` : ''} = {systemCounts?.toprx_total_ml?.toFixed(1)}ml
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {/* Carrie Boyd Section */}
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>Carrie Boyd (30ml)</legend>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <label style={labelStyle}>
                                <span>Full vials</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={cbFull}
                                    onChange={(e) => setCbFull(e.target.value)}
                                    style={inputStyle}
                                    placeholder="0"
                                />
                            </label>
                            <label style={labelStyle}>
                                <span>Partial (ml)</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={cbPartial}
                                    onChange={(e) => setCbPartial(e.target.value)}
                                    style={inputStyle}
                                    placeholder="0.0"
                                />
                            </label>
                        </div>
                    </fieldset>

                    {/* TopRX Section */}
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>TopRX (10ml)</legend>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <label style={labelStyle}>
                                <span>Full vials</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={trCount}
                                    onChange={(e) => setTrCount(e.target.value)}
                                    style={inputStyle}
                                    placeholder="0"
                                />
                            </label>
                            <label style={labelStyle}>
                                <span>Partial (ml)</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={trPartial}
                                    onChange={(e) => setTrPartial(e.target.value)}
                                    style={inputStyle}
                                    placeholder="0.0"
                                />
                            </label>
                        </div>
                    </fieldset>
                </div>

                {/* Link to enter prior day transactions */}
                <div style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: '0.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '1.1rem' }}>📋</span>
                        <span style={{ fontWeight: 600, color: '#0369a1' }}>
                            Missed transactions from yesterday?
                        </span>
                    </div>
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#64748b' }}>
                        If you have dispenses from yesterday that weren't logged, enter them first before completing this audit.
                    </p>
                    <a
                        href="/ops/transactions"
                        target="_blank"
                        style={{
                            display: 'inline-block',
                            padding: '0.5rem 1rem',
                            backgroundColor: '#0ea5e9',
                            color: 'white',
                            textDecoration: 'none',
                            borderRadius: '0.375rem',
                            fontSize: '0.9rem',
                            fontWeight: 600
                        }}
                    >
                        → Enter Prior Day Transactions
                    </a>
                </div>

                {/* Discrepancy reason - only show if counts don't match */}
                {hasDiscrepancy && (
                    <div style={{
                        marginBottom: '1rem',
                        padding: '0.75rem 1rem',
                        backgroundColor: '#fef3c7',
                        border: '1px solid #fcd34d',
                        borderRadius: '0.5rem'
                    }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#92400e' }}>
                            ⚠️ Count doesn't match system. Please explain the discrepancy:
                        </label>
                        <textarea
                            value={discrepancyReason}
                            onChange={(e) => setDiscrepancyReason(e.target.value)}
                            placeholder="e.g., Vial broken, spillage, dispensed but not logged, count error..."
                            required
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid #fcd34d',
                                borderRadius: '0.375rem',
                                fontSize: '0.9rem',
                                minHeight: '60px',
                                resize: 'vertical'
                            }}
                        />
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    style={{
                        padding: '0.75rem 1.5rem',
                        backgroundColor: submitting ? '#94a3b8' : (isMorning ? '#0ea5e9' : '#6366f1'),
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontSize: '1rem',
                        fontWeight: 600,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s'
                    }}
                >
                    {submitting ? 'Recording...' : `Complete ${isMorning ? 'Morning' : 'EOD'} Check`}
                </button>
            </form>
        </div>
    );
}

function containerStyle(isMorning: boolean, completed: boolean): React.CSSProperties {
    if (completed) {
        return {
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            marginBottom: '1.5rem'
        };
    }
    return {
        backgroundColor: isMorning ? '#fffbeb' : '#eef2ff',
        border: `1px solid ${isMorning ? '#fcd34d' : '#a5b4fc'}`,
        borderRadius: '0.75rem',
        padding: '1.25rem',
        marginBottom: '1.5rem'
    };
}

const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: '0.5rem',
    padding: '0.75rem 1rem',
    margin: 0,
    backgroundColor: 'white'
};

const legendStyle: React.CSSProperties = {
    padding: '0 0.5rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#475569'
};

const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.85rem',
    color: '#64748b'
};

const inputStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    border: '1px solid #cbd5e1',
    borderRadius: '0.375rem',
    fontSize: '1rem',
    width: '80px'
};

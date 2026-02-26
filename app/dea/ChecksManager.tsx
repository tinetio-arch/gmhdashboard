'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface CheckRecord {
    checkId: string;
    checkDate: string;
    checkType: string;
    performedByName: string;
    performedAt: string;
    systemVialsCb: number;
    systemVialsTr: number;
    physicalVialsCb: number;
    physicalVialsTr: number;
    systemMlCb: number;
    systemMlTr: number;
    physicalPartialCb: number;
    physicalPartialTr: number;
    discrepancyFound: boolean;
    discrepancyMlCb: number;
    discrepancyMlTr: number;
    discrepancyNotes: string | null;
    notes: string | null;
}

export default function ChecksManager({
    checks,
    isAdmin
}: {
    checks: CheckRecord[];
    isAdmin: boolean;
}) {
    const [rows, setRows] = useState(checks);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    async function handleDelete(checkId: string) {
        if (!confirm('Delete this EOD check? This cannot be undone.')) return;
        setDeletingId(checkId);
        try {
            const res = await fetch(`${basePath}/api/checks/${checkId}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Failed to delete check');
                return;
            }
            setRows(prev => prev.filter(r => r.checkId !== checkId));
        } catch {
            alert('Network error — please try again');
        } finally {
            setDeletingId(null);
        }
    }

    if (rows.length === 0) {
        return (
            <div style={sectionStyle}>
                <h3 style={sectionTitle}>Controlled Substance Checks</h3>
                <p style={{ color: '#64748b' }}>No checks recorded in the last 14 days.</p>
            </div>
        );
    }

    return (
        <div style={sectionStyle}>
            <h3 style={sectionTitle}>Controlled Substance Checks (Last 14 Days)</h3>
            <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.22)', backgroundColor: '#ffffff', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                        <tr>
                            {['Date', 'Type', 'By', 'CB 30mL (Sys / Phys)', 'TopRx 10mL (Sys / Phys)', 'Discrepancy', 'Notes', ...(isAdmin ? [''] : [])].map(h => (
                                <th key={h} style={headerStyle}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(c => {
                            const cbMatch = c.systemVialsCb === c.physicalVialsCb;
                            const trMatch = c.systemVialsTr === c.physicalVialsTr;

                            return (
                                <tr key={c.checkId}>
                                    <td style={cellStyle}>{formatDate(c.checkDate)}</td>
                                    <td style={cellStyle}>
                                        <span style={{
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: c.checkType === 'morning' ? 'rgba(234, 179, 8, 0.12)' : 'rgba(99, 102, 241, 0.12)',
                                            color: c.checkType === 'morning' ? '#a16207' : '#4338ca'
                                        }}>
                                            {c.checkType === 'morning' ? '☀ Morning' : '🌙 EOD'}
                                        </span>
                                    </td>
                                    <td style={cellStyle}>{c.performedByName}</td>
                                    <td style={{ ...cellStyle, color: cbMatch ? '#16a34a' : '#dc2626', fontWeight: cbMatch ? 400 : 700 }}>
                                        {c.systemVialsCb} / {c.physicalVialsCb}
                                        {c.physicalPartialCb > 0 && <span style={{ color: '#64748b', fontWeight: 400 }}> (+{c.physicalPartialCb}mL partial)</span>}
                                    </td>
                                    <td style={{ ...cellStyle, color: trMatch ? '#16a34a' : '#dc2626', fontWeight: trMatch ? 400 : 700 }}>
                                        {c.systemVialsTr} / {c.physicalVialsTr}
                                        {c.physicalPartialTr > 0 && <span style={{ color: '#64748b', fontWeight: 400 }}> (+{c.physicalPartialTr}mL partial)</span>}
                                    </td>
                                    <td style={cellStyle}>
                                        {c.discrepancyFound ? (
                                            <div>
                                                <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ YES</span>
                                                {(c.discrepancyMlCb !== 0 || c.discrepancyMlTr !== 0) && (
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>
                                                        {c.discrepancyMlCb !== 0 && `CB: ${c.discrepancyMlCb > 0 ? '+' : ''}${c.discrepancyMlCb}mL `}
                                                        {c.discrepancyMlTr !== 0 && `TR: ${c.discrepancyMlTr > 0 ? '+' : ''}${c.discrepancyMlTr}mL`}
                                                    </div>
                                                )}
                                                {c.discrepancyNotes && (
                                                    <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.15rem' }}>{c.discrepancyNotes}</div>
                                                )}
                                            </div>
                                        ) : (
                                            <span style={{ color: '#16a34a' }}>✓ OK</span>
                                        )}
                                    </td>
                                    <td style={{ ...cellStyle, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {c.notes || '—'}
                                    </td>
                                    {isAdmin && (
                                        <td style={cellStyle}>
                                            {c.checkType === 'evening' && (
                                                <button
                                                    onClick={() => handleDelete(c.checkId)}
                                                    disabled={deletingId === c.checkId}
                                                    style={{
                                                        padding: '0.3rem 0.7rem',
                                                        borderRadius: '0.4rem',
                                                        border: '1px solid rgba(220, 38, 38, 0.3)',
                                                        background: deletingId === c.checkId ? '#e2e8f0' : 'rgba(220, 38, 38, 0.08)',
                                                        color: '#dc2626',
                                                        fontWeight: 600,
                                                        fontSize: '0.8rem',
                                                        cursor: deletingId === c.checkId ? 'wait' : 'pointer',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {deletingId === c.checkId ? 'Deleting…' : '🗑 Delete'}
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function formatDate(d: string) {
    try {
        return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return d;
    }
}

const sectionStyle: CSSProperties = {
    marginTop: '2rem',
    marginBottom: '1.5rem'
};

const sectionTitle: CSSProperties = {
    fontSize: '1.3rem',
    marginBottom: '0.75rem',
    color: '#0f172a'
};

const headerStyle: CSSProperties = {
    padding: '0.6rem 0.75rem',
    textAlign: 'left',
    color: '#475569',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
    backgroundColor: '#f1f5f9',
    whiteSpace: 'nowrap'
};

const cellStyle: CSSProperties = {
    padding: '0.55rem 0.75rem',
    borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    whiteSpace: 'nowrap'
};

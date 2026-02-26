'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FaxQueueItem {
    id: string;
    s3_key: string;
    from_address: string;
    subject: string;
    body_text: string;
    pdf_s3_key: string | null;
    received_at: string;
    ai_summary: string | null;
    ai_fax_type: string | null;
    ai_patient_name: string | null;
    ai_sending_facility: string | null;
    ai_urgency: string | null;
    ai_key_findings: string[] | null;
    healthie_patient_id: string | null;
    status: string;
    approved_at: string | null;
}

interface PatientOption {
    id: string;
    name: string;
}

interface Props {
    faxQueue: FaxQueueItem[];
}

const urgencyColors: Record<string, { bg: string; text: string; border: string }> = {
    critical: { bg: '#fef2f2', text: '#991b1b', border: '#ef4444' },
    high: { bg: '#fff7ed', text: '#9a3412', border: '#f97316' },
    medium: { bg: '#fefce8', text: '#854d0e', border: '#eab308' },
    low: { bg: '#f0fdf4', text: '#166534', border: '#22c55e' },
};

const faxTypeLabels: Record<string, string> = {
    lab_result: '🧪 Lab Result',
    referral: '📋 Referral',
    medical_records: '📁 Medical Records',
    prior_auth: '📝 Prior Auth',
    prescription: '💊 Prescription',
    billing: '💰 Billing',
    insurance: '🏥 Insurance',
    other: '📠 Fax',
};

export default function FaxesDashboardClient({ faxQueue: initialQueue }: Props) {
    const router = useRouter();
    const [queue, setQueue] = useState(initialQueue);
    const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
    const [selectedFax, setSelectedFax] = useState<FaxQueueItem | null>(null);
    const [patients, setPatients] = useState<PatientOption[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState<string>('');
    const [selectedPatientName, setSelectedPatientName] = useState<string>('');
    const [patientSearch, setPatientSearch] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [visibleToPatient, setVisibleToPatient] = useState(true);

    // Search patients as user types (debounced)
    useEffect(() => {
        if (patientSearch.length < 2) {
            setPatients([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                // Use Healthie API search via our faxes/patients endpoint
                const res = await fetch(`/ops/api/faxes/patients?q=${encodeURIComponent(patientSearch)}`);
                if (res.ok) {
                    const data = await res.json();
                    // API returns { id, name, email } format
                    setPatients(data.patients || []);
                }
            } catch (e) {
                console.error('Patient search failed:', e);
            } finally {
                setIsSearching(false);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [patientSearch]);

    const filteredQueue = queue.filter(f => {
        if (activeTab === 'pending') return f.status === 'pending_review';
        if (activeTab === 'approved') return f.status === 'approved';
        if (activeTab === 'rejected') return f.status === 'rejected';
        return true;
    });

    async function handleApprove(faxId: string, patientId: string) {
        if (!patientId) {
            setError('Please select a patient');
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            const res = await fetch('/ops/api/faxes/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: faxId,
                    action: 'approve',
                    healthie_patient_id: patientId,
                    visible_to_patient: visibleToPatient,
                }),
            });

            const data = await res.json();

            if (data.success) {
                setQueue(prev => prev.map(f =>
                    f.id === faxId
                        ? { ...f, status: 'approved', healthie_patient_id: patientId, approved_at: new Date().toISOString() }
                        : f
                ));
                setSelectedFax(null);
                router.refresh();
            } else {
                setError(data.error || 'Failed to approve');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setIsProcessing(false);
        }
    }

    async function handleReject(faxId: string, reason: string) {
        setIsProcessing(true);
        setError(null);

        try {
            const res = await fetch('/ops/api/faxes/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: faxId,
                    action: 'reject',
                    rejection_reason: reason,
                }),
            });

            const data = await res.json();

            if (data.success) {
                setQueue(prev => prev.map(f =>
                    f.id === faxId ? { ...f, status: 'rejected' } : f
                ));
                setSelectedFax(null);
            } else {
                setError(data.error || 'Failed to reject');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setIsProcessing(false);
        }
    }

    async function handleUnreject(faxId: string) {
        setIsProcessing(true);
        setError(null);

        try {
            const res = await fetch('/ops/api/faxes/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: faxId,
                    action: 'unreject',
                }),
            });

            const data = await res.json();

            if (data.success) {
                setQueue(prev => prev.map(f =>
                    f.id === faxId ? { ...f, status: 'pending_review' } : f
                ));
            } else {
                setError(data.error || 'Failed to unreject');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setIsProcessing(false);
        }
    }

    function formatDate(dateStr: string | null) {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    return (
        <div>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {(['pending', 'approved', 'rejected'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '0.75rem 1.5rem',
                            borderRadius: '0.5rem',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            backgroundColor: activeTab === tab ? '#0ea5e9' : '#e2e8f0',
                            color: activeTab === tab ? '#fff' : '#475569',
                        }}
                    >
                        {tab === 'pending' ? `Pending (${queue.filter(f => f.status === 'pending_review').length})` :
                            tab === 'approved' ? `Approved (${queue.filter(f => f.status === 'approved').length})` :
                                `Rejected (${queue.filter(f => f.status === 'rejected').length})`}
                    </button>
                ))}
            </div>

            {/* Fax List */}
            <div style={{ display: 'grid', gap: '1rem' }}>
                {filteredQueue.length === 0 && (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', backgroundColor: '#fff', borderRadius: '0.5rem' }}>
                        No faxes in this category
                    </div>
                )}

                {filteredQueue.map(fax => {
                    const urgency = fax.ai_urgency || 'medium';
                    const colors = urgencyColors[urgency] || urgencyColors.medium;
                    const faxType = fax.ai_fax_type || 'other';

                    return (
                        <div
                            key={fax.id}
                            style={{
                                padding: '1.5rem',
                                backgroundColor: '#fff',
                                borderRadius: '0.75rem',
                                border: `2px solid ${colors.border}`,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            }}
                        >
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <div>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.8rem',
                                            fontWeight: 600,
                                            backgroundColor: colors.bg,
                                            color: colors.text,
                                        }}>
                                            {urgency.toUpperCase()}
                                        </span>
                                        <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
                                            {faxTypeLabels[faxType]}
                                        </span>
                                    </div>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>
                                        {fax.subject || 'No Subject'}
                                    </h3>
                                    <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                                        From: {fax.from_address || 'Unknown'} • {formatDate(fax.received_at)}
                                    </p>
                                </div>

                                {fax.pdf_s3_key && (
                                    <a
                                        href={`/ops/api/faxes/pdf/${fax.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: '#3b82f6',
                                            color: '#fff',
                                            borderRadius: '0.5rem',
                                            textDecoration: 'none',
                                            fontSize: '0.9rem',
                                            fontWeight: 600,
                                        }}
                                    >
                                        📄 View PDF
                                    </a>
                                )}
                            </div>

                            {/* AI Summary */}
                            {fax.ai_summary && (
                                <div style={{
                                    padding: '1rem',
                                    backgroundColor: '#f1f5f9',
                                    borderRadius: '0.5rem',
                                    marginBottom: '1rem'
                                }}>
                                    <strong style={{ color: '#475569' }}>AI Summary:</strong>
                                    <p style={{ margin: '0.5rem 0 0', color: '#1e293b' }}>{fax.ai_summary}</p>
                                </div>
                            )}

                            {/* Patient Name / Facility */}
                            <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                {fax.ai_patient_name && (
                                    <div>
                                        <strong style={{ color: '#64748b' }}>Patient:</strong>{' '}
                                        <span style={{ color: '#0f172a' }}>{fax.ai_patient_name}</span>
                                    </div>
                                )}
                                {fax.ai_sending_facility && (
                                    <div>
                                        <strong style={{ color: '#64748b' }}>From:</strong>{' '}
                                        <span style={{ color: '#0f172a' }}>{fax.ai_sending_facility}</span>
                                    </div>
                                )}
                            </div>

                            {/* Content Preview */}
                            <details style={{ marginBottom: '1rem' }}>
                                <summary style={{ cursor: 'pointer', color: '#0ea5e9', fontWeight: 600 }}>
                                    View Content Preview
                                </summary>
                                <pre style={{
                                    marginTop: '0.5rem',
                                    padding: '1rem',
                                    backgroundColor: '#f8fafc',
                                    borderRadius: '0.5rem',
                                    fontSize: '0.85rem',
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: '300px',
                                    overflow: 'auto',
                                    color: '#334155',
                                }}>
                                    {fax.body_text || 'No content available'}
                                </pre>
                            </details>

                            {/* Actions for Pending */}
                            {fax.status === 'pending_review' && (
                                <div style={{
                                    padding: '1rem',
                                    backgroundColor: '#fefce8',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #eab308'
                                }}>
                                    <div style={{ marginBottom: '0.75rem' }}>
                                        <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600, color: '#854d0e' }}>
                                            Select Patient for Healthie Upload:
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Search patients..."
                                            value={selectedFax?.id === fax.id ? patientSearch : ''}
                                            onChange={(e) => {
                                                setSelectedFax(fax);
                                                setPatientSearch(e.target.value);
                                            }}
                                            onFocus={() => setSelectedFax(fax)}
                                            style={{
                                                width: '100%',
                                                padding: '0.5rem',
                                                borderRadius: '0.375rem',
                                                border: '1px solid #d1d5db',
                                                marginBottom: '0.5rem',
                                            }}
                                        />
                                        {selectedFax?.id === fax.id && patientSearch.length >= 2 && (
                                            <div style={{
                                                maxHeight: '200px',
                                                overflow: 'auto',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '0.375rem',
                                                backgroundColor: '#fff',
                                            }}>
                                                {isSearching && (
                                                    <div style={{ padding: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                                                        Searching...
                                                    </div>
                                                )}
                                                {!isSearching && patients.length === 0 && (
                                                    <div style={{ padding: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                                                        No patients found
                                                    </div>
                                                )}
                                                {!isSearching && patients.map(p => (
                                                    <div
                                                        key={p.id}
                                                        onClick={() => {
                                                            setSelectedPatientId(p.id);
                                                            setSelectedPatientName(p.name);
                                                            setPatientSearch(p.name);
                                                            setPatients([]); // Close dropdown
                                                        }}
                                                        style={{
                                                            padding: '0.75rem',
                                                            cursor: 'pointer',
                                                            backgroundColor: selectedPatientId === p.id ? '#dbeafe' : 'transparent',
                                                            borderBottom: '1px solid #f1f5f9',
                                                        }}
                                                    >
                                                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {error && selectedFax?.id === fax.id && (
                                        <div style={{ color: '#dc2626', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                            {error}
                                        </div>
                                    )}

                                    {/* Visibility Toggle */}
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        marginBottom: '0.75rem',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={visibleToPatient}
                                            onChange={(e) => setVisibleToPatient(e.target.checked)}
                                            style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
                                        />
                                        <span style={{ color: visibleToPatient ? '#16a34a' : '#64748b' }}>
                                            {visibleToPatient ? '👁️ Visible to patient' : '🔒 Hidden from patient'}
                                        </span>
                                    </label>

                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => handleApprove(fax.id, selectedPatientId)}
                                            disabled={isProcessing}
                                            style={{
                                                padding: '0.5rem 1.5rem',
                                                backgroundColor: '#22c55e',
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '0.375rem',
                                                fontWeight: 600,
                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                opacity: isProcessing ? 0.5 : 1,
                                            }}
                                        >
                                            {isProcessing ? 'Processing...' : '✓ Approve & Upload'}
                                        </button>
                                        <button
                                            onClick={() => handleReject(fax.id, 'Not needed')}
                                            disabled={isProcessing}
                                            style={{
                                                padding: '0.5rem 1.5rem',
                                                backgroundColor: '#ef4444',
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '0.375rem',
                                                fontWeight: 600,
                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                opacity: isProcessing ? 0.5 : 1,
                                            }}
                                        >
                                            ✕ Reject
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Approved Status */}
                            {fax.status === 'approved' && (
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    backgroundColor: '#d1fae5',
                                    borderRadius: '0.5rem',
                                    color: '#065f46',
                                    fontWeight: 600,
                                }}>
                                    ✓ Approved and uploaded to Healthie {fax.approved_at && `on ${formatDate(fax.approved_at)}`}
                                </div>
                            )}

                            {/* Rejected Status with Unreject */}
                            {fax.status === 'rejected' && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem 1rem',
                                    backgroundColor: '#fee2e2',
                                    borderRadius: '0.5rem',
                                }}>
                                    <div style={{ color: '#991b1b', fontWeight: 600 }}>
                                        ✕ Rejected {fax.rejection_reason && `- ${fax.rejection_reason}`}
                                    </div>
                                    <button
                                        onClick={() => handleUnreject(fax.id)}
                                        disabled={isProcessing}
                                        style={{
                                            padding: '0.4rem 1rem',
                                            backgroundColor: '#6366f1',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 600,
                                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                                            opacity: isProcessing ? 0.5 : 1,
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        ↩ Move to Pending
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

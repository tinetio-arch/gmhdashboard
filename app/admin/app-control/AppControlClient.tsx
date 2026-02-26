'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────

interface PatientSummary {
    patient_id: string;
    patient_name: string;
    healthie_client_id: string | null;
    current_status: 'granted' | 'revoked' | 'suspended';
    last_changed_at: string | null;
    last_changed_by: string | null;
    last_reason: string | null;
    last_reason_category: string | null;
    status_key: string | null;
}

interface Stats {
    total_patients: number;
    granted_count: number;
    revoked_count: number;
    suspended_count: number;
}

interface HistoryEntry {
    id: number;
    access_status: string;
    reason: string;
    reason_category: string | null;
    changed_by_name: string | null;
    effective_at: string;
    healthie_synced: boolean;
    healthie_sync_error: string | null;
    notes: string | null;
}

type ModalType = 'revoke' | 'restore' | 'history' | null;

const REASON_CATEGORIES = [
    { value: 'payment', label: '💳 Payment Issue' },
    { value: 'policy_violation', label: '⚠️ Policy Violation' },
    { value: 'discharged', label: '📋 Discharged' },
    { value: 'administrative', label: '🔧 Administrative' },
    { value: 'other', label: '📝 Other' },
];

const STATUS_BADGES: Record<string, { emoji: string; label: string; bg: string; color: string; border: string }> = {
    granted: { emoji: '🟢', label: 'Active', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    revoked: { emoji: '🔴', label: 'Revoked', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
    suspended: { emoji: '🟡', label: 'Suspended', bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
};

// ── Styles ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
    padding: '1.25rem',
    borderRadius: '0.75rem',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: '#ffffff',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    fontSize: '0.9rem',
};

const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '0.6rem 0.75rem',
    borderBottom: '2px solid #e2e8f0',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    borderBottom: '1px solid #f1f5f9',
    fontSize: '0.875rem',
};

// ── Component ──────────────────────────────────────────────────────

export default function AppControlClient() {
    const [patients, setPatients] = useState<PatientSummary[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Modal state
    const [modalType, setModalType] = useState<ModalType>(null);
    const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
    const [modalReason, setModalReason] = useState('');
    const [modalCategory, setModalCategory] = useState('payment');
    const [modalNotes, setModalNotes] = useState('');
    const [modalSubmitting, setModalSubmitting] = useState(false);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [patientsRes, statsRes] = await Promise.all([
                fetch('/ops/api/app-access/'),
                fetch('/ops/api/app-access/?action=stats'),
            ]);

            if (!patientsRes.ok) throw new Error('Failed to load patients');
            if (!statsRes.ok) throw new Error('Failed to load stats');

            const patientsData = await patientsRes.json();
            const statsData = await statsRes.json();

            setPatients(patientsData.patients || []);
            setStats(statsData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // Clear success message after 4s
    useEffect(() => {
        if (successMsg) {
            const t = setTimeout(() => setSuccessMsg(null), 4000);
            return () => clearTimeout(t);
        }
    }, [successMsg]);

    // ── Filter logic ──────────────────────────────────────────────────

    const filtered = patients.filter((p) => {
        const matchesSearch =
            !search ||
            p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
            (p.healthie_client_id && p.healthie_client_id.includes(search));
        const matchesFilter = filterStatus === 'all' || p.current_status === filterStatus;
        return matchesSearch && matchesFilter;
    });

    // ── Actions ───────────────────────────────────────────────────────

    function openRevokeModal(patient: PatientSummary) {
        setSelectedPatient(patient);
        setModalType('revoke');
        setModalReason('');
        setModalCategory('payment');
        setModalNotes('');
    }

    function openRestoreModal(patient: PatientSummary) {
        setSelectedPatient(patient);
        setModalType('restore');
        setModalReason('');
        setModalNotes('');
    }

    async function openHistoryModal(patient: PatientSummary) {
        setSelectedPatient(patient);
        setModalType('history');
        setHistoryLoading(true);
        setHistory([]);
        try {
            const res = await fetch(`/ops/api/app-access/?action=history&patientId=${patient.patient_id}`);
            if (!res.ok) throw new Error('Failed to load history');
            const data = await res.json();
            setHistory(data.history || []);
        } catch (err) {
            setError('Failed to load history');
        } finally {
            setHistoryLoading(false);
        }
    }

    function closeModal() {
        setModalType(null);
        setSelectedPatient(null);
        setModalReason('');
        setModalNotes('');
        setHistory([]);
    }

    async function handleSubmitAction() {
        if (!selectedPatient || !modalReason.trim()) return;
        setModalSubmitting(true);
        setError(null);

        try {
            const body: any = {
                action: modalType,
                patientId: selectedPatient.patient_id,
                reason: modalReason.trim(),
                notes: modalNotes.trim() || undefined,
            };
            if (modalType === 'revoke') {
                body.reasonCategory = modalCategory;
            }

            const res = await fetch('/ops/api/app-access/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');

            setSuccessMsg(data.message || 'Action completed');
            closeModal();
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Action failed');
        } finally {
            setModalSubmitting(false);
        }
    }

    // ── Render ────────────────────────────────────────────────────────

    function formatDate(d: string | null) {
        if (!d) return '—';
        try {
            const date = new Date(d);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return d;
        }
    }

    function formatDateTime(d: string | null) {
        if (!d) return '—';
        try {
            const date = new Date(d);
            return date.toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
            });
        } catch {
            return d;
        }
    }

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem', color: '#0f172a' }}>
                    📱 App Access Control
                </h1>
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                    Manage patient access to the mobile app. Revoking access deactivates the patient&apos;s Healthie account,
                    preventing login.
                </p>
            </div>

            {/* Status messages */}
            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '0.5rem', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                    ❌ {error}
                    <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 600 }}>✕</button>
                </div>
            )}
            {successMsg && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '0.5rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                    ✅ {successMsg}
                </div>
            )}

            {/* Stats Cards */}
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                    <StatCard label="Total Patients" value={stats.total_patients} color="#3b82f6" bg="#eff6ff" />
                    <StatCard label="Active Access" value={stats.granted_count} color="#16a34a" bg="#f0fdf4" />
                    <StatCard label="Revoked" value={stats.revoked_count} color="#dc2626" bg="#fef2f2" />
                    <StatCard label="Suspended" value={stats.suspended_count} color="#ca8a04" bg="#fefce8" />
                </div>
            )}

            {/* Search & Filter */}
            <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <input
                            type="text"
                            placeholder="Search by patient name or Healthie ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        style={{ ...inputStyle, width: 'auto', minWidth: '160px' }}
                    >
                        <option value="all">All Statuses</option>
                        <option value="granted">🟢 Active</option>
                        <option value="revoked">🔴 Revoked</option>
                        <option value="suspended">🟡 Suspended</option>
                    </select>
                    <button
                        onClick={() => void loadData()}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            border: '1px solid rgba(148, 163, 184, 0.6)',
                            background: '#f8fafc',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                        }}
                    >
                        {loading ? 'Loading…' : '⟳ Refresh'}
                    </button>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {filtered.length} of {patients.length} patients
                    </span>
                </div>
            </div>

            {/* Patients Table */}
            <div style={cardStyle}>
                {loading && patients.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading patients…</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                        {search || filterStatus !== 'all' ? 'No patients match your filters.' : 'No patients found.'}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8fafc' }}>
                                    <th style={thStyle}>Patient</th>
                                    <th style={thStyle}>App Access</th>
                                    <th style={thStyle}>Patient Status</th>
                                    <th style={thStyle}>Healthie ID</th>
                                    <th style={thStyle}>Last Change</th>
                                    <th style={thStyle}>Reason</th>
                                    <th style={thStyle}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((p) => {
                                    const badge = STATUS_BADGES[p.current_status] || STATUS_BADGES.granted;
                                    return (
                                        <tr key={p.patient_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...tdStyle, fontWeight: 500 }}>{p.patient_name}</td>
                                            <td style={tdStyle}>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '0.2rem 0.6rem',
                                                    borderRadius: '999px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                    backgroundColor: badge.bg,
                                                    color: badge.color,
                                                    border: `1px solid ${badge.border}`,
                                                }}>
                                                    {badge.emoji} {badge.label}
                                                </span>
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#64748b' }}>
                                                {p.status_key || '—'}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', fontFamily: 'monospace', color: '#64748b' }}>
                                                {p.healthie_client_id || '—'}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#64748b' }}>
                                                {p.last_changed_at ? (
                                                    <>
                                                        {formatDate(p.last_changed_at)}
                                                        {p.last_changed_by && <div style={{ fontSize: '0.75rem' }}>by {p.last_changed_by}</div>}
                                                    </>
                                                ) : '—'}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#64748b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {p.last_reason || '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    {p.current_status === 'granted' ? (
                                                        <ActionButton label="Revoke" color="#dc2626" bg="#fef2f2" border="#fecaca" onClick={() => openRevokeModal(p)} />
                                                    ) : (
                                                        <ActionButton label="Restore" color="#16a34a" bg="#f0fdf4" border="#bbf7d0" onClick={() => openRestoreModal(p)} />
                                                    )}
                                                    <ActionButton label="History" color="#6366f1" bg="#eef2ff" border="#c7d2fe" onClick={() => void openHistoryModal(p)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Modals ─────────────────────────────────────────────────── */}

            {/* Revoke / Restore Modal */}
            {(modalType === 'revoke' || modalType === 'restore') && selectedPatient && (
                <ModalOverlay onClose={closeModal}>
                    <div style={{ ...cardStyle, maxWidth: '520px', width: '90vw' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>
                            {modalType === 'revoke' ? '🚫 Revoke App Access' : '✅ Restore App Access'}
                        </h2>
                        <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Patient: <strong>{selectedPatient.patient_name}</strong>
                            {selectedPatient.healthie_client_id && (
                                <span style={{ fontFamily: 'monospace', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                                    (Healthie #{selectedPatient.healthie_client_id})
                                </span>
                            )}
                        </p>

                        {modalType === 'revoke' && (
                            <div style={{ marginBottom: '0.75rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569', fontSize: '0.85rem', fontWeight: 500 }}>
                                    Reason Category *
                                </label>
                                <select
                                    value={modalCategory}
                                    onChange={(e) => setModalCategory(e.target.value)}
                                    style={inputStyle}
                                >
                                    {REASON_CATEGORIES.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div style={{ marginBottom: '0.75rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569', fontSize: '0.85rem', fontWeight: 500 }}>
                                Reason *
                            </label>
                            <input
                                type="text"
                                placeholder={modalType === 'revoke' ? 'e.g., Missed 3 payments' : 'e.g., Payment received, account restored'}
                                value={modalReason}
                                onChange={(e) => setModalReason(e.target.value)}
                                style={inputStyle}
                                autoFocus
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569', fontSize: '0.85rem', fontWeight: 500 }}>
                                Notes (optional)
                            </label>
                            <textarea
                                value={modalNotes}
                                onChange={(e) => setModalNotes(e.target.value)}
                                placeholder="Additional context..."
                                rows={2}
                                style={{ ...inputStyle, resize: 'vertical' }}
                            />
                        </div>

                        {modalType === 'revoke' && (
                            <div style={{ padding: '0.75rem', background: '#fef3c7', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#92400e', border: '1px solid #fde68a' }}>
                                ⚠️ This will deactivate the patient in Healthie, blocking login to the app and patient portal.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={closeModal}
                                disabled={modalSubmitting}
                                style={{
                                    padding: '0.5rem 1.2rem', borderRadius: '0.5rem',
                                    border: '1px solid rgba(148, 163, 184, 0.6)',
                                    background: '#f8fafc', cursor: 'pointer', fontSize: '0.9rem',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void handleSubmitAction()}
                                disabled={modalSubmitting || !modalReason.trim()}
                                style={{
                                    padding: '0.5rem 1.2rem', borderRadius: '0.5rem', border: 'none',
                                    background: modalType === 'revoke'
                                        ? (modalSubmitting ? '#94a3b8' : '#dc2626')
                                        : (modalSubmitting ? '#94a3b8' : '#16a34a'),
                                    color: '#ffffff', fontWeight: 600, cursor: modalSubmitting ? 'wait' : 'pointer',
                                    fontSize: '0.9rem', opacity: !modalReason.trim() ? 0.5 : 1,
                                }}
                            >
                                {modalSubmitting
                                    ? 'Processing…'
                                    : modalType === 'revoke' ? 'Revoke Access' : 'Restore Access'}
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* History Modal */}
            {modalType === 'history' && selectedPatient && (
                <ModalOverlay onClose={closeModal}>
                    <div style={{ ...cardStyle, maxWidth: '700px', width: '90vw', maxHeight: '80vh', overflow: 'auto' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>
                            📋 Access History
                        </h2>
                        <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Patient: <strong>{selectedPatient.patient_name}</strong>
                        </p>

                        {historyLoading ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>Loading history…</div>
                        ) : history.length === 0 ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>No access changes recorded.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {history.map((entry) => {
                                    const badge = STATUS_BADGES[entry.access_status] || STATUS_BADGES.granted;
                                    return (
                                        <div
                                            key={entry.id}
                                            style={{
                                                padding: '0.75rem 1rem',
                                                borderRadius: '0.5rem',
                                                border: `1px solid ${badge.border}`,
                                                backgroundColor: badge.bg,
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 600, color: badge.color }}>
                                                    {badge.emoji} {entry.access_status.toUpperCase()}
                                                </span>
                                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    {formatDateTime(entry.effective_at)}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: '#334155' }}>
                                                <strong>Reason:</strong> {entry.reason}
                                            </div>
                                            {entry.reason_category && (
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    Category: {entry.reason_category}
                                                </div>
                                            )}
                                            {entry.changed_by_name && (
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    By: {entry.changed_by_name}
                                                </div>
                                            )}
                                            {entry.notes && (
                                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem', fontStyle: 'italic' }}>
                                                    Notes: {entry.notes}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                                Healthie sync: {entry.healthie_synced ? '✅' : entry.healthie_sync_error ? `❌ ${entry.healthie_sync_error}` : '⏳ Pending'}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                            <button
                                onClick={closeModal}
                                style={{
                                    padding: '0.5rem 1.2rem', borderRadius: '0.5rem',
                                    border: '1px solid rgba(148, 163, 184, 0.6)',
                                    background: '#f8fafc', cursor: 'pointer', fontSize: '0.9rem',
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}

// ── Helper Components ──────────────────────────────────────────────

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
    return (
        <div style={{
            padding: '1rem 1.25rem',
            borderRadius: '0.75rem',
            background: bg,
            border: `1px solid ${color}20`,
        }}>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</div>
        </div>
    );
}

function ActionButton({ label, color, bg, border, onClick }: {
    label: string; color: string; bg: string; border: string; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '0.25rem 0.65rem',
                borderRadius: '999px',
                border: `1px solid ${border}`,
                backgroundColor: bg,
                color,
                fontSize: '0.78rem',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
            }}
        >
            {label}
        </button>
    );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div
            style={{
                position: 'fixed', inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, padding: '1rem',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {children}
        </div>
    );
}

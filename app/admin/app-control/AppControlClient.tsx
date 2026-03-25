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
    first_app_login: string | null;
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

type ModalType = 'revoke' | 'restore' | 'history' | 'tags' | null;

interface TagInfo {
    tag: string;
    added_by?: string;
    added_at?: string;
}

interface AvailableTag {
    tag: string;
    labels: string[];
}

const HEALTHIE_GROUPS: Record<string, string> = {
    '75522': "NOW Men's Health",
    '75523': 'NOW Primary Care',
    '81103': 'NOWOptimal Wellness',
};

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

    // Tag management state
    const [patientTags, setPatientTags] = useState<TagInfo[]>([]);
    const [availableTags, setAvailableTags] = useState<AvailableTag[]>([]);
    const [tagsLoading, setTagsLoading] = useState(false);
    const [tagActionInProgress, setTagActionInProgress] = useState<string | null>(null);

    // Workflow config state
    const [showWorkflowConfig, setShowWorkflowConfig] = useState(false);
    const [workflowConfigs, setWorkflowConfigs] = useState<any[]>([]);
    const [workflowLoading, setWorkflowLoading] = useState(false);
    const [newStep, setNewStep] = useState({ tag: '', appointment_type_id: '', form_id: '', label: '' });

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

    async function openTagsModal(patient: PatientSummary) {
        setSelectedPatient(patient);
        setModalType('tags');
        setTagsLoading(true);
        try {
            const res = await fetch(`/ops/api/admin/patient-tags?patient_id=${patient.patient_id}`);
            const data = await res.json();
            setPatientTags(data.patientTags || []);
            setAvailableTags(data.availableTags || []);
        } catch {
            setError('Failed to load tags');
        } finally {
            setTagsLoading(false);
        }
    }

    async function toggleTag(patient: PatientSummary, tag: string, currentlyHas: boolean) {
        setTagActionInProgress(tag);
        try {
            const res = await fetch('/ops/api/admin/patient-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_id: patient.patient_id,
                    healthie_user_id: patient.healthie_client_id,
                    tag,
                    action: currentlyHas ? 'remove' : 'add',
                    admin_name: 'admin',
                }),
            });
            if (!res.ok) throw new Error('Failed to update tag');
            // Refresh tags
            const tagsRes = await fetch(`/ops/api/admin/patient-tags?patient_id=${patient.patient_id}`);
            const data = await tagsRes.json();
            setPatientTags(data.patientTags || []);
            setSuccessMsg(`${currentlyHas ? 'Removed' : 'Added'} tag: ${tag}`);
        } catch {
            setError('Failed to update tag');
        } finally {
            setTagActionInProgress(null);
        }
    }

    async function changeGroup(patient: PatientSummary, groupId: string) {
        try {
            const res = await fetch('/ops/api/admin/patient-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    healthie_user_id: patient.healthie_client_id,
                    group_id: groupId,
                }),
            });
            if (!res.ok) throw new Error('Failed to change group');
            setSuccessMsg(`Group changed to ${HEALTHIE_GROUPS[groupId]}`);
        } catch {
            setError('Failed to change group');
        }
    }

    async function loadWorkflowConfigs() {
        setWorkflowLoading(true);
        try {
            const res = await fetch('/ops/api/admin/service-tags');
            const data = await res.json();
            setWorkflowConfigs(data.configs || []);
        } catch {
            setError('Failed to load workflow configs');
        } finally {
            setWorkflowLoading(false);
        }
    }

    async function addWorkflowStep() {
        if (!newStep.tag || !newStep.label) return;
        try {
            const res = await fetch('/ops/api/admin/service-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newStep),
            });
            if (!res.ok) throw new Error();
            setNewStep({ tag: '', appointment_type_id: '', form_id: '', label: '' });
            setSuccessMsg('Workflow step added');
            await loadWorkflowConfigs();
        } catch {
            setError('Failed to add workflow step');
        }
    }

    async function deleteWorkflowStep(id: number) {
        try {
            const res = await fetch(`/ops/api/admin/service-tags/?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error();
            setSuccessMsg('Step removed');
            await loadWorkflowConfigs();
        } catch {
            setError('Failed to delete step');
        }
    }

    function closeModal() {
        setModalType(null);
        setSelectedPatient(null);
        setModalReason('');
        setModalNotes('');
        setHistory([]);
        setPatientTags([]);
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

            {/* Manage Workflows Section */}
            <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
                <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => { setShowWorkflowConfig(!showWorkflowConfig); if (!showWorkflowConfig && workflowConfigs.length === 0) void loadWorkflowConfigs(); }}
                >
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                        ⚙️ Manage Workflows (Tag → Services)
                    </h2>
                    <span style={{ fontSize: '1.2rem', color: '#64748b' }}>{showWorkflowConfig ? '▲' : '▼'}</span>
                </div>
                <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Define what forms and appointments each tag unlocks. When you tag a patient, these steps execute automatically.
                </p>

                {showWorkflowConfig && (
                    <div style={{ marginTop: '1rem' }}>
                        {workflowLoading ? (
                            <div style={{ padding: '1rem', color: '#64748b' }}>Loading…</div>
                        ) : (
                            <>
                                {(() => {
                                    const grouped: Record<string, any[]> = {};
                                    workflowConfigs.forEach((c: any) => {
                                        if (!grouped[c.tag]) grouped[c.tag] = [];
                                        grouped[c.tag].push(c);
                                    });
                                    const entries = Object.entries(grouped);
                                    if (entries.length === 0) {
                                        return <div style={{ padding: '1rem', color: '#64748b', fontStyle: 'italic' }}>No workflows defined. Add one below.</div>;
                                    }
                                    return entries.map(([tag, steps]) => (
                                        <div key={tag} style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0891b2', marginBottom: '0.5rem' }}>
                                                🏷 {tag}
                                            </div>
                                            {steps.map((s: any) => (
                                                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f1f5f9' }}>
                                                    <div style={{ fontSize: '0.85rem', color: '#334155' }}>
                                                        {s.label}
                                                        {s.appointment_type_id && <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.5rem' }}>(appt: {s.appointment_type_id})</span>}
                                                        {s.form_id && <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.5rem' }}>(form: {s.form_id})</span>}
                                                    </div>
                                                    <button
                                                        onClick={() => void deleteWorkflowStep(s.id)}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.8rem', fontWeight: 600 }}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ));
                                })()}

                                <div style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px dashed #94a3b8', background: '#ffffff' }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#475569', marginBottom: '0.5rem' }}>+ Add Workflow Step</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
                                        <div>
                                            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>Tag *</label>
                                            <input
                                                type="text" placeholder="e.g. sick"
                                                value={newStep.tag} onChange={(e) => setNewStep({ ...newStep, tag: e.target.value })}
                                                style={{ ...inputStyle, fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>Label *</label>
                                            <input
                                                type="text" placeholder="e.g. Sick Visit"
                                                value={newStep.label} onChange={(e) => setNewStep({ ...newStep, label: e.target.value })}
                                                style={{ ...inputStyle, fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>Appt Type ID</label>
                                            <input
                                                type="text" placeholder="optional"
                                                value={newStep.appointment_type_id} onChange={(e) => setNewStep({ ...newStep, appointment_type_id: e.target.value })}
                                                style={{ ...inputStyle, fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>Form ID</label>
                                            <input
                                                type="text" placeholder="optional"
                                                value={newStep.form_id} onChange={(e) => setNewStep({ ...newStep, form_id: e.target.value })}
                                                style={{ ...inputStyle, fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <button
                                            onClick={() => void addWorkflowStep()}
                                            disabled={!newStep.tag || !newStep.label}
                                            style={{
                                                padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                                                background: (!newStep.tag || !newStep.label) ? '#94a3b8' : '#0891b2',
                                                color: '#fff', fontWeight: 600, cursor: newStep.tag && newStep.label ? 'pointer' : 'not-allowed',
                                                fontSize: '0.85rem', whiteSpace: 'nowrap',
                                            }}
                                        >
                                            + Add
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Search & Filter */}}
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
                                    <th style={thStyle}>Group</th>
                                    <th style={thStyle}>Tags</th>
                                    <th style={thStyle}>Healthie ID</th>
                                    <th style={thStyle}>📱 First Login</th>
                                    <th style={thStyle}>Last Change</th>
                                    <th style={thStyle}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((p) => {
                                    const badge = STATUS_BADGES[p.current_status] || STATUS_BADGES.granted;
                                    return (
                                        <tr key={p.patient_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...tdStyle, fontWeight: 500 }}>
                                                {p.patient_name}
                                            </td>
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
                                                {(p as any).healthie_group_name || '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                {(() => {
                                                    const tags = (p as any).active_tags;
                                                    const tagArr = Array.isArray(tags) ? tags.filter(Boolean) : [];
                                                    return tagArr.length > 0 ? (
                                                        <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                                                            {tagArr.map((t: string) => (
                                                                <span key={t} style={{
                                                                    display: 'inline-block', padding: '0.1rem 0.4rem',
                                                                    borderRadius: '999px', fontSize: '0.7rem', fontWeight: 500,
                                                                    background: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4',
                                                                }}>{t}</span>
                                                            ))}
                                                        </div>
                                                    ) : <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>—</span>;
                                                })()}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', fontFamily: 'monospace', color: '#64748b' }}>
                                                {p.healthie_client_id || '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                {(p as any).first_app_login ? (
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '0.15rem 0.5rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 500,
                                                        background: '#eff6ff',
                                                        color: '#1d4ed8',
                                                        border: '1px solid #bfdbfe',
                                                    }}>
                                                        ✅ {formatDate((p as any).first_app_login)}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1', fontSize: '0.75rem', fontStyle: 'italic' }}>Not yet</span>
                                                )}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#64748b' }}>
                                                {p.last_changed_at ? (
                                                    <>
                                                        {formatDate(p.last_changed_at)}
                                                        {p.last_changed_by && <div style={{ fontSize: '0.75rem' }}>by {p.last_changed_by}</div>}
                                                    </>
                                                ) : '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    {p.current_status === 'granted' ? (
                                                        <ActionButton label="Revoke" color="#dc2626" bg="#fef2f2" border="#fecaca" onClick={() => openRevokeModal(p)} />
                                                    ) : (
                                                        <ActionButton label="Restore" color="#16a34a" bg="#f0fdf4" border="#bbf7d0" onClick={() => openRestoreModal(p)} />
                                                    )}
                                                    <ActionButton label="🏷 Tags" color="#0891b2" bg="#ecfeff" border="#a5f3fc" onClick={() => void openTagsModal(p)} />
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

            {/* Tags Modal */}
            {modalType === 'tags' && selectedPatient && (
                <ModalOverlay onClose={closeModal}>
                    <div style={{ ...cardStyle, maxWidth: '600px', width: '90vw', maxHeight: '80vh', overflow: 'auto' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>
                            🏷 Service Tags & Group
                        </h2>
                        <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Patient: <strong>{selectedPatient.patient_name}</strong>
                        </p>

                        {/* Group Selector */}
                        {selectedPatient.healthie_client_id && (
                            <div style={{ marginBottom: '1.25rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Healthie Group
                                </label>
                                <select
                                    onChange={(e) => { if (e.target.value) void changeGroup(selectedPatient, e.target.value); }}
                                    style={inputStyle}
                                    defaultValue=""
                                >
                                    <option value="" disabled>Select group…</option>
                                    {Object.entries(HEALTHIE_GROUPS).map(([id, name]) => (
                                        <option key={id} value={id}>{name}</option>
                                    ))}
                                </select>
                                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                    Changes the patient&apos;s group in Healthie (affects default provider)
                                </p>
                            </div>
                        )}

                        {/* Tag Toggles */}
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                Service Tags (toggle to add/remove)
                            </label>
                            {tagsLoading ? (
                                <div style={{ padding: '1rem', color: '#64748b' }}>Loading tags…</div>
                            ) : availableTags.length === 0 ? (
                                <div style={{ padding: '1rem', color: '#64748b' }}>No tags configured. Run the migration first.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {availableTags.map((at) => {
                                        const hasTag = patientTags.some(pt => pt.tag === at.tag);
                                        const isLoading = tagActionInProgress === at.tag;
                                        return (
                                            <div
                                                key={at.tag}
                                                onClick={() => !isLoading && toggleTag(selectedPatient, at.tag, hasTag)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    padding: '0.6rem 0.75rem',
                                                    borderRadius: '0.5rem',
                                                    border: hasTag ? '2px solid #0891b2' : '1px solid #e2e8f0',
                                                    background: hasTag ? '#ecfeff' : '#ffffff',
                                                    cursor: isLoading ? 'wait' : 'pointer',
                                                    opacity: isLoading ? 0.6 : 1,
                                                    transition: 'all 0.15s',
                                                }}
                                            >
                                                <span style={{ fontSize: '1.1rem' }}>{hasTag ? '✅' : '⬜'}</span>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>
                                                        {at.tag}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                                        Unlocks: {at.labels.join(', ')}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Current Tags */}
                        {patientTags.length > 0 && (
                            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#166534', marginBottom: '0.35rem' }}>Active Tags</div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    {patientTags.map((t) => (
                                        <span key={t.tag} style={{
                                            display: 'inline-block',
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: '999px',
                                            fontSize: '0.78rem',
                                            fontWeight: 500,
                                            background: '#ccfbf1',
                                            color: '#0f766e',
                                            border: '1px solid #99f6e4',
                                        }}>
                                            {t.tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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

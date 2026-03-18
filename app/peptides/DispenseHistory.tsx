'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { PeptideDispense } from '@/lib/peptideQueries';
import { withBasePath } from '@/lib/basePath';

interface DispenseHistoryProps {
    dispenses: PeptideDispense[];
}

const PAGE_SIZE = 50;

export default function DispenseHistory({ dispenses: initialDispenses }: DispenseHistoryProps) {
    const router = useRouter();
    const [updating, setUpdating] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [editingNotes, setEditingNotes] = useState<string | null>(null);
    const [notesValue, setNotesValue] = useState('');
    const [editingOrderDate, setEditingOrderDate] = useState<string | null>(null);
    const [orderDateValue, setOrderDateValue] = useState('');
    const [editingReceivedDate, setEditingReceivedDate] = useState<string | null>(null);
    const [receivedDateValue, setReceivedDateValue] = useState('');

    // Search + pagination state
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'Paid'>('all');
    const [sortBy, setSortBy] = useState<'none' | 'patient_name' | 'order_date' | 'received_date'>('none');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [dispenses, setDispenses] = useState<PeptideDispense[]>(initialDispenses);
    const [loading, setLoading] = useState(false);
    const [isServerMode, setIsServerMode] = useState(false);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Fetch from server when search/filter/pagination changes
    const fetchDispenses = useCallback(async () => {
        const hasFilters = debouncedQuery || statusFilter !== 'all' || offset > 0;
        if (!hasFilters) {
            // Reset to initial SSR data
            setDispenses(initialDispenses);
            setTotal(0);
            setIsServerMode(false);
            return;
        }

        setLoading(true);
        setIsServerMode(true);
        try {
            const params = new URLSearchParams();
            if (debouncedQuery) params.set('patient', debouncedQuery);
            if (statusFilter !== 'all') params.set('status', statusFilter);
            params.set('limit', String(PAGE_SIZE));
            params.set('offset', String(offset));

            const res = await fetch(withBasePath(`/api/peptides/dispenses?${params.toString()}`));
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setDispenses(data.dispenses);
            setTotal(data.total);
        } catch (err) {
            console.error('[DispenseHistory] fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [debouncedQuery, statusFilter, offset, initialDispenses]);

    useEffect(() => {
        fetchDispenses();
    }, [fetchDispenses]);

    // Reset to page 0 when search/filter changes
    useEffect(() => {
        setOffset(0);
    }, [debouncedQuery, statusFilter]);

    const toggleSort = (field: 'patient_name' | 'order_date' | 'received_date') => {
        if (sortBy === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir(field === 'patient_name' ? 'asc' : 'desc');
        }
    };

    const sortIndicator = (field: 'patient_name' | 'order_date' | 'received_date') =>
        sortBy === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    // Client-side sort on the current page of results
    let sortedDispenses = [...dispenses];
    if (sortBy !== 'none') {
        sortedDispenses.sort((a, b) => {
            const aVal = sortBy === 'patient_name' ? a.patient_name : (sortBy === 'order_date' ? a.order_date : a.received_date) || '';
            const bVal = sortBy === 'patient_name' ? b.patient_name : (sortBy === 'order_date' ? b.order_date : b.received_date) || '';
            const cmp = aVal.localeCompare(bVal);
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }

    // When not in server mode, apply client-side status filter for initial data
    if (!isServerMode && statusFilter !== 'all') {
        sortedDispenses = sortedDispenses.filter(d => d.status === statusFilter);
    }

    const pendingCount = initialDispenses.filter(d => d.status === 'Pending').length;
    const paidCount = initialDispenses.filter(d => d.status === 'Paid').length;

    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
    const totalPages = isServerMode ? Math.ceil(total / PAGE_SIZE) : 1;
    const displayTotal = isServerMode ? total : sortedDispenses.length;

    const updateField = async (dispenseId: string, field: string, value: unknown) => {
        setUpdating(dispenseId);
        try {
            await fetch(withBasePath('/api/peptides/dispenses'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dispense_id: dispenseId, [field]: value }),
            });
            if (isServerMode) {
                await fetchDispenses();
            } else {
                router.refresh();
            }
        } catch (error) {
            console.error('Failed to update:', error);
        } finally {
            setUpdating(null);
        }
    };

    const handleDelete = async (d: PeptideDispense) => {
        if (!confirm(`Delete dispense for ${d.patient_name} (${d.peptide_name})?\n\nThis will reverse the inventory deduction.`)) {
            return;
        }
        setDeleting(d.dispense_id);
        try {
            const res = await fetch(withBasePath('/api/peptides/dispenses'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dispense_id: d.dispense_id }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete');
            }
            if (isServerMode) {
                await fetchDispenses();
            } else {
                router.refresh();
            }
        } catch (error) {
            console.error('Failed to delete:', error);
            alert('Failed to delete dispense');
        } finally {
            setDeleting(null);
        }
    };

    const handleNotesClick = (d: PeptideDispense) => {
        setEditingNotes(d.dispense_id);
        setNotesValue(d.notes || '');
    };

    const handleNotesSave = async (dispenseId: string) => {
        await updateField(dispenseId, 'notes', notesValue);
        setEditingNotes(null);
    };

    const handleOrderDateClick = (d: PeptideDispense) => {
        setEditingOrderDate(d.dispense_id);
        setOrderDateValue(d.order_date || '');
    };

    const handleOrderDateSave = async (dispenseId: string) => {
        await updateField(dispenseId, 'order_date', orderDateValue || null);
        setEditingOrderDate(null);
    };

    const handleReceivedDateClick = (d: PeptideDispense) => {
        setEditingReceivedDate(d.dispense_id);
        setReceivedDateValue(d.received_date || '');
    };

    const handleReceivedDateSave = async (dispenseId: string) => {
        await updateField(dispenseId, 'received_date', receivedDateValue || null);
        setEditingReceivedDate(null);
    };

    return (
        <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Patient Dispense Log</h3>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Patient Search */}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search patient name..."
                        style={{
                            padding: '0.4rem 0.7rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #d1d5db',
                            fontSize: '0.8rem',
                            width: '180px',
                            outline: 'none',
                        }}
                    />

                    {/* Status Filter Buttons */}
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                            onClick={() => setStatusFilter('all')}
                            style={{
                                padding: '0.4rem 0.7rem',
                                borderRadius: '0.375rem',
                                border: 'none',
                                background: statusFilter === 'all' ? '#0ea5e9' : '#e5e7eb',
                                color: statusFilter === 'all' ? '#fff' : '#374151',
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            All ({initialDispenses.length})
                        </button>
                        <button
                            onClick={() => setStatusFilter('Pending')}
                            style={{
                                padding: '0.4rem 0.7rem',
                                borderRadius: '0.375rem',
                                border: 'none',
                                background: statusFilter === 'Pending' ? '#f59e0b' : '#e5e7eb',
                                color: statusFilter === 'Pending' ? '#fff' : '#374151',
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Pending ({pendingCount})
                        </button>
                        <button
                            onClick={() => setStatusFilter('Paid')}
                            style={{
                                padding: '0.4rem 0.7rem',
                                borderRadius: '0.375rem',
                                border: 'none',
                                background: statusFilter === 'Paid' ? '#10b981' : '#e5e7eb',
                                color: statusFilter === 'Paid' ? '#fff' : '#374151',
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Paid ({paidCount})
                        </button>
                    </div>
                    <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
                        {displayTotal} dispenses
                    </span>
                </div>
            </div>

            <div style={{
                background: '#fff',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
                overflow: 'auto',
                opacity: loading ? 0.6 : 1,
                transition: 'opacity 0.15s',
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '950px' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <th
                                style={{ ...headerStyle, cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => toggleSort('patient_name')}
                                title="Click to sort"
                            >
                                Patient{sortIndicator('patient_name')}
                            </th>
                            <th style={headerStyle}>Peptide</th>
                            <th style={{ ...headerStyle, textAlign: 'center' }}>Status</th>
                            <th
                                style={{ ...headerStyle, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => toggleSort('order_date')}
                                title="Click to sort"
                            >
                                Date Ordered{sortIndicator('order_date')}
                            </th>
                            <th
                                style={{ ...headerStyle, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => toggleSort('received_date')}
                                title="Click to sort"
                            >
                                Date Received{sortIndicator('received_date')}
                            </th>
                            <th style={{ ...headerStyle, textAlign: 'center' }}>Education</th>
                            <th style={headerStyle}>Notes</th>
                            <th style={{ ...headerStyle, textAlign: 'center', width: '80px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedDispenses.map((d) => (
                            <tr key={d.dispense_id} style={{
                                borderBottom: '1px solid #f1f5f9',
                                opacity: deleting === d.dispense_id ? 0.4 : 1,
                                transition: 'opacity 0.2s',
                            }}>
                                <td style={{ ...cellStyle, fontWeight: 500, maxWidth: '120px' }}>{d.patient_name}</td>
                                <td style={{ ...cellStyle, maxWidth: '180px', fontSize: '0.75rem' }}>{d.peptide_name}</td>

                                {/* Status */}
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    <select
                                        value={d.status}
                                        onChange={(e) => updateField(d.dispense_id, 'status', e.target.value)}
                                        disabled={updating === d.dispense_id}
                                        style={{
                                            padding: '0.25rem 0.4rem',
                                            borderRadius: '0.25rem',
                                            border: 'none',
                                            background: d.status === 'Paid' ? '#d1fae5' : '#fef3c7',
                                            color: d.status === 'Paid' ? '#065f46' : '#92400e',
                                            fontWeight: 500,
                                            fontSize: '0.7rem',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <option value="Paid">Paid</option>
                                        <option value="Pending">Pending</option>
                                    </select>
                                </td>

                                {/* Order Date - Editable */}
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    {editingOrderDate === d.dispense_id ? (
                                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                                            <input
                                                type="date"
                                                value={orderDateValue}
                                                onChange={(e) => setOrderDateValue(e.target.value)}
                                                style={{ fontSize: '0.7rem', padding: '0.2rem', width: '110px' }}
                                                autoFocus
                                            />
                                            <button onClick={() => handleOrderDateSave(d.dispense_id)} style={saveBtn}>✓</button>
                                            <button onClick={() => setEditingOrderDate(null)} style={cancelBtn}>✕</button>
                                        </div>
                                    ) : (
                                        <span
                                            onClick={() => handleOrderDateClick(d)}
                                            style={{ cursor: 'pointer', color: d.order_date ? '#374151' : '#94a3b8', fontSize: '0.75rem' }}
                                            title="Click to edit"
                                        >
                                            {d.order_date ? new Date(d.order_date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                        </span>
                                    )}
                                </td>

                                {/* Received Date - Editable */}
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    {editingReceivedDate === d.dispense_id ? (
                                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                                            <input
                                                type="date"
                                                value={receivedDateValue}
                                                onChange={(e) => setReceivedDateValue(e.target.value)}
                                                style={{ fontSize: '0.7rem', padding: '0.2rem', width: '110px' }}
                                                autoFocus
                                            />
                                            <button onClick={() => handleReceivedDateSave(d.dispense_id)} style={saveBtn}>✓</button>
                                            <button onClick={() => setEditingReceivedDate(null)} style={cancelBtn}>✕</button>
                                        </div>
                                    ) : (
                                        <span
                                            onClick={() => handleReceivedDateClick(d)}
                                            style={{ cursor: 'pointer', color: d.received_date ? '#374151' : '#94a3b8', fontSize: '0.75rem' }}
                                            title="Click to edit"
                                        >
                                            {d.received_date ? new Date(d.received_date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                        </span>
                                    )}
                                </td>

                                {/* Education Complete */}
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    <button
                                        onClick={() => updateField(d.dispense_id, 'education_complete', !d.education_complete)}
                                        disabled={updating === d.dispense_id}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: '1.1rem',
                                            cursor: updating === d.dispense_id ? 'wait' : 'pointer',
                                            opacity: updating === d.dispense_id ? 0.5 : 1,
                                        }}
                                        title={d.education_complete ? 'Education complete - click to undo' : 'Click to mark education complete'}
                                    >
                                        {d.education_complete ? '✅' : '⬜'}
                                    </button>
                                </td>

                                {/* Notes - Editable */}
                                <td style={{ ...cellStyle, minWidth: '180px' }}>
                                    {editingNotes === d.dispense_id ? (
                                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                                            <input
                                                type="text"
                                                value={notesValue}
                                                onChange={(e) => setNotesValue(e.target.value)}
                                                style={{ fontSize: '0.75rem', padding: '0.25rem', flex: 1, minWidth: '100px' }}
                                                placeholder="Add notes..."
                                                autoFocus
                                                onKeyDown={(e) => e.key === 'Enter' && handleNotesSave(d.dispense_id)}
                                            />
                                            <button onClick={() => handleNotesSave(d.dispense_id)} style={saveBtn}>✓</button>
                                            <button onClick={() => setEditingNotes(null)} style={cancelBtn}>✕</button>
                                        </div>
                                    ) : (
                                        <span
                                            onClick={() => handleNotesClick(d)}
                                            style={{
                                                cursor: 'pointer',
                                                color: d.notes ? '#374151' : '#94a3b8',
                                                fontSize: '0.75rem',
                                                display: 'block',
                                                maxWidth: '200px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                            title={d.notes || 'Click to add notes'}
                                        >
                                            {d.notes || '— click to add —'}
                                        </span>
                                    )}
                                </td>

                                {/* Actions: Print & Delete */}
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => {
                                                const params = new URLSearchParams({
                                                    type: 'peptide',
                                                    patientName: d.patient_name || '',
                                                    patientDob: d.patient_dob || '',
                                                    medication: d.peptide_name || '',
                                                    dosage: d.label_directions || 'Use as directed',
                                                    dateDispensed: d.order_date || new Date().toISOString().split('T')[0]
                                                });
                                                window.open(withBasePath(`/api/labels/generate?${params.toString()}`), '_blank');
                                            }}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                fontSize: '1.2rem',
                                                cursor: 'pointer',
                                                padding: '0.2rem',
                                            }}
                                            title="Print Label"
                                        >
                                            🖨️
                                        </button>
                                        <button
                                            onClick={() => handleDelete(d)}
                                            disabled={deleting === d.dispense_id}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                fontSize: '0.85rem',
                                                cursor: deleting === d.dispense_id ? 'wait' : 'pointer',
                                                opacity: deleting === d.dispense_id ? 0.3 : 0.5,
                                                padding: '0.2rem',
                                                transition: 'opacity 0.15s',
                                            }}
                                            title="Delete dispense"
                                            onMouseEnter={(e) => { if (deleting !== d.dispense_id) (e.target as HTMLElement).style.opacity = '1'; }}
                                            onMouseLeave={(e) => { if (deleting !== d.dispense_id) (e.target as HTMLElement).style.opacity = '0.5'; }}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {isServerMode && totalPages > 1 && (
                    <div style={{
                        padding: '0.75rem 1rem',
                        borderTop: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                                disabled={offset === 0}
                                style={{
                                    ...paginationBtn,
                                    opacity: offset === 0 ? 0.4 : 1,
                                    cursor: offset === 0 ? 'default' : 'pointer',
                                }}
                            >
                                Previous
                            </button>
                            <span style={{ fontSize: '0.8rem', color: '#374151', padding: '0.35rem 0' }}>
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => setOffset(offset + PAGE_SIZE)}
                                disabled={offset + PAGE_SIZE >= total}
                                style={{
                                    ...paginationBtn,
                                    opacity: offset + PAGE_SIZE >= total ? 0.4 : 1,
                                    cursor: offset + PAGE_SIZE >= total ? 'default' : 'pointer',
                                }}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}

                {sortedDispenses.length === 0 && !loading && (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        {searchQuery
                            ? `No dispenses found for "${searchQuery}".`
                            : statusFilter === 'all'
                                ? 'No dispenses recorded yet. Use the form above to dispense peptides to patients.'
                                : `No ${statusFilter.toLowerCase()} dispenses found.`
                        }
                    </p>
                )}
            </div>
        </div>
    );
}

const headerStyle: React.CSSProperties = { padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: '0.75rem' };
const cellStyle: React.CSSProperties = { padding: '0.5rem 0.75rem' };
const saveBtn: React.CSSProperties = { background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: '0.7rem' };
const cancelBtn: React.CSSProperties = { background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: '0.7rem' };
const paginationBtn: React.CSSProperties = { padding: '0.35rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', fontSize: '0.8rem', fontWeight: 500, color: '#374151' };

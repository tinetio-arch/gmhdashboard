'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { PeptideOrder } from '@/lib/peptideQueries';
import { withBasePath } from '@/lib/basePath';

interface OrderHistoryProps {
    orders: PeptideOrder[];
}

const PHARMACIES = ['All', 'Alpha BioMed', 'ABXTAC'] as const;
type PharmacyFilter = typeof PHARMACIES[number];

const PHARMACY_COLORS: Record<string, { bg: string; text: string }> = {
    'Alpha BioMed': { bg: '#dbeafe', text: '#1e40af' },
    'ABXTAC': { bg: '#d1fae5', text: '#065f46' },
};

export default function OrderHistory({ orders }: OrderHistoryProps) {
    const router = useRouter();
    const [isExpanded, setIsExpanded] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pharmacyFilter, setPharmacyFilter] = useState<PharmacyFilter>('All');
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<string | null>(null);

    const startEdit = (order: PeptideOrder) => {
        setEditingId(order.order_id);
        setEditQty(String(order.quantity));
        setError(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setError(null);
    };

    const saveEdit = async (order: PeptideOrder) => {
        const newQty = Number(editQty);
        if (!Number.isFinite(newQty) || newQty < 0) {
            setError('Quantity must be a non-negative number');
            return;
        }
        if (newQty === order.quantity) {
            cancelEdit();
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const prevNote = order.notes ? `${order.notes} | ` : '';
            const auditNote = `${prevNote}Edited qty ${order.quantity} → ${newQty} on ${new Date().toISOString().slice(0, 10)}`;

            const res = await fetch(withBasePath(`/api/peptides/orders/${order.order_id}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity: newQty, notes: auditNote }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setEditingId(null);
            router.refresh();
        } catch (e: any) {
            setError(e.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const triggerUpload = (orderId: string) => {
        uploadTargetRef.current = orderId;
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const orderId = uploadTargetRef.current;
        if (!file || !orderId) return;
        e.target.value = '';

        setUploadingId(orderId);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(withBasePath(`/api/peptides/orders/${orderId}/upload`), {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
            }
            router.refresh();
        } catch (e: any) {
            setError(e.message || 'Upload failed');
        } finally {
            setUploadingId(null);
        }
    };

    const viewPackingSheet = async (orderId: string) => {
        try {
            const res = await fetch(withBasePath(`/api/peptides/orders/${orderId}/upload`));
            if (!res.ok) throw new Error('Failed to fetch');
            const { url } = await res.json();
            window.open(url, '_blank');
        } catch {
            setError('Could not load packing sheet');
        }
    };

    const filteredOrders = pharmacyFilter === 'All'
        ? orders
        : orders.filter(o => o.supplier === pharmacyFilter);

    const displayOrders = isExpanded ? filteredOrders : filteredOrders.slice(0, 15);

    const pharmacyCounts = orders.reduce<Record<string, number>>((acc, o) => {
        const key = o.supplier || 'Unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return (
        <div style={{ marginTop: '2rem' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '0.75rem',
            }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
                    Order History — Pharmacy
                </h3>
                <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
                    {filteredOrders.length} orders
                </span>
            </div>

            {/* Pharmacy filter tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {PHARMACIES.map(p => {
                    const isActive = pharmacyFilter === p;
                    const count = p === 'All' ? orders.length : (pharmacyCounts[p] || 0);
                    return (
                        <button
                            key={p}
                            onClick={() => { setPharmacyFilter(p); setIsExpanded(false); }}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '0.5rem',
                                border: isActive ? '2px solid #0ea5e9' : '1px solid #e2e8f0',
                                background: isActive ? '#f0f9ff' : '#fff',
                                color: isActive ? '#0369a1' : '#64748b',
                                fontWeight: isActive ? 700 : 500,
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                transition: 'all 0.15s',
                            }}
                        >
                            {p} <span style={{ opacity: 0.6 }}>({count})</span>
                        </button>
                    );
                })}
            </div>

            {/* Hidden file input for uploads */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
            />

            <div style={{
                background: '#fff',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
                overflow: 'hidden',
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={headerStyle}>Date</th>
                            <th style={headerStyle}>PO Number</th>
                            <th style={headerStyle}>Pharmacy</th>
                            <th style={headerStyle}>Peptide</th>
                            <th style={{ ...headerStyle, textAlign: 'right' }}>Qty</th>
                            <th style={headerStyle}>Packing Sheet</th>
                            <th style={headerStyle}>Created By</th>
                            <th style={{ ...headerStyle, textAlign: 'right', width: '1%' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayOrders.map((order) => {
                            const isEditing = editingId === order.order_id;
                            const isUploading = uploadingId === order.order_id;
                            const colors = PHARMACY_COLORS[order.supplier || ''] || { bg: '#f1f5f9', text: '#475569' };
                            return (
                            <tr key={order.order_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={cellStyle}>
                                    {new Date(order.order_date).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                    })}
                                </td>
                                <td style={cellStyle}>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.25rem 0.5rem',
                                        background: order.po_number?.startsWith('ABM') ? '#dbeafe' : '#f1f5f9',
                                        borderRadius: '0.25rem',
                                        fontSize: '0.75rem',
                                        fontFamily: 'monospace',
                                    }}>
                                        {order.po_number || 'INITIAL'}
                                    </span>
                                </td>
                                <td style={cellStyle}>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.2rem 0.5rem',
                                        background: colors.bg,
                                        color: colors.text,
                                        borderRadius: '0.25rem',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                    }}>
                                        {order.supplier || 'Unknown'}
                                    </span>
                                </td>
                                <td style={cellStyle}>{order.peptide_name}</td>
                                <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            min={0}
                                            value={editQty}
                                            onChange={(e) => setEditQty(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveEdit(order);
                                                if (e.key === 'Escape') cancelEdit();
                                            }}
                                            disabled={saving}
                                            autoFocus
                                            style={{
                                                width: '5rem',
                                                padding: '0.25rem 0.5rem',
                                                border: '1px solid #0ea5e9',
                                                borderRadius: '0.25rem',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                            }}
                                        />
                                    ) : (
                                        order.quantity
                                    )}
                                </td>
                                <td style={cellStyle}>
                                    {order.packing_sheet_url ? (
                                        <button
                                            onClick={() => viewPackingSheet(order.order_id)}
                                            style={{
                                                ...actionBtnStyle('#059669'),
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.25rem',
                                            }}
                                        >
                                            View
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => triggerUpload(order.order_id)}
                                            disabled={isUploading}
                                            style={actionBtnStyle('#6366f1')}
                                        >
                                            {isUploading ? 'Uploading…' : 'Upload'}
                                        </button>
                                    )}
                                </td>
                                <td style={{ ...cellStyle, color: '#64748b' }}>
                                    {order.created_by || 'Import'}
                                </td>
                                <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={() => saveEdit(order)}
                                                disabled={saving}
                                                style={actionBtnStyle('#059669')}
                                            >
                                                {saving ? '…' : 'Save'}
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                disabled={saving}
                                                style={{ ...actionBtnStyle('#64748b'), marginLeft: '0.25rem' }}
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => startEdit(order)}
                                            title="Edit received quantity"
                                            style={actionBtnStyle('#0ea5e9')}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>

                {error && (
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        borderTop: '1px solid #fecaca',
                        fontSize: '0.875rem',
                    }}>
                        {error}
                    </div>
                )}

                {filteredOrders.length > 15 && (
                    <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid #f1f5f9' }}>
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#0ea5e9',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '0.875rem',
                            }}
                        >
                            {isExpanded ? 'Show Less' : `Show All ${filteredOrders.length} Orders`}
                        </button>
                    </div>
                )}

                {filteredOrders.length === 0 && (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        {pharmacyFilter === 'All'
                            ? 'No order history yet.'
                            : `No orders from ${pharmacyFilter} yet.`}
                    </p>
                )}
            </div>
        </div>
    );
}

const headerStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
};

const cellStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
};

const actionBtnStyle = (color: string): React.CSSProperties => ({
    background: 'transparent',
    border: `1px solid ${color}`,
    color,
    padding: '0.25rem 0.6rem',
    borderRadius: '0.25rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 600,
});

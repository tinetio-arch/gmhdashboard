'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';
import type { TirzepatideOrder, FarmakaioOrder } from '@/lib/specialtyOrderQueries';

interface SpecialtyOrderTabsProps {
    tirzepatideOrders: TirzepatideOrder[];
    farmakaioOrders: FarmakaioOrder[];
}

export default function SpecialtyOrderTabs({ tirzepatideOrders, farmakaioOrders }: SpecialtyOrderTabsProps) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'tirzepatide' | 'farmakaio'>('tirzepatide');
    const [updating, setUpdating] = useState<string | null>(null);

    const updateOrder = async (type: 'tirzepatide' | 'farmakaio', orderId: string, field: string, value: unknown) => {
        setUpdating(orderId);
        try {
            await fetch(withBasePath(`/api/specialty-orders/${type}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, [field]: value }),
            });
            router.refresh();
        } catch (error) {
            console.error('Failed to update:', error);
        } finally {
            setUpdating(null);
        }
    };

    const tabStyle = (isActive: boolean) => ({
        padding: '0.75rem 1.5rem',
        border: 'none',
        borderBottom: isActive ? '3px solid #0ea5e9' : '3px solid transparent',
        background: isActive ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
        color: isActive ? '#0369a1' : '#64748b',
        fontWeight: isActive ? 600 : 400,
        cursor: 'pointer',
        fontSize: '0.9rem',
        transition: 'all 0.2s',
    });

    return (
        <div style={{ marginTop: '2rem' }}>
            {/* Tab Headers */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
                <button style={tabStyle(activeTab === 'tirzepatide')} onClick={() => setActiveTab('tirzepatide')}>
                    💊 Tirzepatide Orders ({tirzepatideOrders.length})
                </button>
                <button style={tabStyle(activeTab === 'farmakaio')} onClick={() => setActiveTab('farmakaio')}>
                    🏭 Farmakaio Orders ({farmakaioOrders.length})
                </button>
            </div>

            {/* Tirzepatide Tab */}
            {activeTab === 'tirzepatide' && (
                <div>
                    <h3 style={{ marginBottom: '1rem' }}>💊 Tirzepatide Orders</h3>
                    <OrderTable
                        orders={tirzepatideOrders.map(o => ({
                            order_id: o.order_id,
                            patient_name: o.patient_name,
                            item_ordered: o.vials_ordered || '',
                            date_ordered: o.date_ordered,
                            status: o.status,
                            order_in_chart: o.order_in_chart,
                            ordered_to: o.ordered_to,
                            patient_received: o.patient_received,
                            notes: o.notes,
                            pdf_s3_key: o.pdf_s3_key,
                            healthie_document_id: o.healthie_document_id,
                        }))}
                        type="tirzepatide"
                        itemLabel="Vials Ordered"
                        updating={updating}
                        onUpdate={(orderId, field, value) => updateOrder('tirzepatide', orderId, field, value)}
                    />
                </div>
            )}

            {/* Farmakaio Tab */}
            {activeTab === 'farmakaio' && (
                <div>
                    <h3 style={{ marginBottom: '1rem' }}>🏭 Farmakaio Orders</h3>
                    <OrderTable
                        orders={farmakaioOrders.map(o => ({
                            order_id: o.order_id,
                            patient_name: o.patient_name,
                            item_ordered: o.medication_ordered || '',
                            date_ordered: o.date_ordered,
                            status: o.status,
                            order_in_chart: o.order_in_chart,
                            ordered_to: o.ordered_to,
                            patient_received: o.patient_received,
                            notes: o.notes,
                            pdf_s3_key: o.pdf_s3_key,
                            healthie_document_id: o.healthie_document_id,
                        }))}
                        type="farmakaio"
                        itemLabel="Medication"
                        updating={updating}
                        onUpdate={(orderId, field, value) => updateOrder('farmakaio', orderId, field, value)}
                    />
                </div>
            )}
        </div>
    );
}

interface OrderRow {
    order_id: string;
    patient_name: string;
    item_ordered: string;
    date_ordered: string | null;
    status: string;
    order_in_chart: boolean;
    ordered_to: string | null;
    patient_received: string | null;
    notes: string | null;
    pdf_s3_key: string | null;
    healthie_document_id: string | null;
}

function OrderTable({
    orders,
    type,
    itemLabel,
    updating,
    onUpdate,
}: {
    orders: OrderRow[];
    type: 'tirzepatide' | 'farmakaio';
    itemLabel: string;
    updating: string | null;
    onUpdate: (orderId: string, field: string, value: unknown) => void;
}) {
    const router = useRouter();
    const [uploading, setUploading] = useState<string | null>(null);

    const handleFileUpload = async (orderId: string, file: File) => {
        setUploading(orderId);
        try {
            const formData = new FormData();
            formData.append('order_id', orderId);
            formData.append('order_type', type);
            formData.append('file', file);

            const response = await fetch(withBasePath('/api/specialty-orders/upload'), {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Upload failed');
            router.refresh();
        } catch (error) {
            console.error('Failed to upload:', error);
            alert('Failed to upload PDF');
        } finally {
            setUploading(null);
        }
    };

    const viewPdf = async (s3Key: string) => {
        try {
            const response = await fetch(withBasePath(`/api/specialty-orders/upload?s3_key=${encodeURIComponent(s3Key)}`));
            const data = await response.json();
            if (data.url) window.open(data.url, '_blank');
        } catch {
            alert('Failed to get PDF URL');
        }
    };

    if (orders.length === 0) {
        return <p style={{ color: '#64748b' }}>No orders found.</p>;
    }

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={thStyle}>Patient</th>
                        <th style={thStyle}>{itemLabel}</th>
                        <th style={thStyle}>Date Ordered</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>In Chart</th>
                        <th style={thStyle}>Ordered To</th>
                        <th style={thStyle}>PDF</th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map((o) => (
                        <tr key={o.order_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <td style={tdStyle}>{o.patient_name}</td>
                            <td style={tdStyle}>{o.item_ordered}</td>
                            <td style={tdStyle}>{o.date_ordered ? new Date(o.date_ordered).toLocaleDateString() : '-'}</td>
                            <td style={tdStyle}>
                                <select
                                    value={o.status}
                                    onChange={(e) => onUpdate(o.order_id, 'status', e.target.value)}
                                    disabled={updating === o.order_id}
                                    style={selectStyle(o.status)}
                                >
                                    <option value="Paid">Paid</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Ordered">Ordered</option>
                                    <option value="Shipped">Shipped</option>
                                    <option value="Delivered">Delivered</option>
                                </select>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={o.order_in_chart}
                                    onChange={(e) => onUpdate(o.order_id, 'order_in_chart', e.target.checked)}
                                    disabled={updating === o.order_id}
                                    style={{ width: '1.1rem', height: '1.1rem' }}
                                />
                            </td>
                            <td style={tdStyle}>{o.ordered_to || '-'}</td>
                            <td style={tdStyle}>
                                {uploading === o.order_id ? (
                                    <span style={{ color: '#64748b' }}>Uploading...</span>
                                ) : o.pdf_s3_key ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => viewPdf(o.pdf_s3_key!)}
                                            style={{
                                                background: '#dbeafe',
                                                color: '#1d4ed8',
                                                border: 'none',
                                                borderRadius: '0.25rem',
                                                padding: '0.25rem 0.5rem',
                                                fontSize: '0.75rem',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            📄 View
                                        </button>
                                        {o.healthie_document_id && (
                                            <span title="Uploaded to Healthie" style={{ color: '#059669' }}>✅</span>
                                        )}
                                    </div>
                                ) : (
                                    <label style={{
                                        cursor: 'pointer',
                                        background: '#f1f5f9',
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '0.25rem',
                                        fontSize: '0.75rem',
                                        color: '#475569',
                                    }}>
                                        📤 Upload
                                        <input
                                            type="file"
                                            accept=".pdf"
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleFileUpload(o.order_id, file);
                                            }}
                                        />
                                    </label>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const thStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
    whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    color: '#1f2937',
};

function selectStyle(status: string): React.CSSProperties {
    const colors: Record<string, { bg: string; color: string }> = {
        Paid: { bg: '#dcfce7', color: '#166534' },
        Pending: { bg: '#fef3c7', color: '#92400e' },
        Ordered: { bg: '#dbeafe', color: '#1e40af' },
        Shipped: { bg: '#e0e7ff', color: '#4338ca' },
        Delivered: { bg: '#d1fae5', color: '#065f46' },
    };
    const c = colors[status] || colors.Pending;
    return {
        padding: '0.375rem 0.5rem',
        borderRadius: '0.375rem',
        border: 'none',
        background: c.bg,
        color: c.color,
        fontWeight: 600,
        fontSize: '0.8rem',
        cursor: 'pointer',
    };
}

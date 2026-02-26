'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';
import type { PharmacyOrder, PharmacyType } from '@/lib/specialtyOrderQueries';

interface PatientOption {
    id: string;
    name: string;
}

interface PharmacyOrderTableProps {
    orders: PharmacyOrder[];
    pharmacyType: PharmacyType;
    pharmacyName: string;
    medicationLabel?: string;
}

const ORDERED_TO_OPTIONS = [
    'Patient Home',
    'Mens Health Office',
    'NOW Primary Care Office',
];

export default function PharmacyOrderTable({ orders, pharmacyType, pharmacyName, medicationLabel = 'Medication' }: PharmacyOrderTableProps) {
    const router = useRouter();
    const [updating, setUpdating] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [uploading, setUploading] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    // Patient search state
    const [patientSearch, setPatientSearch] = useState('');
    const [patients, setPatients] = useState<PatientOption[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const [newOrder, setNewOrder] = useState({
        patient_name: '',
        medication_ordered: '',
        dose: '',
        order_number: '',
        date_ordered: new Date().toISOString().split('T')[0],
        ordered_to: 'Patient Home',
        notes: '',
        is_office_use: false,
        healthie_patient_id: '',
        healthie_patient_name: '',
    });

    // Search patients as user types (debounced)
    useEffect(() => {
        if (newOrder.is_office_use || patientSearch.length < 2) {
            setPatients([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                const res = await fetch(withBasePath(`/api/pharmacy/patients?q=${encodeURIComponent(patientSearch)}`));
                if (res.ok) {
                    const data = await res.json();
                    setPatients(data.patients || []);
                }
            } catch (e) {
                console.error('Patient search failed:', e);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [patientSearch, newOrder.is_office_use]);

    const selectPatient = (patient: PatientOption) => {
        setNewOrder({
            ...newOrder,
            patient_name: patient.name,
            healthie_patient_id: patient.id,
            healthie_patient_name: patient.name,
        });
        setPatientSearch(patient.name);
        setPatients([]);
    };

    const toggleOfficeUse = () => {
        if (!newOrder.is_office_use) {
            // Switching to office use
            setNewOrder({
                ...newOrder,
                is_office_use: true,
                patient_name: 'Office Use',
                healthie_patient_id: '',
                healthie_patient_name: '',
            });
            setPatientSearch('');
            setPatients([]);
        } else {
            // Switching back to patient
            setNewOrder({
                ...newOrder,
                is_office_use: false,
                patient_name: '',
                healthie_patient_id: '',
                healthie_patient_name: '',
            });
        }
    };

    const updateOrder = async (orderId: string, field: string, value: unknown) => {
        setUpdating(orderId);
        try {
            await fetch(withBasePath('/api/pharmacy'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pharmacy: pharmacyType, order_id: orderId, [field]: value }),
            });
            router.refresh();
        } catch (error) {
            console.error('Failed to update:', error);
        } finally {
            setUpdating(null);
        }
    };

    const deleteOrder = async (orderId: string) => {
        if (!confirm('Are you sure you want to delete this order?')) return;
        setDeleting(orderId);
        try {
            await fetch(withBasePath(`/api/pharmacy?pharmacy=${pharmacyType}&order_id=${orderId}`), {
                method: 'DELETE',
            });
            router.refresh();
        } catch (error) {
            console.error('Failed to delete:', error);
            alert('Failed to delete order');
        } finally {
            setDeleting(null);
        }
    };

    const addOrder = async () => {
        if (!newOrder.patient_name.trim()) {
            alert('Patient name is required. Search for a patient or mark as Office Use.');
            return;
        }
        try {
            await fetch(withBasePath('/api/pharmacy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pharmacy: pharmacyType, ...newOrder }),
            });
            setNewOrder({
                patient_name: '',
                medication_ordered: '',
                dose: '',
                order_number: '',
                date_ordered: new Date().toISOString().split('T')[0],
                ordered_to: 'Patient Home',
                notes: '',
                is_office_use: false,
                healthie_patient_id: '',
                healthie_patient_name: '',
            });
            setPatientSearch('');
            setShowAddForm(false);
            router.refresh();
        } catch (error) {
            console.error('Failed to add order:', error);
            alert('Failed to add order');
        }
    };

    const handleFileUpload = async (orderId: string, file: File) => {
        setUploading(orderId);
        try {
            const formData = new FormData();
            formData.append('order_id', orderId);
            formData.append('order_type', pharmacyType);
            formData.append('file', file);

            const response = await fetch(withBasePath('/api/pharmacy/upload'), {
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
            const response = await fetch(withBasePath(`/api/pharmacy/upload?s3_key=${encodeURIComponent(s3Key)}`));
            const data = await response.json();
            if (data.url) window.open(data.url, '_blank');
        } catch {
            alert('Failed to get PDF URL');
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', margin: 0 }}>{pharmacyName} Orders</h2>
                    <p style={{ color: '#64748b', margin: '0.25rem 0 0' }}>{orders.length} total orders</p>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    style={{
                        background: showAddForm ? '#ef4444' : '#0ea5e9',
                        color: 'white',
                        border: 'none',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '0.5rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    {showAddForm ? '✕ Cancel' : '+ Add Order'}
                </button>
            </div>

            {/* Add Order Form */}
            {showAddForm && (
                <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                    marginBottom: '1.5rem',
                }}>
                    <h3 style={{ margin: '0 0 1rem' }}>New Order</h3>

                    {/* Office Use Toggle */}
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={newOrder.is_office_use}
                                onChange={toggleOfficeUse}
                                style={{ width: '1.1rem', height: '1.1rem' }}
                            />
                            <span style={{ fontWeight: 600, color: '#374151' }}>Office Use Order (no patient)</span>
                        </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                        {/* Patient Search */}
                        {!newOrder.is_office_use && (
                            <div style={{ position: 'relative' }}>
                                <label style={labelStyle}>Patient Name *</label>
                                <input
                                    type="text"
                                    value={patientSearch}
                                    onChange={(e) => {
                                        setPatientSearch(e.target.value);
                                        setNewOrder({ ...newOrder, patient_name: '', healthie_patient_id: '', healthie_patient_name: '' });
                                    }}
                                    style={inputStyle}
                                    placeholder="Search Healthie patients..."
                                />
                                {/* Patient dropdown */}
                                {patientSearch.length >= 2 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        right: 0,
                                        maxHeight: '200px',
                                        overflow: 'auto',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.375rem',
                                        backgroundColor: '#fff',
                                        zIndex: 10,
                                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
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
                                                onClick={() => selectPatient(p)}
                                                style={{
                                                    padding: '0.75rem',
                                                    cursor: 'pointer',
                                                    borderBottom: '1px solid #f1f5f9',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            >
                                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {newOrder.healthie_patient_id && (
                                    <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '0.25rem' }}>
                                        ✓ Linked to Healthie: {newOrder.healthie_patient_name}
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label style={labelStyle}>{medicationLabel}</label>
                            <input
                                type="text"
                                value={newOrder.medication_ordered}
                                onChange={(e) => setNewOrder({ ...newOrder, medication_ordered: e.target.value })}
                                style={inputStyle}
                                placeholder="e.g., Tirzepatide, Semaglutide"
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Dose</label>
                            <input
                                type="text"
                                value={newOrder.dose}
                                onChange={(e) => setNewOrder({ ...newOrder, dose: e.target.value })}
                                style={inputStyle}
                                placeholder="e.g., 2.5mg, 5mg"
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Order #</label>
                            <input
                                type="text"
                                value={newOrder.order_number}
                                onChange={(e) => setNewOrder({ ...newOrder, order_number: e.target.value })}
                                style={inputStyle}
                                placeholder="e.g., ORD-12345"
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Date Ordered</label>
                            <input
                                type="date"
                                value={newOrder.date_ordered}
                                onChange={(e) => setNewOrder({ ...newOrder, date_ordered: e.target.value })}
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Ordered To</label>
                            <select
                                value={newOrder.ordered_to}
                                onChange={(e) => setNewOrder({ ...newOrder, ordered_to: e.target.value })}
                                style={inputStyle}
                            >
                                {ORDERED_TO_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                        <label style={labelStyle}>Notes</label>
                        <textarea
                            value={newOrder.notes}
                            onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                            placeholder="Optional notes"
                        />
                    </div>
                    <button
                        onClick={addOrder}
                        style={{
                            marginTop: '1rem',
                            background: '#10b981',
                            color: 'white',
                            border: 'none',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '0.5rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        ✓ Save Order
                    </button>
                </div>
            )}

            {/* Orders Table */}
            {orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    <p>No orders yet. Click "Add Order" to create one.</p>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                <th style={thStyle}>Patient</th>
                                <th style={thStyle}>{medicationLabel}</th>
                                <th style={thStyle}>Dose</th>
                                <th style={thStyle}>Order #</th>
                                <th style={thStyle}>Date</th>
                                <th style={thStyle}>Ordered To</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>In Chart</th>
                                <th style={thStyle}>PDF</th>
                                <th style={thStyle}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((o) => (
                                <tr key={o.order_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                    <td style={tdStyle}>
                                        <div>{o.patient_name}</div>
                                        {o.is_office_use && (
                                            <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                                Office Use
                                            </span>
                                        )}
                                        {o.healthie_patient_id && !o.is_office_use && (
                                            <span style={{ fontSize: '0.7rem', color: '#059669' }}>✓ Healthie</span>
                                        )}
                                    </td>
                                    <td style={tdStyle}>{o.medication_ordered || '-'}</td>
                                    <td style={tdStyle}>{o.dose || '-'}</td>
                                    <td style={tdStyle}>{o.order_number || '-'}</td>
                                    <td style={tdStyle}>{o.date_ordered ? new Date(o.date_ordered).toLocaleDateString() : '-'}</td>
                                    <td style={tdStyle}>
                                        <select
                                            value={o.ordered_to || 'Patient Home'}
                                            onChange={(e) => updateOrder(o.order_id, 'ordered_to', e.target.value)}
                                            disabled={updating === o.order_id}
                                            style={{ ...inputStyle, padding: '0.25rem', fontSize: '0.8rem' }}
                                        >
                                            {ORDERED_TO_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td style={tdStyle}>
                                        <select
                                            value={o.status}
                                            onChange={(e) => updateOrder(o.order_id, 'status', e.target.value)}
                                            disabled={updating === o.order_id}
                                            style={selectStyle(o.status)}
                                        >
                                            <option value="Pending">Pending</option>
                                            <option value="Paid">Paid</option>
                                            <option value="Ordered">Ordered</option>
                                            <option value="Shipped">Shipped</option>
                                            <option value="Delivered">Delivered</option>
                                        </select>
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={o.order_in_chart}
                                            onChange={(e) => updateOrder(o.order_id, 'order_in_chart', e.target.checked)}
                                            disabled={updating === o.order_id}
                                            style={{ width: '1.1rem', height: '1.1rem' }}
                                        />
                                    </td>
                                    <td style={tdStyle}>
                                        {uploading === o.order_id ? (
                                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Uploading...</span>
                                        ) : o.pdf_s3_key ? (
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
                                        ) : (
                                            <label style={{
                                                cursor: 'pointer',
                                                background: '#f1f5f9',
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: '0.25rem',
                                                fontSize: '0.75rem',
                                                color: '#475569',
                                                display: 'inline-block',
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
                                    <td style={tdStyle}>
                                        <button
                                            onClick={() => deleteOrder(o.order_id)}
                                            disabled={deleting === o.order_id}
                                            style={{
                                                background: '#fee2e2',
                                                color: '#dc2626',
                                                border: 'none',
                                                borderRadius: '0.25rem',
                                                padding: '0.25rem 0.5rem',
                                                fontSize: '0.75rem',
                                                cursor: deleting === o.order_id ? 'not-allowed' : 'pointer',
                                                opacity: deleting === o.order_id ? 0.5 : 1,
                                            }}
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '0.25rem',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.375rem',
    fontSize: '0.9rem',
};

const thStyle: React.CSSProperties = {
    padding: '0.75rem 0.5rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
    whiteSpace: 'nowrap',
    fontSize: '0.8rem',
};

const tdStyle: React.CSSProperties = {
    padding: '0.75rem 0.5rem',
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

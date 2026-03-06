'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';

function withBasePath(path: string) {
    return `/ops${path}`;
}

type Shipment = {
    id: number;
    patient_id: string;
    patient_name: string;
    tracking_number: string;
    shipment_id: string | null;
    service_code: string;
    service_name: string | null;
    status: string;
    ship_to_name: string;
    ship_to_address: string;
    ship_to_city: string | null;
    ship_to_state: string | null;
    ship_to_zip: string | null;
    package_weight: number | null;
    package_description: string | null;
    shipping_cost: number | null;
    estimated_delivery: string | null;
    actual_delivery: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    voided_at: string | null;
    notes: string | null;
};

type Stats = {
    total: number;
    active: number;
    voided: number;
    delivered: number;
    totalCost: number;
};

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    'label created': { bg: 'rgba(59, 130, 246, 0.12)', text: '#2563eb', label: 'Label Created' },
    'in transit': { bg: 'rgba(245, 158, 11, 0.12)', text: '#d97706', label: 'In Transit' },
    delivered: { bg: 'rgba(34, 197, 94, 0.12)', text: '#16a34a', label: 'Delivered' },
    voided: { bg: 'rgba(239, 68, 68, 0.12)', text: '#dc2626', label: 'Voided' },
};

function StatusBadge({ status }: { status: string }) {
    const config = STATUS_COLORS[status] || { bg: 'rgba(148,163,184,0.12)', text: '#64748b', label: status };
    return (
        <span
            style={{
                display: 'inline-block',
                padding: '0.25rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: config.bg,
                color: config.text,
                textTransform: 'capitalize',
                letterSpacing: '0.02em',
            }}
        >
            {config.label}
        </span>
    );
}

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
    return (
        <div
            style={{
                background: 'white',
                borderRadius: '0.75rem',
                padding: '1.25rem 1.5rem',
                border: '1px solid rgba(148, 163, 184, 0.15)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                flex: '1 1 0',
                minWidth: '160px',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>{icon}</span>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>{label}</span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</div>
        </div>
    );
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatCurrency(amount: number | string | null | undefined): string {
    if (amount == null) return '—';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '—';
    return `$${num.toFixed(2)}`;
}

export default function ShipmentsAdminClient() {
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [stats, setStats] = useState<Stats>({ total: 0, active: 0, voided: 0, delivered: 0, totalCost: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedRow, setExpandedRow] = useState<number | null>(null);

    const fetchShipments = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const filterParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
            const res = await fetch(withBasePath(`/api/admin/shipments?limit=500${filterParam}`));
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to fetch');
            }
            const data = await res.json();
            setShipments(data.shipments);
            setStats(data.stats);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        fetchShipments();
    }, [fetchShipments]);

    const filtered = shipments.filter((s) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            s.patient_name?.toLowerCase().includes(term) ||
            s.tracking_number?.toLowerCase().includes(term) ||
            s.ship_to_city?.toLowerCase().includes(term) ||
            s.ship_to_state?.toLowerCase().includes(term) ||
            s.created_by?.toLowerCase().includes(term)
        );
    });

    const handleTrack = (trackingNumber: string) => {
        window.open(`https://www.ups.com/track?tracknum=${trackingNumber}`, '_blank');
    };

    const handleVoid = async (shipmentId: number) => {
        if (!confirm('Are you sure you want to void this shipment?')) return;
        try {
            const res = await fetch(withBasePath('/api/ups/void'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shipmentDbId: shipmentId }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Void failed');
            }
            fetchShipments();
        } catch (err: any) {
            alert(`Failed to void: ${err.message}`);
        }
    };

    const handlePrintLabel = (labelData: string | null, labelFormat: string | null) => {
        if (!labelData) {
            alert('No label data available');
            return;
        }
        const mimeType = labelFormat === 'GIF' ? 'image/gif' : 'image/png';
        const win = window.open('', '_blank');
        if (win) {
            win.document.write(`
        <html>
          <head><title>UPS Shipping Label</title></head>
          <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f8fafc;">
            <img src="data:${mimeType};base64,${labelData}" style="max-width:4in;border:1px solid #e2e8f0;" />
          </body>
        </html>
      `);
            win.document.close();
            setTimeout(() => win.print(), 500);
        }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Page Header */}
            <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '2rem' }}>📦</span>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                        UPS Shipments
                    </h1>
                </div>
                <p style={{ color: '#64748b', margin: 0, fontSize: '0.95rem' }}>
                    All outgoing shipments, costs, and tracking information
                </p>
            </div>

            {/* Stats Cards */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <StatCard icon="📊" label="Total Shipments" value={stats.total} color="#0f172a" />
                <StatCard icon="🚚" label="Active" value={stats.active} color="#2563eb" />
                <StatCard icon="✅" label="Delivered" value={stats.delivered} color="#16a34a" />
                <StatCard icon="❌" label="Voided" value={stats.voided} color="#dc2626" />
                <StatCard icon="💰" label="Total Shipping Cost" value={formatCurrency(stats.totalCost)} color="#7c3aed" />
            </div>

            {/* Filters Bar */}
            <div
                style={{
                    display: 'flex',
                    gap: '1rem',
                    marginBottom: '1rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    background: 'white',
                    padding: '1rem 1.25rem',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
            >
                <input
                    type="text"
                    placeholder="🔍 Search patient, tracking #, city, state..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        flex: '1 1 250px',
                        padding: '0.6rem 1rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '0.9rem',
                        outline: 'none',
                    }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['all', 'label created', 'in transit', 'delivered', 'voided'].map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            style={{
                                padding: '0.5rem 1rem',
                                border: '1px solid',
                                borderColor: statusFilter === s ? '#2563eb' : '#e2e8f0',
                                borderRadius: '0.5rem',
                                fontSize: '0.8rem',
                                fontWeight: statusFilter === s ? 600 : 400,
                                cursor: 'pointer',
                                backgroundColor: statusFilter === s ? 'rgba(37, 99, 235, 0.08)' : 'white',
                                color: statusFilter === s ? '#2563eb' : '#64748b',
                                textTransform: 'capitalize',
                                transition: 'all 0.15s',
                            }}
                        >
                            {s === 'all' ? 'All' : s}
                        </button>
                    ))}
                </div>
                <button
                    onClick={fetchShipments}
                    style={{
                        padding: '0.5rem 1rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        backgroundColor: 'white',
                        color: '#475569',
                    }}
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Error */}
            {error && (
                <div
                    style={{
                        padding: '1rem',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '0.5rem',
                        color: '#dc2626',
                        marginBottom: '1rem',
                        fontSize: '0.9rem',
                    }}
                >
                    ⚠️ {error}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    Loading shipments...
                </div>
            )}

            {/* Table */}
            {!loading && (
                <div
                    style={{
                        background: 'white',
                        borderRadius: '0.75rem',
                        border: '1px solid rgba(148, 163, 184, 0.15)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        overflow: 'hidden',
                    }}
                >
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr
                                    style={{
                                        borderBottom: '2px solid #e2e8f0',
                                        background: '#f8fafc',
                                    }}
                                >
                                    <th style={thStyle}>Date</th>
                                    <th style={thStyle}>Patient</th>
                                    <th style={thStyle}>Tracking #</th>
                                    <th style={thStyle}>Service</th>
                                    <th style={thStyle}>Destination</th>
                                    <th style={thStyle}>Weight</th>
                                    <th style={thStyle}>Cost</th>
                                    <th style={thStyle}>Status</th>
                                    <th style={thStyle}>Shipped By</th>
                                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={10}
                                            style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}
                                        >
                                            No shipments found
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map((s) => (
                                        <Fragment key={s.id}>
                                            <tr
                                                style={{
                                                    borderBottom: '1px solid #f1f5f9',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.1s',
                                                    backgroundColor: expandedRow === s.id ? '#f8fafc' : undefined,
                                                }}
                                                onClick={() => setExpandedRow(expandedRow === s.id ? null : s.id)}
                                                onMouseOver={(e) => {
                                                    if (expandedRow !== s.id) e.currentTarget.style.backgroundColor = '#fafbfc';
                                                }}
                                                onMouseOut={(e) => {
                                                    if (expandedRow !== s.id) e.currentTarget.style.backgroundColor = '';
                                                }}
                                            >
                                                <td style={tdStyle}>
                                                    <div>{formatDate(s.created_at)}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                                        {formatTime(s.created_at)}
                                                    </div>
                                                </td>
                                                <td style={{ ...tdStyle, fontWeight: 600, color: '#0f172a' }}>
                                                    {s.patient_name}
                                                </td>
                                                <td style={tdStyle}>
                                                    <span
                                                        style={{
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.8rem',
                                                            color: '#2563eb',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleTrack(s.tracking_number);
                                                        }}
                                                        title="Click to track on UPS.com"
                                                    >
                                                        {s.tracking_number}
                                                    </span>
                                                </td>
                                                <td style={tdStyle}>{s.service_name || s.service_code}</td>
                                                <td style={tdStyle}>
                                                    {s.ship_to_city && s.ship_to_state
                                                        ? `${s.ship_to_city}, ${s.ship_to_state} ${s.ship_to_zip || ''}`
                                                        : s.ship_to_address}
                                                </td>
                                                <td style={tdStyle}>
                                                    {s.package_weight ? `${s.package_weight} lbs` : '—'}
                                                </td>
                                                <td style={{ ...tdStyle, fontWeight: 600 }}>
                                                    {formatCurrency(s.shipping_cost)}
                                                </td>
                                                <td style={tdStyle}>
                                                    <StatusBadge status={s.status} />
                                                </td>
                                                <td style={tdStyle}>
                                                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                        {s.created_by || '—'}
                                                    </span>
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                    <div
                                                        style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <button
                                                            onClick={() => handleTrack(s.tracking_number)}
                                                            style={actionBtnStyle}
                                                            title="Track on UPS.com"
                                                        >
                                                            📍
                                                        </button>
                                                        <button
                                                            onClick={() => handlePrintLabel(s.label_data ?? null, s.label_format ?? null)}
                                                            style={actionBtnStyle}
                                                            title="Print Label"
                                                        >
                                                            🖨️
                                                        </button>
                                                        {s.status !== 'voided' && (
                                                            <button
                                                                onClick={() => handleVoid(s.id)}
                                                                style={{ ...actionBtnStyle, color: '#dc2626' }}
                                                                title="Void Shipment"
                                                            >
                                                                ✕
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {expandedRow === s.id && (
                                                <tr key={`${s.id}-detail`}>
                                                    <td colSpan={10} style={{ padding: '0 1rem 1rem 1rem', background: '#f8fafc' }}>
                                                        <div
                                                            style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                                                gap: '1rem',
                                                                padding: '1rem',
                                                                background: 'white',
                                                                borderRadius: '0.5rem',
                                                                border: '1px solid #e2e8f0',
                                                                fontSize: '0.85rem',
                                                            }}
                                                        >
                                                            <div>
                                                                <strong style={{ color: '#475569' }}>Ship To:</strong>
                                                                <div>{s.ship_to_name}</div>
                                                                <div>{s.ship_to_address}</div>
                                                                <div>
                                                                    {s.ship_to_city}, {s.ship_to_state} {s.ship_to_zip}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <strong style={{ color: '#475569' }}>Package:</strong>
                                                                <div>{s.package_description || 'Medical Supplies'}</div>
                                                                <div>{s.package_weight ? `${s.package_weight} lbs` : '—'}</div>
                                                            </div>
                                                            <div>
                                                                <strong style={{ color: '#475569' }}>Delivery:</strong>
                                                                <div>
                                                                    Est: {s.estimated_delivery ? formatDate(s.estimated_delivery) : 'N/A'}
                                                                </div>
                                                                <div>
                                                                    Actual:{' '}
                                                                    {s.actual_delivery ? formatDate(s.actual_delivery) : 'Pending'}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <strong style={{ color: '#475569' }}>Shipment ID:</strong>
                                                                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                                                    {s.shipment_id || '—'}
                                                                </div>
                                                                {s.voided_at && (
                                                                    <div style={{ color: '#dc2626', marginTop: '0.25rem' }}>
                                                                        Voided: {formatDate(s.voided_at)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {s.notes && (
                                                                <div style={{ gridColumn: '1 / -1' }}>
                                                                    <strong style={{ color: '#475569' }}>Notes:</strong>
                                                                    <div>{s.notes}</div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer */}
                    <div
                        style={{
                            padding: '0.75rem 1rem',
                            borderTop: '1px solid #f1f5f9',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.8rem',
                            color: '#94a3b8',
                            background: '#fafbfc',
                        }}
                    >
                        <span>
                            Showing {filtered.length} of {shipments.length} shipments
                        </span>
                        <span>
                            Click a row for details • Tracking # links to UPS.com
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

const thStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#475569',
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
};

const actionBtnStyle: React.CSSProperties = {
    background: 'none',
    border: '1px solid #e2e8f0',
    borderRadius: '0.375rem',
    padding: '0.3rem 0.5rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    lineHeight: 1,
    transition: 'background 0.15s',
};

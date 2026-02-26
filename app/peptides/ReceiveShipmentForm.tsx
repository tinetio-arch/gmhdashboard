'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';

interface ReceiveShipmentFormProps {
    productOptions: { value: string; label: string }[];
}

export default function ReceiveShipmentForm({ productOptions }: ReceiveShipmentFormProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [productId, setProductId] = useState('');
    const [quantity, setQuantity] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [poNumber, setPoNumber] = useState('');
    const [notes, setNotes] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(withBasePath('/api/peptides/orders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: productId,
                    quantity: Number(quantity),
                    order_date: orderDate,
                    po_number: poNumber || null,
                    notes: notes || null,
                }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to record shipment');
            }

            // Reset form
            setProductId('');
            setQuantity('');
            setPoNumber('');
            setNotes('');
            setIsOpen(false);

            // Refresh page to show updated inventory
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginBottom: '1.5rem',
                    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.25)',
                }}
            >
                📦 Receive Shipment
            </button>
        );
    }

    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>📦 Receive Shipment</h3>
                <button
                    onClick={() => setIsOpen(false)}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.25rem',
                        cursor: 'pointer',
                        color: '#64748b',
                    }}
                >
                    ✕
                </button>
            </div>

            {error && (
                <div style={{
                    background: '#fee2e2',
                    border: '1px solid #ef4444',
                    borderRadius: '0.5rem',
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    color: '#dc2626',
                }}>
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    {/* Product Select */}
                    <div>
                        <label style={labelStyle}>Peptide *</label>
                        <select
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                            required
                            style={inputStyle}
                        >
                            <option value="">Select peptide...</option>
                            {productOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Quantity */}
                    <div>
                        <label style={labelStyle}>Quantity (Vials) *</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            required
                            min="1"
                            style={inputStyle}
                            placeholder="e.g., 5"
                        />
                    </div>

                    {/* Order Date */}
                    <div>
                        <label style={labelStyle}>Order Date *</label>
                        <input
                            type="date"
                            value={orderDate}
                            onChange={(e) => setOrderDate(e.target.value)}
                            required
                            style={inputStyle}
                        />
                    </div>

                    {/* PO Number */}
                    <div>
                        <label style={labelStyle}>PO Number</label>
                        <input
                            type="text"
                            value={poNumber}
                            onChange={(e) => setPoNumber(e.target.value)}
                            style={inputStyle}
                            placeholder="e.g., ABM-75402"
                        />
                    </div>
                </div>

                {/* Notes */}
                <div style={{ marginTop: '1rem' }}>
                    <label style={labelStyle}>Notes</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                        placeholder="Optional notes about this shipment..."
                    />
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            padding: '0.75rem 1.5rem',
                            background: loading ? '#94a3b8' : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '0.5rem',
                            fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {loading ? 'Saving...' : '✅ Record Shipment'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        style={{
                            padding: '0.75rem 1.5rem',
                            background: '#f1f5f9',
                            color: '#475569',
                            border: 'none',
                            borderRadius: '0.5rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    fontSize: '0.875rem',
    boxSizing: 'border-box',
};

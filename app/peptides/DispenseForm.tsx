'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';

interface DispenseFormProps {
    productOptions: { value: string; label: string }[];
}

interface PatientSearchResult {
    id: string;
    first_name: string;
    last_name: string;
    dob: string | null;
}

export default function DispenseForm({ productOptions }: DispenseFormProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Patient search state
    const [patientQuery, setPatientQuery] = useState('');
    const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
    const searchRef = useRef<HTMLDivElement>(null);

    // Form state
    const [productId, setProductId] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [receivedDate, setReceivedDate] = useState('');
    const [status, setStatus] = useState<'Paid' | 'Pending'>('Paid');
    const [educationComplete, setEducationComplete] = useState(false);
    const [notes, setNotes] = useState('');

    // Patient search with debounce
    useEffect(() => {
        if (!patientQuery || patientQuery.length < 3 || selectedPatient) {
            setPatientResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                const res = await fetch(`/ops/api/patients/search?q=${encodeURIComponent(patientQuery)}`);
                const data = await res.json();
                if (data.patients) {
                    setPatientResults(data.patients.map((p: any) => ({
                        id: p.id,
                        first_name: p.first_name,
                        last_name: p.last_name,
                        dob: p.dob,
                    })));
                    setShowDropdown(true);
                }
            } catch (err) {
                console.error('Patient search error:', err);
            } finally {
                setIsSearching(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [patientQuery, selectedPatient]);

    // Close dropdown on click outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selectPatient = (p: PatientSearchResult) => {
        setSelectedPatient(p);
        setPatientQuery(`${p.first_name} ${p.last_name}`);
        setShowDropdown(false);
    };

    const clearPatient = () => {
        setSelectedPatient(null);
        setPatientQuery('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPatient) {
            setError('Please select a patient from the search results');
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(withBasePath('/api/peptides/dispenses'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: productId,
                    patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
                    patient_dob: selectedPatient.dob || null,
                    quantity: Number(quantity),
                    order_date: orderDate || null,
                    received_date: receivedDate || null,
                    status,
                    education_complete: educationComplete,
                    notes: notes || null,
                }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to record dispense');
            }

            // Reset form
            clearPatient();
            setProductId('');
            setQuantity('1');
            setOrderDate(new Date().toISOString().split('T')[0]);
            setReceivedDate('');
            setStatus('Paid');
            setEducationComplete(false);
            setNotes('');
            setIsOpen(false);

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
                    background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)',
                }}
            >
                💉 Dispense to Patient
            </button>
        );
    }

    return (
        <div style={{
            background: '#fff',
            border: '2px solid #059669',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, color: '#059669' }}>💉 Dispense Peptide to Patient</h3>
                <button
                    onClick={() => setIsOpen(false)}
                    style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
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
                    {/* Patient Search */}
                    <div ref={searchRef} style={{ position: 'relative' }}>
                        <label style={labelStyle}>Patient Name * {isSearching && '🔍'}</label>
                        {selectedPatient ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                padding: '0.625rem 0.75rem', borderRadius: '0.375rem',
                                border: '1px solid #059669', background: '#ecfdf5', fontSize: '0.875rem',
                            }}>
                                <span style={{ flex: 1 }}>✅ {selectedPatient.first_name} {selectedPatient.last_name}</span>
                                <button type="button" onClick={clearPatient} style={{
                                    background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1rem'
                                }}>✕</button>
                            </div>
                        ) : (
                            <input
                                type="text"
                                value={patientQuery}
                                onChange={(e) => { setPatientQuery(e.target.value); setSelectedPatient(null); }}
                                style={inputStyle}
                                placeholder="Type 3+ letters to search..."
                                autoComplete="off"
                            />
                        )}
                        {showDropdown && patientResults.length > 0 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                                background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.375rem',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: '250px', overflowY: 'auto',
                            }}>
                                {patientResults.map(p => (
                                    <div key={p.id} onClick={() => selectPatient(p)}
                                        style={{
                                            padding: '0.6rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                                            display: 'flex', justifyContent: 'space-between',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f0fdf4')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                                    >
                                        <span style={{ fontWeight: 500 }}>{p.first_name} {p.last_name}</span>
                                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                            DOB: {p.dob || 'N/A'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* DOB Display (read-only from Healthie) */}
                    <div>
                        <label style={labelStyle}>Date of Birth</label>
                        <input
                            type="text"
                            value={selectedPatient?.dob || '—'}
                            readOnly
                            style={{ ...inputStyle, background: '#f1f5f9', color: '#64748b' }}
                        />
                    </div>

                    {/* Peptide Select */}
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
                        <label style={labelStyle}>Vials</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            min="1"
                            style={inputStyle}
                        />
                    </div>

                    {/* Status */}
                    <div>
                        <label style={labelStyle}>Status *</label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value as 'Paid' | 'Pending')}
                            style={inputStyle}
                        >
                            <option value="Paid">Paid</option>
                            <option value="Pending">Pending</option>
                        </select>
                    </div>

                    {/* Order Date */}
                    <div>
                        <label style={labelStyle}>Date Ordered</label>
                        <input
                            type="date"
                            value={orderDate}
                            onChange={(e) => setOrderDate(e.target.value)}
                            style={inputStyle}
                        />
                    </div>

                    {/* Received Date */}
                    <div>
                        <label style={labelStyle}>Date Received</label>
                        <input
                            type="date"
                            value={receivedDate}
                            onChange={(e) => setReceivedDate(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                </div>

                {/* Education Complete Checkbox */}
                <div style={{ marginTop: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={educationComplete}
                            onChange={(e) => setEducationComplete(e.target.checked)}
                            style={{ width: '1.25rem', height: '1.25rem' }}
                        />
                        <span style={{ fontWeight: 500 }}>Education and pick up complete</span>
                    </label>
                    <p style={{ margin: '0.25rem 0 0 1.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                        Check when patient has received education and picked up the peptide
                    </p>
                </div>

                {/* Notes */}
                <div style={{ marginTop: '1rem' }}>
                    <label style={labelStyle}>Notes</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                        placeholder="e.g., P/U Scheduled 06/04, Owe Vial..."
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
                        {loading ? 'Saving...' : '✅ Record Dispense'}
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

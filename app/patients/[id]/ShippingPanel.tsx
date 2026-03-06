'use client';

import { useState, useCallback } from 'react';
import { withBasePath } from '@/lib/basePath';

// ─── Types ───────────────────────────────────────────────────────────────────

type ShipmentRecord = {
    id: number;
    patient_id: string;
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
    label_format: string | null;
    label_data: string | null;
    estimated_delivery: string | null;
    created_by: string | null;
    created_at: string;
    voided_at: string | null;
    notes: string | null;
};

type RateOption = {
    serviceCode: string;
    serviceName: string;
    totalCharges: string;
    currency: string;
    guaranteedDays?: string;
};

type AddressCandidate = {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    classification: string;
    confidence: number;
};

type TrackingInfo = {
    currentStatus: string;
    statusCode: string;
    estimatedDelivery?: string;
    activities: { status: string; location: string; date: string; time: string }[];
};

type Props = {
    patientId: string;
    patientName: string;
    address: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    initialShipments: ShipmentRecord[];
};

// ─── Common Package Presets ──────────────────────────────────────────────────

const PACKAGE_PRESETS = [
    { label: 'TRT Supply Kit', weight: 0.4 },
    { label: 'Syringes & Needles', weight: 0.4 },
    { label: 'Medical Supplies', weight: 0.4 },
    { label: 'Custom', weight: 0 },
];

// Standard package dimensions (inches)
const DEFAULT_DIMENSIONS = { length: 12, width: 8, height: 3 };

// ─── Component ───────────────────────────────────────────────────────────────

export default function ShippingPanel({
    patientId,
    patientName,
    address,
    addressLine1,
    city,
    state,
    postalCode,
    phone,
    initialShipments,
}: Props) {
    // Form state
    const [showForm, setShowForm] = useState(false);
    const [addrLine1, setAddrLine1] = useState(addressLine1 || '');
    const [addrCity, setAddrCity] = useState(city || '');
    const [addrState, setAddrState] = useState(state || '');
    const [addrZip, setAddrZip] = useState(postalCode || '');
    const [packageWeight, setPackageWeight] = useState(0.4);
    const [packageDesc, setPackageDesc] = useState('TRT Supply Kit');
    const [notes, setNotes] = useState('');

    // Address validation
    const [validating, setValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<{ valid: boolean; candidates: AddressCandidate[] } | null>(null);

    // Rating
    const [gettingRates, setGettingRates] = useState(false);
    const [rates, setRates] = useState<RateOption[]>([]);
    const [selectedService, setSelectedService] = useState('03'); // UPS Ground default

    // Shipping
    const [shipping, setShipping] = useState(false);
    const [shipResult, setShipResult] = useState<{ trackingNumber: string; totalCharges: string; labelData?: string } | null>(null);

    // Shipment history
    const [shipments, setShipments] = useState<ShipmentRecord[]>(initialShipments);
    const [trackingInfo, setTrackingInfo] = useState<Record<string, TrackingInfo>>({});
    const [trackingLoading, setTrackingLoading] = useState<Record<string, boolean>>({});
    const [voidingId, setVoidingId] = useState<number | null>(null);

    // Error
    const [error, setError] = useState('');

    // ── API Calls ────────────────────────────────────────────────────────────

    const handleValidateAddress = useCallback(async () => {
        setValidating(true);
        setError('');
        setValidationResult(null);
        try {
            const res = await fetch(withBasePath('/api/ups/validate-address'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    addressLine1: addrLine1,
                    city: addrCity,
                    state: addrState,
                    postalCode: addrZip,
                    countryCode: 'US',
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Validation failed');
            setValidationResult(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setValidating(false);
        }
    }, [addrLine1, addrCity, addrState, addrZip]);

    const handleGetRates = useCallback(async () => {
        setGettingRates(true);
        setError('');
        setRates([]);
        try {
            const res = await fetch(withBasePath('/api/ups/rate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shipTo: {
                        name: patientName,
                        addressLine1: addrLine1,
                        city: addrCity,
                        state: addrState,
                        postalCode: addrZip,
                        countryCode: 'US',
                    },
                    packages: [{ weight: packageWeight, description: packageDesc, ...DEFAULT_DIMENSIONS }],
                    serviceCode: '03', // UPS Ground
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Rating failed');
            setRates(data.rates || []);
            if (data.rates?.length > 0) setSelectedService(data.rates[0].serviceCode);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setGettingRates(false);
        }
    }, [patientName, addrLine1, addrCity, addrState, addrZip, packageWeight, packageDesc]);

    const handleCreateShipment = useCallback(async () => {
        if (!selectedService) {
            setError('Please select a shipping service');
            return;
        }
        if (!confirm(`Create a UPS shipment to ${patientName}? This will generate a real shipping label and may incur charges.`)) {
            return;
        }
        setShipping(true);
        setError('');
        setShipResult(null);
        try {
            const res = await fetch(withBasePath('/api/ups/ship'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId,
                    shipTo: {
                        name: patientName,
                        addressLine1: addrLine1,
                        city: addrCity,
                        state: addrState,
                        postalCode: addrZip,
                        countryCode: 'US',
                        phone: phone || '',
                    },
                    packages: [{ weight: packageWeight, description: packageDesc, ...DEFAULT_DIMENSIONS }],
                    serviceCode: selectedService || '03',
                    description: packageDesc,
                    notes,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Shipment creation failed');
            setShipResult({
                trackingNumber: data.shipment.trackingNumber,
                totalCharges: data.shipment.totalCharges,
                labelData: data.shipment.labelData,
            });
            // Refresh shipments list
            const listRes = await fetch(withBasePath(`/api/ups/shipments?patientId=${patientId}`));
            const listData = await listRes.json();
            if (listData.shipments) setShipments(listData.shipments);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setShipping(false);
        }
    }, [patientId, patientName, addrLine1, addrCity, addrState, addrZip, phone, packageWeight, packageDesc, selectedService, notes]);

    const handleTrack = useCallback(async (trackingNumber: string) => {
        setTrackingLoading((prev) => ({ ...prev, [trackingNumber]: true }));
        try {
            const res = await fetch(withBasePath(`/api/ups/track?trackingNumber=${trackingNumber}`));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Tracking failed');
            setTrackingInfo((prev) => ({ ...prev, [trackingNumber]: data }));
        } catch (e: any) {
            setError(e.message);
        } finally {
            setTrackingLoading((prev) => ({ ...prev, [trackingNumber]: false }));
        }
    }, []);

    const handleVoid = useCallback(async (shipmentDbId: number) => {
        if (!confirm('Void this shipment? This will cancel the shipping label.')) return;
        setVoidingId(shipmentDbId);
        try {
            const res = await fetch(withBasePath('/api/ups/void'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shipmentDbId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Void failed');
            setShipments((prev) =>
                prev.map((s) => (s.id === shipmentDbId ? { ...s, status: 'voided', voided_at: new Date().toISOString() } : s))
            );
        } catch (e: any) {
            setError(e.message);
        } finally {
            setVoidingId(null);
        }
    }, []);

    const handleApplyCandidate = useCallback((c: AddressCandidate) => {
        setAddrLine1(c.addressLine1);
        setAddrCity(c.city);
        setAddrState(c.state);
        setAddrZip(c.postalCode);
        setValidationResult(null);
    }, []);

    const handlePresetChange = useCallback((label: string) => {
        setPackageDesc(label);
        const preset = PACKAGE_PRESETS.find((p) => p.label === label);
        if (preset && preset.weight > 0) setPackageWeight(preset.weight);
    }, []);

    const openLabel = useCallback((labelData: string, format: string | null) => {
        const mimeType = format === 'PNG' ? 'image/png' : 'image/gif';
        const w = window.open();
        if (w) {
            w.document.write(`
        <html><head><title>UPS Shipping Label</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f1f5f9">
          <img src="data:${mimeType};base64,${labelData}" style="max-width:100%;height:auto" />
        </body></html>
      `);
        }
    }, []);

    // ── Status Badge ─────────────────────────────────────────────────────────

    const statusColor = (s: string) => {
        switch (s) {
            case 'delivered': return { bg: '#dcfce7', color: '#15803d' };
            case 'in_transit': case 'out_for_delivery': return { bg: '#dbeafe', color: '#1d4ed8' };
            case 'label_created': return { bg: '#fef3c7', color: '#b45309' };
            case 'voided': return { bg: '#fef2f2', color: '#dc2626' };
            case 'exception': case 'returned': return { bg: '#fef2f2', color: '#b91c1c' };
            default: return { bg: '#f1f5f9', color: '#475569' };
        }
    };

    const formatDate = (d: string | null) => {
        if (!d) return '—';
        const date = new Date(d);
        return isNaN(date.getTime()) ? d : date.toLocaleDateString('en-US', { timeZone: 'America/Phoenix' });
    };

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div
            style={{
                borderRadius: '0.9rem',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                backgroundColor: '#ffffff',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.5rem',
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>📦 UPS Shipping</h2>
                    <p style={{ margin: '0.25rem 0 0', color: '#475569', fontSize: '0.9rem' }}>
                        Ship medical supplies to this patient via UPS
                    </p>
                </div>
                <button
                    onClick={() => { setShowForm(!showForm); setError(''); }}
                    style={{
                        padding: '0.5rem 1rem',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: '#ffffff',
                        backgroundColor: showForm ? '#64748b' : '#7c3aed',
                        border: 'none',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                    }}
                >
                    {showForm ? 'Close' : '+ New Shipment'}
                </button>
            </div>

            {/* Error Banner */}
            {error && (
                <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#b91c1c', fontSize: '0.9rem' }}>
                    ⚠️ {error}
                    <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                </div>
            )}

            {/* New Shipment Form */}
            {showForm && (
                <div style={{ border: '1px solid rgba(148,163,184,0.2)', borderRadius: '0.75rem', padding: '1.25rem', backgroundColor: '#fafbfc' }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#0f172a' }}>Ship To: {patientName}</h3>

                    {/* Address Fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Street Address</label>
                            <input
                                type="text"
                                value={addrLine1}
                                onChange={(e) => setAddrLine1(e.target.value)}
                                style={inputStyle}
                                placeholder="123 Main St"
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>City</label>
                            <input type="text" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} style={inputStyle} placeholder="City" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div>
                                <label style={labelStyle}>State</label>
                                <input type="text" value={addrState} onChange={(e) => setAddrState(e.target.value)} style={inputStyle} placeholder="AZ" maxLength={2} />
                            </div>
                            <div>
                                <label style={labelStyle}>ZIP</label>
                                <input type="text" value={addrZip} onChange={(e) => setAddrZip(e.target.value)} style={inputStyle} placeholder="86301" />
                            </div>
                        </div>
                    </div>

                    {/* Validate Address Button */}
                    <button
                        onClick={handleValidateAddress}
                        disabled={validating || !addrLine1 || !addrCity || !addrState || !addrZip}
                        style={{ ...btnStyle, backgroundColor: validating ? '#94a3b8' : '#0284c7', marginBottom: '0.75rem' }}
                    >
                        {validating ? '⏳ Validating...' : '✓ Validate Address'}
                    </button>

                    {/* Validation Result */}
                    {validationResult && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '0.5rem', backgroundColor: validationResult.valid ? '#f0fdf4' : '#fffbeb', border: `1px solid ${validationResult.valid ? '#bbf7d0' : '#fde68a'}` }}>
                            <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: validationResult.valid ? '#15803d' : '#b45309' }}>
                                {validationResult.valid ? '✓ Address Valid' : '⚠️ Address needs correction'}
                                {validationResult.candidates[0]?.classification && ` (${validationResult.candidates[0].classification})`}
                            </p>
                            {validationResult.candidates.map((c, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                    <span>{c.addressLine1}, {c.city}, {c.state} {c.postalCode}</span>
                                    <button
                                        onClick={() => handleApplyCandidate(c)}
                                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
                                    >
                                        Use This
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Package Details */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div>
                            <label style={labelStyle}>Package Contents</label>
                            <select
                                value={packageDesc}
                                onChange={(e) => handlePresetChange(e.target.value)}
                                style={inputStyle}
                            >
                                {PACKAGE_PRESETS.map((p) => (
                                    <option key={p.label} value={p.label}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Weight (lbs)</label>
                            <input
                                type="number"
                                min={0.1}
                                step={0.1}
                                value={packageWeight}
                                onChange={(e) => setPackageWeight(parseFloat(e.target.value) || 0)}
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={labelStyle}>Notes (optional)</label>
                        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} placeholder="e.g. Include alcohol swabs" />
                    </div>

                    {/* Get Rates Button */}
                    <button
                        onClick={handleGetRates}
                        disabled={gettingRates || !addrLine1 || !packageWeight}
                        style={{ ...btnStyle, backgroundColor: gettingRates ? '#94a3b8' : '#059669', marginBottom: '0.75rem' }}
                    >
                        {gettingRates ? '⏳ Getting Rates...' : '💲 Get Shipping Rates'}
                    </button>

                    {/* Rate Options */}
                    {rates.length > 0 && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ ...labelStyle, marginBottom: '0.5rem', display: 'block' }}>Select Service:</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {rates.map((r) => (
                                    <label
                                        key={r.serviceCode}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            padding: '0.75rem 1rem',
                                            borderRadius: '0.5rem',
                                            border: `2px solid ${selectedService === r.serviceCode ? '#7c3aed' : 'rgba(148,163,184,0.2)'}`,
                                            backgroundColor: selectedService === r.serviceCode ? '#f5f3ff' : '#fff',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="service"
                                            value={r.serviceCode}
                                            checked={selectedService === r.serviceCode}
                                            onChange={() => setSelectedService(r.serviceCode)}
                                            style={{ accentColor: '#7c3aed' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.serviceName}</span>
                                            {r.guaranteedDays && (
                                                <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                                                    ({r.guaranteedDays} business {parseInt(r.guaranteedDays) === 1 ? 'day' : 'days'})
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: '1.1rem' }}>
                                            ${r.totalCharges}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Create Shipment Button */}
                    {rates.length > 0 && (
                        <button
                            onClick={handleCreateShipment}
                            disabled={shipping || !selectedService}
                            style={{ ...btnStyle, backgroundColor: shipping ? '#94a3b8' : '#7c3aed', fontSize: '1rem', padding: '0.65rem 1.5rem' }}
                        >
                            {shipping ? '⏳ Creating Shipment...' : '📦 Create Shipment & Print Label'}
                        </button>
                    )}

                    {/* Ship Result */}
                    {shipResult && (
                        <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '0.5rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                            <p style={{ margin: 0, fontWeight: 700, color: '#15803d', fontSize: '1.1rem' }}>✓ Shipment Created!</p>
                            <p style={{ margin: '0.5rem 0 0', color: '#0f172a' }}>
                                <strong>Tracking #:</strong>{' '}
                                <a href={`https://www.ups.com/track?tracknum=${shipResult.trackingNumber}`} target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed', fontWeight: 600 }}>
                                    {shipResult.trackingNumber}
                                </a>
                            </p>
                            <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>Cost: ${shipResult.totalCharges}</p>
                            {shipResult.labelData && (
                                <button
                                    onClick={() => openLabel(shipResult.labelData!, 'GIF')}
                                    style={{ ...btnStyle, backgroundColor: '#0284c7', marginTop: '0.75rem' }}
                                >
                                    🖨️ Print Label
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Shipment History */}
            {shipments.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                    <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>
                        Shipment History ({shipments.length})
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 800 }}>
                        <thead>
                            <tr>
                                {['Tracking #', 'Service', 'Status', 'Destination', 'Weight', 'Cost', 'Date', 'Actions'].map((h) => (
                                    <th key={h} style={thStyle}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {shipments.map((s) => {
                                const sc = statusColor(s.status);
                                const tr = trackingInfo[s.tracking_number];
                                return (
                                    <tr key={s.id}>
                                        <td style={tdStyle}>
                                            <a
                                                href={`https://www.ups.com/track?tracknum=${s.tracking_number}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ color: '#7c3aed', fontWeight: 500, textDecoration: 'none' }}
                                            >
                                                {s.tracking_number}
                                            </a>
                                        </td>
                                        <td style={tdStyle}>{s.service_name || s.service_code}</td>
                                        <td style={tdStyle}>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '0.2rem 0.6rem',
                                                borderRadius: '9999px',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                backgroundColor: sc.bg,
                                                color: sc.color,
                                                textTransform: 'capitalize',
                                            }}>
                                                {s.status.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td style={tdStyle}>
                                            {s.ship_to_city && s.ship_to_state
                                                ? `${s.ship_to_city}, ${s.ship_to_state} ${s.ship_to_zip || ''}`
                                                : s.ship_to_address}
                                        </td>
                                        <td style={tdStyle}>{s.package_weight ? `${s.package_weight} lbs` : '—'}</td>
                                        <td style={tdStyle}>{s.shipping_cost ? `$${Number(s.shipping_cost).toFixed(2)}` : '—'}</td>
                                        <td style={tdStyle}>{formatDate(s.created_at)}</td>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                <button
                                                    onClick={() => handleTrack(s.tracking_number)}
                                                    disabled={trackingLoading[s.tracking_number]}
                                                    style={{ ...smallBtnStyle, backgroundColor: '#0284c7' }}
                                                >
                                                    {trackingLoading[s.tracking_number] ? '...' : '📍 Track'}
                                                </button>
                                                {s.label_data && (
                                                    <button
                                                        onClick={() => openLabel(s.label_data!, s.label_format)}
                                                        style={{ ...smallBtnStyle, backgroundColor: '#475569' }}
                                                    >
                                                        🖨️ Label
                                                    </button>
                                                )}
                                                {s.status === 'label_created' && (
                                                    <button
                                                        onClick={() => handleVoid(s.id)}
                                                        disabled={voidingId === s.id}
                                                        style={{ ...smallBtnStyle, backgroundColor: '#dc2626' }}
                                                    >
                                                        {voidingId === s.id ? '...' : '✕ Void'}
                                                    </button>
                                                )}
                                            </div>
                                            {/* Inline tracking info */}
                                            {tr && (
                                                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#475569' }}>
                                                    <strong>{tr.currentStatus}</strong>
                                                    {tr.estimatedDelivery && <span> · Est: {tr.estimatedDelivery}</span>}
                                                    {tr.activities.length > 0 && (
                                                        <div style={{ marginTop: '0.25rem' }}>
                                                            {tr.activities.slice(0, 3).map((a, i) => (
                                                                <div key={i}>{a.date} {a.time} — {a.status} {a.location && `(${a.location})`}</div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Empty State */}
            {shipments.length === 0 && !showForm && (
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                    No shipments yet. Click &quot;+ New Shipment&quot; to ship supplies to this patient.
                </p>
            )}
        </div>
    );
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#475569',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid rgba(148,163,184,0.3)',
    borderRadius: '0.375rem',
    backgroundColor: '#fff',
    color: '#0f172a',
    outline: 'none',
    boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#ffffff',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
};

const smallBtnStyle: React.CSSProperties = {
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#ffffff',
    border: 'none',
    borderRadius: '0.25rem',
    cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
    padding: '0.65rem 0.9rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#475569',
    backgroundColor: '#f8fafc',
    borderBottom: '1px solid rgba(148,163,184,0.3)',
};

const tdStyle: React.CSSProperties = {
    padding: '0.65rem 0.9rem',
    borderBottom: '1px solid rgba(148,163,184,0.15)',
    fontSize: '0.875rem',
};

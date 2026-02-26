
'use client';

import { useState, useEffect } from 'react';

interface Props {
    onClose: () => void;
    onSuccess: (order: any) => void;
}

interface Patient {
    id: string; // gmh ID
    healthie_id?: string;
    first_name: string;
    last_name: string;
    dob: string;
    gender: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
}

const CLINICS = [
    { id: '22937', name: "Tri-City Men's Health" },
    { id: '72152', name: "NowPrimary.Care" }
];

const STANDARD_PANELS = [
    { code: '9757', name: 'Male - Pre-Required' },
    { code: '9761', name: 'Male - Post' },
    { code: '9756', name: 'Female Pre-Required' },
    { code: '9760', name: 'Female - Post' }
];

const ADD_ONS = [
    { code: '146', name: 'PSA (Total)' }
];

const RESTRICTED_ADD_ONS = [
    { code: 'L509', name: 'Lipid Panel (Requires Approval)' },
    { code: '202', name: 'HBA1C (Requires Approval)' }
];

export default function OrderLabModal({ onClose, onSuccess }: Props) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [clinicId, setClinicId] = useState('22937');
    const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing');

    // Existing Patient Search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Patient[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    // Track which fields were originally missing from Healthie so we only sync those back
    const [originallyMissingFields, setOriginallyMissingFields] = useState<string[]>([]);

    // New Patient Form
    const [newPatient, setNewPatient] = useState({
        first_name: '',
        last_name: '',
        dob: '',
        gender: 'M',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: '',
        zip: ''
    });

    // Test Selection
    const [selectedPanel, setSelectedPanel] = useState<string>(''); // One of STANDARD_PANELS
    const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
    const [customCodes, setCustomCodes] = useState('');
    const [notes, setNotes] = useState('');

    // Search Patients
    useEffect(() => {
        if (!searchQuery || searchQuery.length < 3) {
            setSearchResults([]);
            return;
        }

        const delayDebounce = setTimeout(async () => {
            setIsSearching(true);
            try {
                const res = await fetch(`/ops/api/patients/search?q=${encodeURIComponent(searchQuery)}`);
                const data = await res.json();
                if (data.patients) {
                    setSearchResults(data.patients.map((p: any) => ({
                        id: p.id,
                        healthie_id: p.healthie_id,
                        first_name: p.first_name,
                        last_name: p.last_name,
                        dob: p.dob,
                        gender: p.gender || '',
                        phone: p.phone,
                        email: p.email,
                        address: p.address_line1, // Mapping DB fields
                        city: p.city,
                        state: p.state,
                        zip: p.postal_code
                    })));
                } else {
                    setSearchResults([]);
                }
            } catch (err) {
                console.error("Search failed", err);
            } finally {
                setIsSearching(false);
            }
        }, 500);

        return () => clearTimeout(delayDebounce);
    }, [searchQuery]);

    const handleAddOnToggle = (code: string) => {
        setSelectedAddOns(prev =>
            prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
        );
    };

    const handleSubmit = async () => {
        setError(null);
        setLoading(true);

        // Validate
        if (patientMode === 'existing' && !selectedPatient) {
            setError('Please select a patient');
            setLoading(false);
            return;
        }
        if (patientMode === 'existing' && selectedPatient) {
            const missing: string[] = [];
            if (!selectedPatient.first_name) missing.push('First Name');
            if (!selectedPatient.last_name) missing.push('Last Name');
            if (!selectedPatient.dob) missing.push('Date of Birth');
            if (!selectedPatient.gender) missing.push('Gender');
            if (!selectedPatient.address) missing.push('Address');
            if (!selectedPatient.city) missing.push('City');
            if (!selectedPatient.state) missing.push('State');
            if (!selectedPatient.zip) missing.push('Zip');
            if (missing.length > 0) {
                setError(`Missing required info for ${selectedPatient.first_name} ${selectedPatient.last_name}: ${missing.join(', ')}. Please fill in the fields below.`);
                setLoading(false);
                return;
            }
        }
        if (patientMode === 'new') {
            if (!newPatient.first_name || !newPatient.last_name || !newPatient.dob || !newPatient.address || !newPatient.city || !newPatient.state || !newPatient.zip) {
                setError('Please fill in all required patient fields (Name, DOB, Address, City, State, Zip)');
                setLoading(false);
                return;
            }
        }
        if (!selectedPanel && selectedAddOns.length === 0 && !customCodes) {
            setError('Please select at least one test');
            setLoading(false);
            return;
        }

        // Prepare Data
        const finalPatient = patientMode === 'existing' ? selectedPatient : newPatient;
        const allTests = [];
        if (selectedPanel) allTests.push(selectedPanel);
        allTests.push(...selectedAddOns);

        // Provider based on clinic
        const provider = clinicId === '22937'
            ? { name: 'Dr. Whitten', npi: '1366037806' }  // Tri-City Men's Health
            : { name: 'Phil Schafer NP', npi: '1790276608' };  // NowPrimary.Care

        // Build list of fields the user manually filled in (were missing from Healthie)
        const healthieFieldUpdates: Record<string, string> = {};
        if (patientMode === 'existing' && selectedPatient && originallyMissingFields.length > 0) {
            for (const field of originallyMissingFields) {
                const val = (selectedPatient as any)[field];
                if (val) healthieFieldUpdates[field] = val;
            }
        }

        const payload = {
            clinic_id: clinicId,
            patient_id: patientMode === 'existing' ? selectedPatient?.id : null,
            patient: finalPatient,
            tests: allTests,
            custom_codes: customCodes,
            notes: notes,
            provider_name: provider.name,
            provider_npi: provider.npi,
            // Only send fields that were originally missing from Healthie
            healthie_field_updates: Object.keys(healthieFieldUpdates).length > 0 ? healthieFieldUpdates : undefined
        };

        try {
            const res = await fetch('/ops/api/labs/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (res.ok) {
                onSuccess(data);
                onClose();
            } else {
                setError(data.error || 'Failed to create order');
            }
        } catch (err) {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    };

    const isRestricted = (
        selectedAddOns.some(c => RESTRICTED_ADD_ONS.some(r => r.code === c)) ||
        customCodes.length > 0
    );

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50
        }}>
            <div style={{
                background: '#fff',
                width: '600px',
                maxWidth: '90vw',
                maxHeight: '90vh',
                borderRadius: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Create Lab Order</h2>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                    {error && (
                        <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            {error}
                        </div>
                    )}

                    {/* Clinic Selection */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Select Clinic</label>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            {CLINICS.map(clinic => (
                                <label key={clinic.id} style={{
                                    flex: 1,
                                    padding: '0.75rem',
                                    border: `2px solid ${clinicId === clinic.id ? '#3b82f6' : '#e2e8f0'}`,
                                    borderRadius: '0.5rem',
                                    cursor: 'pointer',
                                    background: clinicId === clinic.id ? '#eff6ff' : '#fff'
                                }}>
                                    <input type="radio" name="clinic" value={clinic.id} checked={clinicId === clinic.id} onChange={(e) => setClinicId(e.target.value)} style={{ marginRight: '0.5rem' }} />
                                    {clinic.name}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Patient Selection */}
                    <div style={{ marginBottom: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                            <button
                                onClick={() => setPatientMode('existing')}
                                style={{
                                    background: 'none', border: 'none',
                                    fontWeight: patientMode === 'existing' ? 700 : 400,
                                    color: patientMode === 'existing' ? '#3b82f6' : '#64748b',
                                    cursor: 'pointer'
                                }}>
                                Existing Patient
                            </button>
                            <button
                                onClick={() => setPatientMode('new')}
                                style={{
                                    background: 'none', border: 'none',
                                    fontWeight: patientMode === 'new' ? 700 : 400,
                                    color: patientMode === 'new' ? '#3b82f6' : '#64748b',
                                    cursor: 'pointer'
                                }}>
                                New Patient (Manual Entry)
                            </button>
                        </div>

                        {patientMode === 'existing' ? (
                            <div>
                                <input
                                    type="text"
                                    placeholder="Search patient name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #ccc' }}
                                />
                                {isSearching && <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>Searching...</div>}
                                {searchResults.length > 0 && (
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', marginTop: '0.5rem', borderRadius: '0.375rem' }}>
                                        {searchResults.map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => {
                                                    setSelectedPatient(p);
                                                    setSearchResults([]);
                                                    setSearchQuery(`${p.first_name} ${p.last_name}`);
                                                    // Track which fields Healthie didn't have so we only sync those back
                                                    const missing: string[] = [];
                                                    if (!p.dob) missing.push('dob');
                                                    if (!p.gender) missing.push('gender');
                                                    if (!p.address) missing.push('address');
                                                    if (!p.city) missing.push('city');
                                                    if (!p.state) missing.push('state');
                                                    if (!p.zip) missing.push('zip');
                                                    if (!p.phone) missing.push('phone');
                                                    setOriginallyMissingFields(missing);
                                                }}
                                                style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: '#fff' }}
                                            >
                                                <strong>{p.first_name} {p.last_name}</strong> <span style={{ fontSize: '0.8rem', color: '#64748b' }}>({p.dob})</span>
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{p.city}, {p.state}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {selectedPatient && (
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', borderRadius: '0.375rem' }}>
                                        <div style={{ color: '#166534', background: '#dcfce7', padding: '0.5rem', borderRadius: '0.375rem' }}>
                                            ✓ Selected: {selectedPatient.first_name} {selectedPatient.last_name} {selectedPatient.dob ? `(${selectedPatient.dob})` : ''}
                                            {selectedPatient.address && <div style={{ fontSize: '0.8rem', color: '#15803d' }}>{selectedPatient.address}, {selectedPatient.city}, {selectedPatient.state} {selectedPatient.zip}</div>}
                                        </div>
                                        {/* Show warnings and editable fields for missing data */}
                                        {originallyMissingFields.length > 0 && (
                                            <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '0.375rem' }}>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e', marginBottom: '0.5rem' }}>
                                                    ⚠️ Missing required info — please fill in:
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                                    {originallyMissingFields.includes('dob') && (
                                                        <input
                                                            placeholder="DOB (MM/DD/YYYY) *"
                                                            value={selectedPatient.dob || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, dob: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem' }}
                                                        />
                                                    )}
                                                    {originallyMissingFields.includes('gender') && (
                                                        <select
                                                            value={selectedPatient.gender || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, gender: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem' }}
                                                        >
                                                            <option value="">Gender *</option>
                                                            <option value="M">Male</option>
                                                            <option value="F">Female</option>
                                                        </select>
                                                    )}
                                                    {originallyMissingFields.includes('address') && (
                                                        <input
                                                            placeholder="Address *"
                                                            value={selectedPatient.address || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, address: e.target.value })}
                                                            style={{ gridColumn: 'span 2', padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem' }}
                                                        />
                                                    )}
                                                    {originallyMissingFields.includes('city') && (
                                                        <input
                                                            placeholder="City *"
                                                            value={selectedPatient.city || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, city: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem' }}
                                                        />
                                                    )}
                                                    {originallyMissingFields.includes('state') && (
                                                        <input
                                                            placeholder="State *"
                                                            value={selectedPatient.state || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, state: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem', maxWidth: '100px' }}
                                                        />
                                                    )}
                                                    {originallyMissingFields.includes('zip') && (
                                                        <input
                                                            placeholder="Zip *"
                                                            value={selectedPatient.zip || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, zip: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem', maxWidth: '100px' }}
                                                        />
                                                    )}
                                                    {originallyMissingFields.includes('phone') && (
                                                        <input
                                                            placeholder="Phone"
                                                            value={selectedPatient.phone || ''}
                                                            onChange={e => setSelectedPatient({ ...selectedPatient, phone: e.target.value })}
                                                            style={{ padding: '0.4rem', border: '2px solid #f59e0b', borderRadius: '0.25rem', fontSize: '0.85rem' }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <input placeholder="First Name" value={newPatient.first_name} onChange={e => setNewPatient({ ...newPatient, first_name: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <input placeholder="Last Name" value={newPatient.last_name} onChange={e => setNewPatient({ ...newPatient, last_name: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <input placeholder="DOB (MM/DD/YYYY)" value={newPatient.dob} onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <select value={newPatient.gender} onChange={e => setNewPatient({ ...newPatient, gender: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}>
                                    <option value="M">Male</option>
                                    <option value="F">Female</option>
                                </select>
                                <input placeholder="Address" value={newPatient.address} onChange={e => setNewPatient({ ...newPatient, address: e.target.value })} style={{ gridColumn: 'span 2', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <input placeholder="City" value={newPatient.city} onChange={e => setNewPatient({ ...newPatient, city: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input placeholder="State" value={newPatient.state} onChange={e => setNewPatient({ ...newPatient, state: e.target.value })} style={{ flex: 1, padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                    <input placeholder="Zip" value={newPatient.zip} onChange={e => setNewPatient({ ...newPatient, zip: e.target.value })} style={{ flex: 1, padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                </div>
                                <input placeholder="Phone" value={newPatient.phone} onChange={e => setNewPatient({ ...newPatient, phone: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                                <input placeholder="Email" value={newPatient.email} onChange={e => setNewPatient({ ...newPatient, email: e.target.value })} style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }} />
                            </div>
                        )}
                    </div>

                    {/* Tests */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Select Panel (Pick One)</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                            {STANDARD_PANELS.map(panel => (
                                <label key={panel.code} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input type="radio" name="panel" value={panel.code} checked={selectedPanel === panel.code} onChange={e => setSelectedPanel(e.target.value)} />
                                    {panel.name} ({panel.code})
                                </label>
                            ))}
                        </div>

                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Add-Ons</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                            {ADD_ONS.map(addon => (
                                <label key={addon.code} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={selectedAddOns.includes(addon.code)} onChange={() => handleAddOnToggle(addon.code)} />
                                    {addon.name}
                                </label>
                            ))}
                        </div>

                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#dc2626' }}>Restricted Add-Ons (Requires Admin Approval)</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', padding: '0.5rem', background: '#fef2f2', borderRadius: '0.5rem', border: '1px solid #fee2e2' }}>
                            {RESTRICTED_ADD_ONS.map(addon => (
                                <label key={addon.code} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={selectedAddOns.includes(addon.code)} onChange={() => handleAddOnToggle(addon.code)} />
                                    {addon.name}
                                </label>
                            ))}
                        </div>

                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Custom Codes (Requires Approval)</label>
                        <input
                            placeholder="Enter codes separated by commas (e.g. TSH, VITD)"
                            value={customCodes}
                            onChange={(e) => setCustomCodes(e.target.value)}
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #ccc' }}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '1.5rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.375rem', cursor: 'pointer' }}>Cancel</button>
                    {!loading ? (
                        <button onClick={handleSubmit} style={{
                            padding: '0.5rem 1rem',
                            background: isRestricted ? '#f59e0b' : '#3b82f6',
                            color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600
                        }}>
                            {isRestricted ? 'Request Approval' : 'Submit Lab Order'}
                        </button>
                    ) : (
                        <button disabled style={{ padding: '0.5rem 1rem', background: '#cbd5e1', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'wait' }}>Processing...</button>
                    )}
                </div>
            </div>
        </div>
    );
}

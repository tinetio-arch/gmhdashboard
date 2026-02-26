'use client';

import { useState, useEffect, useMemo } from 'react';
import { withBasePath } from '@/lib/basePath';

type StagedDose = {
    staged_dose_id: string;
    patient_id: string | null;
    patient_name: string | null;
    dose_ml: string;
    waste_ml: string;
    syringe_count: number;
    total_ml: string;
    vendor: string;
    vial_external_id: string | null;
    staged_date: string;
    staged_for_date: string;
    staged_by_name: string | null;
    status: string;
    notes: string | null;
};

type PatientOption = {
    patient_id: string;
    patient_name: string;
    regimen: string | null;
};

type Props = {
    patients: PatientOption[];
    onUpdate?: () => void;
};

export default function StagedDosesManager({ patients, onUpdate }: Props) {
    const [stagedDoses, setStagedDoses] = useState<StagedDose[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [loading, setLoading] = useState(false);

    // State for Generic prefill patient selection modal
    const [showUseModal, setShowUseModal] = useState(false);
    const [selectedGenericDose, setSelectedGenericDose] = useState<StagedDose | null>(null);
    const [usePatientQuery, setUsePatientQuery] = useState('');
    const [useSelectedPatientId, setUseSelectedPatientId] = useState('');
    const [useShowSuggestions, setUseShowSuggestions] = useState(false);

    // Form state
    const [isPatientSpecific, setIsPatientSpecific] = useState(false);
    const [selectedPatientId, setSelectedPatientId] = useState('');
    const [patientQuery, setPatientQuery] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [doseMl, setDoseMl] = useState('0.5');
    const [wasteMl, setWasteMl] = useState('0.1');
    const [syringeCount, setSyringeCount] = useState('4');
    const [vendor, setVendor] = useState('Carrie Boyd - Testosterone Miglyol 812 Oil Injection 200mg/ml (Pre-Filled Syringes) - 30 ML Vials');
    const [stagedForDate, setStagedForDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    // Filter patients like TransactionForm does
    const filteredPatients = useMemo(() => {
        const query = patientQuery.trim().toLowerCase();
        if (!query) return patients.slice(0, 10); // Show first 10 if no query
        return patients
            .filter(p => p.patient_name.toLowerCase().includes(query))
            .slice(0, 10);
    }, [patientQuery, patients]);

    const selectedPatient = selectedPatientId ? patients.find(p => p.patient_id === selectedPatientId) ?? null : null;

    useEffect(() => {
        loadStagedDoses();
    }, []);

    async function loadStagedDoses() {
        try {
            const res = await fetch(withBasePath('/api/staged-doses'));
            const data = await res.json();
            setStagedDoses(data.stagedDoses || []);
        } catch (err) {
            console.error('Failed to load staged doses:', err);
        }
    }

    function handlePatientSelect(patient: PatientOption) {
        setSelectedPatientId(patient.patient_id);
        setPatientQuery(patient.patient_name);
        setShowSuggestions(false);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch(withBasePath('/api/staged-doses'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId: isPatientSpecific ? selectedPatientId : null,
                    patientName: isPatientSpecific && selectedPatient ? selectedPatient.patient_name : null,
                    doseMl: parseFloat(doseMl),
                    wasteMl: parseFloat(wasteMl),
                    syringeCount: parseInt(syringeCount),
                    vendor,
                    stagedForDate,
                    notes
                })
            });

            if (res.ok) {
                // Reset form
                setSelectedPatientId('');
                setPatientQuery('');
                setDoseMl('0.5');
                setWasteMl('0.1');
                setSyringeCount('4');
                setNotes('');
                setShowForm(false);

                // Reload
                await loadStagedDoses();
                onUpdate?.();
            } else {
                alert('Failed to save staged dose');
            }
        } catch (err) {
            console.error('Error saving staged dose:', err);
            alert('Error saving staged dose');
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Remove this staged dose? This will restore the medication to inventory.')) return;

        try {
            await fetch(withBasePath(`/api/staged-doses?id=${id}`), { method: 'DELETE' });
            await loadStagedDoses();
            onUpdate?.();
        } catch (err) {
            console.error('Error deleting staged dose:', err);
        }
    }

    // Filtered patients for the "Use" modal
    const filteredUsePatients = useMemo(() => {
        const query = usePatientQuery.trim().toLowerCase();
        if (!query) return patients.slice(0, 10);
        return patients
            .filter(p => p.patient_name.toLowerCase().includes(query))
            .slice(0, 10);
    }, [usePatientQuery, patients]);

    const useSelectedPatient = useSelectedPatientId ? patients.find(p => p.patient_id === useSelectedPatientId) ?? null : null;

    async function handleUse(dose: StagedDose) {
        // If it's a generic prefill, show the patient selection modal
        if (!dose.patient_id) {
            setSelectedGenericDose(dose);
            setUsePatientQuery('');
            setUseSelectedPatientId('');
            setUseShowSuggestions(false);
            setShowUseModal(true);
            return;
        }

        // Patient-specific prefill - direct use
        if (!confirm(`Dispense this prefilled dose to ${dose.patient_name}?\n\nThis will create a dispense record but NOT double-count in the DEA log.`)) {
            return;
        }

        await executeUse(dose.staged_dose_id, dose.patient_id, dose.patient_name!);
    }

    async function handleUseModalConfirm() {
        if (!selectedGenericDose || !useSelectedPatient) {
            alert('Please select a patient');
            return;
        }

        setShowUseModal(false);
        await executeUse(selectedGenericDose.staged_dose_id, useSelectedPatient.patient_id, useSelectedPatient.patient_name);
    }

    async function executeUse(stagedDoseId: string, patientId: string, patientName: string) {
        try {
            const res = await fetch(withBasePath('/api/staged-doses/use'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stagedDoseId, patientId, patientName })
            });

            const result = await res.json();
            if (res.ok) {
                alert(`✅ Dispensed to ${result.patientName}!\n\nDEA log updated (no double entry)\nDispense record created`);
                await loadStagedDoses();
                onUpdate?.();
            } else {
                alert(`Failed: ${result.error}`);
            }
        } catch (err) {
            console.error('Error using staged dose:', err);
            alert('Error using staged dose');
        }
    }

    const totalStagedMl = stagedDoses.reduce((sum, d) => sum + parseFloat(d.total_ml), 0);

    return (
        <div style={{
            backgroundColor: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '0.75rem',
            padding: '1rem',
            marginBottom: '1rem'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0369a1' }}>
                        💉 Prefilled Doses ({stagedDoses.length})
                    </h3>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        Total staged: {totalStagedMl.toFixed(1)}ml
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: showForm ? '#94a3b8' : '#0ea5e9',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                    }}
                >
                    {showForm ? 'Cancel' : '+ Add Prefill'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} style={{
                    backgroundColor: 'white',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    marginBottom: '1rem'
                }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={isPatientSpecific}
                            onChange={(e) => setIsPatientSpecific(e.target.checked)}
                        />
                        <span style={{ fontWeight: 600 }}>Patient-Specific Prefill</span>
                    </label>

                    {isPatientSpecific && (
                        <div style={{ marginBottom: '0.75rem', position: 'relative' }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                                Patient Search
                            </label>
                            <input
                                type="text"
                                value={patientQuery}
                                onChange={(e) => setPatientQuery(e.target.value)}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                                placeholder="Start typing patient name..."
                                required={isPatientSpecific}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem',
                                    backgroundColor: 'white'
                                }}
                            />
                            {showSuggestions && filteredPatients.length > 0 && (
                                <ul style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.5rem',
                                    margin: 0,
                                    marginTop: '0.25rem',
                                    padding: '0.25rem 0',
                                    listStyle: 'none',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    maxHeight: '240px',
                                    overflowY: 'auto',
                                    zIndex: 10
                                }}>
                                    {filteredPatients.map((patient) => (
                                        <li key={patient.patient_id}>
                                            <button
                                                type="button"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => handlePatientSelect(patient)}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    gap: '0.5rem',
                                                    width: '100%',
                                                    border: 'none',
                                                    background: 'transparent',
                                                    padding: '0.6rem 0.9rem',
                                                    textAlign: 'left',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <span style={{ color: '#0f172a', fontWeight: 600 }}>{patient.patient_name}</span>
                                                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                                    {patient.regimen || '—'}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                                Dose per Syringe (ml)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={doseMl}
                                onChange={(e) => setDoseMl(e.target.value)}
                                required
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                                Waste per Syringe (ml)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={wasteMl}
                                onChange={(e) => setWasteMl(e.target.value)}
                                required
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                                # of Syringes
                            </label>
                            <input
                                type="number"
                                value={syringeCount}
                                onChange={(e) => setSyringeCount(e.target.value)}
                                required
                                min="1"
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                            Staged For Date
                        </label>
                        <input
                            type="date"
                            value={stagedForDate}
                            onChange={(e) => setStagedForDate(e.target.value)}
                            required
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid #cbd5e1',
                                borderRadius: '0.375rem'
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                            Notes (optional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid #cbd5e1',
                                borderRadius: '0.375rem'
                            }}
                        />
                    </div>

                    <div style={{
                        padding: '0.75rem',
                        backgroundColor: '#f8fafc',
                        borderRadius: '0.5rem',
                        marginBottom: '0.75rem'
                    }}>
                        <strong>Total for this bag:</strong> {((parseFloat(doseMl) + parseFloat(wasteMl)) * parseInt(syringeCount || '0')).toFixed(2)}ml
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: loading ? '#cbd5e1' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.5rem',
                            fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {loading ? 'Saving...' : 'Save Prefill'}
                    </button>
                </form>
            )}

            {stagedDoses.length > 0 && (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {stagedDoses.map(dose => {
                        const isStale = new Date(dose.staged_for_date + 'T23:59:59') < new Date();
                        return (
                            <div
                                key={dose.staged_dose_id}
                                style={{
                                    backgroundColor: isStale ? '#fffbeb' : 'white',
                                    padding: '0.75rem',
                                    borderRadius: '0.5rem',
                                    marginBottom: '0.5rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    border: isStale ? '1px solid #f59e0b' : 'none'
                                }}
                            >
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                        {dose.patient_name || 'Generic Prefill'}
                                        {isStale && (
                                            <span style={{
                                                marginLeft: '0.5rem',
                                                fontSize: '0.75rem',
                                                padding: '0.15rem 0.4rem',
                                                backgroundColor: '#f59e0b',
                                                color: '#ffffff',
                                                borderRadius: '0.25rem',
                                                fontWeight: 600
                                            }}>
                                                ⚠️ STALE — staged for {dose.staged_for_date}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                        {dose.syringe_count} syringes × ({dose.dose_ml}ml + {dose.waste_ml}ml waste) = {dose.total_ml}ml
                                        {!isStale && <span> · for {dose.staged_for_date}</span>}
                                    </div>
                                    {dose.notes && (
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                            {dose.notes}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={() => handleUse(dose)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        ✓ Use This
                                    </button>
                                    <button
                                        onClick={() => handleDelete(dose.staged_dose_id)}
                                        style={{
                                            padding: '0.25rem 0.5rem',
                                            backgroundColor: '#ef4444',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontSize: '0.85rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Patient Selection Modal for Generic Prefills */}
            {showUseModal && selectedGenericDose && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '0.75rem',
                        padding: '1.5rem',
                        width: '90%',
                        maxWidth: '500px',
                        boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)'
                    }}>
                        <h3 style={{ margin: '0 0 1rem', color: '#0f172a' }}>
                            Select Patient for Prefill
                        </h3>
                        <p style={{ color: '#64748b', marginBottom: '1rem' }}>
                            {selectedGenericDose.syringe_count} syringes × ({selectedGenericDose.dose_ml}ml + {selectedGenericDose.waste_ml}ml waste) = {selectedGenericDose.total_ml}ml
                        </p>

                        {/* Patient Search */}
                        <div style={{ position: 'relative', marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                                Search Patient
                            </label>
                            <input
                                type="text"
                                value={usePatientQuery}
                                onChange={(e) => {
                                    setUsePatientQuery(e.target.value);
                                    setUseShowSuggestions(true);
                                    setUseSelectedPatientId('');
                                }}
                                onFocus={() => setUseShowSuggestions(true)}
                                placeholder="Type patient name..."
                                autoFocus
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem',
                                    fontSize: '1rem'
                                }}
                            />

                            {/* Patient Suggestions Dropdown */}
                            {useShowSuggestions && filteredUsePatients.length > 0 && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    backgroundColor: 'white',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    zIndex: 10
                                }}>
                                    {filteredUsePatients.map(p => (
                                        <div
                                            key={p.patient_id}
                                            onClick={() => {
                                                setUseSelectedPatientId(p.patient_id);
                                                setUsePatientQuery(p.patient_name);
                                                setUseShowSuggestions(false);
                                            }}
                                            style={{
                                                padding: '0.75rem',
                                                cursor: 'pointer',
                                                backgroundColor: useSelectedPatientId === p.patient_id ? '#e0f2fe' : 'transparent',
                                                borderBottom: '1px solid #f1f5f9'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f9ff'}
                                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = useSelectedPatientId === p.patient_id ? '#e0f2fe' : 'transparent'}
                                        >
                                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{p.patient_name}</div>
                                            {p.regimen && (
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{p.regimen}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Selected Patient Display */}
                        {useSelectedPatient && (
                            <div style={{
                                padding: '0.75rem',
                                backgroundColor: '#dcfce7',
                                border: '1px solid #86efac',
                                borderRadius: '0.375rem',
                                marginBottom: '1rem'
                            }}>
                                <div style={{ fontWeight: 600, color: '#166534' }}>
                                    ✓ {useSelectedPatient.patient_name}
                                </div>
                                {useSelectedPatient.regimen && (
                                    <div style={{ fontSize: '0.85rem', color: '#15803d' }}>
                                        {useSelectedPatient.regimen}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowUseModal(false)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '0.375rem',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUseModalConfirm}
                                disabled={!useSelectedPatient}
                                style={{
                                    padding: '0.5rem 1rem',
                                    backgroundColor: useSelectedPatient ? '#10b981' : '#cbd5e1',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    fontWeight: 600,
                                    cursor: useSelectedPatient ? 'pointer' : 'not-allowed'
                                }}
                            >
                                ✓ Dispense to Patient
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

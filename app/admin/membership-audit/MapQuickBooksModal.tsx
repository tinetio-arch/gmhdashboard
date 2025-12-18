"use client";

import { useState, useEffect } from 'react';

type Patient = {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
  status_key: string | null;
  payment_method_key: string | null;
  client_type_key: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  qbCustomerId: string;
  qbCustomerName: string;
  qbEmail: string | null;
  qbPhone: string | null;
  onMap: (patientId: string) => Promise<void>;
};

export default function MapQuickBooksModal({
  isOpen,
  onClose,
  qbCustomerId,
  qbCustomerName,
  qbEmail,
  qbPhone,
  onMap
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && searchTerm.length >= 2) {
      const timeoutId = setTimeout(() => {
        searchPatients();
      }, 300);
      return () => clearTimeout(timeoutId);
    } else if (isOpen && searchTerm.length === 0) {
      setPatients([]);
    }
  }, [searchTerm, isOpen]);

  const searchPatients = async () => {
    if (searchTerm.length < 2) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/membership-audit/search-patients?q=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();
      setPatients(data.patients || []);
    } catch (error) {
      console.error('Error searching patients:', error);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  };

  const handleMap = async () => {
    if (!selectedPatientId) return;
    setMapping(true);
    try {
      await onMap(selectedPatientId);
      onClose();
      setSearchTerm('');
      setPatients([]);
      setSelectedPatientId(null);
    } catch (error) {
      console.error('Error mapping patient:', error);
      alert('Failed to map patient. Please try again.');
    } finally {
      setMapping(false);
    }
  };

  if (!isOpen) return null;

  return (
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
    }} onClick={onClose}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '1rem',
        padding: '2rem',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem' }}>
            Map QuickBooks Customer
          </h2>
          <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', fontSize: '0.9rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{qbCustomerName}</div>
            {qbEmail && <div style={{ color: '#64748b' }}>📧 {qbEmail}</div>}
            {qbPhone && <div style={{ color: '#64748b' }}>📞 {qbPhone}</div>}
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#0f172a' }}>
            Search for GMH Patient
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Type patient name, email, or phone..."
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
              fontSize: '0.9rem'
            }}
            autoFocus
          />
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Searching...</div>
        )}

        {!loading && searchTerm.length >= 2 && patients.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No patients found</div>
        )}

        {!loading && patients.length > 0 && (
          <div style={{ marginBottom: '1.5rem', maxHeight: '300px', overflowY: 'auto' }}>
            {patients.map((patient) => (
              <div
                key={patient.patient_id}
                onClick={() => setSelectedPatientId(patient.patient_id)}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: selectedPatientId === patient.patient_id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                  backgroundColor: selectedPatientId === patient.patient_id ? '#eff6ff' : '#ffffff',
                  marginBottom: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                  {patient.full_name}
                </div>
                {patient.email && (
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>📧 {patient.email}</div>
                )}
                {patient.phone_primary && (
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>📞 {patient.phone_primary}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={mapping}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#64748b',
              fontWeight: 600,
              cursor: mapping ? 'not-allowed' : 'pointer',
              opacity: mapping ? 0.5 : 1
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleMap}
            disabled={!selectedPatientId || mapping}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: !selectedPatientId || mapping ? '#cbd5e1' : '#3b82f6',
              color: '#ffffff',
              fontWeight: 600,
              cursor: !selectedPatientId || mapping ? 'not-allowed' : 'pointer'
            }}
          >
            {mapping ? 'Mapping...' : 'Map Patient'}
          </button>
        </div>
      </div>
    </div>
  );
}











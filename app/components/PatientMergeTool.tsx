'use client';
import { formatDateUTC } from '@/lib/dateUtils';

import React, { useState, useEffect } from 'react';

type DuplicatePatient = {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
  payment_method_key: string | null;
  status_key: string | null;
  date_added: string | null;
  dispense_count: number;
  transaction_count: number;
  membership_count: number;
  qb_mapping_count: number;
  payment_issue_count: number;
};

type DuplicateGroup = {
  normalized_name: string;
  patients: DuplicatePatient[];
};

export default function PatientMergeTool() {
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDuplicates = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/ops/api/admin/patients/duplicates');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || `Failed to load duplicates (${response.status})`);
      }
      const data = await response.json();
      setDuplicates(data.duplicates || []);
      if (!data.duplicates || data.duplicates.length === 0) {
        setMessage('✅ No duplicate patients found');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load duplicate patients';
      setError(errorMsg);
      console.error('Error loading duplicates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDuplicates();
  }, []);

  const handleMerge = async (keepPatientId: string, mergePatientId: string, keepName: string, mergeName: string) => {
    if (!confirm(
      `Merge "${mergeName}" into "${keepName}"?\n\n` +
      `This will:\n` +
      `- Transfer all dispenses, transactions, and memberships\n` +
      `- Mark the duplicate patient as inactive\n` +
      `- This action cannot be undone!\n\n` +
      `Are you sure?`
    )) {
      return;
    }

    setMerging(`${keepPatientId}-${mergePatientId}`);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/ops/api/admin/patients/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepPatientId, mergePatientId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Merge failed');
      }

      const result = await response.json();
      setMessage(result.message || 'Patients merged successfully');
      
      // Reload duplicates after a short delay
      setTimeout(() => {
        loadDuplicates();
        setMerging(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge patients');
      setMerging(null);
    }
  };

  const getTotalRecords = (patient: DuplicatePatient) => {
    return patient.dispense_count + patient.transaction_count + 
           patient.membership_count + patient.qb_mapping_count + 
           patient.payment_issue_count;
  };

  return (
    <div style={{
      padding: '1.5rem',
      borderRadius: '1rem',
      background: '#ffffff',
      border: '2px solid #dc2626',
      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.15)',
      marginBottom: '2rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.25rem' }}>
            🔄 Patient Merge Tool
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Find and merge duplicate patient records
          </p>
        </div>
        <button
          onClick={loadDuplicates}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            background: loading ? '#94a3b8' : '#dc2626',
            color: '#ffffff',
            fontWeight: 600,
            border: 'none',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem',
          borderRadius: '0.5rem',
          background: '#ecfdf5',
          border: '1px solid #10b981',
          color: '#047857',
          fontSize: '0.875rem',
          marginBottom: '1rem',
        }}>
          {message}
        </div>
      )}

      {error && (
        <div style={{
          padding: '0.75rem',
          borderRadius: '0.5rem',
          background: '#fef2f2',
          border: '1px solid #ef4444',
          color: '#b91c1c',
          fontSize: '0.875rem',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          Loading duplicate patients...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626' }}>
          ❌ {error}
        </div>
      ) : duplicates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          ✅ No duplicate patients found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {duplicates.map((group) => (
            <div
              key={group.normalized_name}
              style={{
                padding: '1rem',
                borderRadius: '0.75rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#991b1b', marginBottom: '0.75rem' }}>
                Duplicate: {group.patients[0].full_name} ({group.patients.length} records)
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {group.patients.map((patient, index) => {
                  const totalRecords = getTotalRecords(patient);
                  const isMerging = merging === `${group.patients[0].patient_id}-${patient.patient_id}` || 
                                  merging === `${patient.patient_id}-${group.patients[0].patient_id}`;
                  
                  return (
                    <div
                      key={patient.patient_id}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        background: '#ffffff',
                        border: '1px solid #fecaca',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '1rem',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.25rem' }}>
                          {patient.full_name}
                          {index === 0 && totalRecords > 0 && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                              (Most records - recommended to keep)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                          ID: {patient.patient_id}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {patient.email && `Email: ${patient.email} • `}
                          {patient.phone_primary && `Phone: ${patient.phone_primary} • `}
                          {patient.payment_method_key && `Payment: ${patient.payment_method_key} • `}
                          {patient.status_key && `Status: ${patient.status_key}`}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                          Records: {patient.dispense_count} dispenses, {patient.transaction_count} transactions, {patient.membership_count} memberships, {patient.qb_mapping_count} QB mappings, {patient.payment_issue_count} payment issues
                        </div>
                        {patient.date_added && (
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                            Added: {formatDateUTC(patient.date_added)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                        {group.patients.map((otherPatient) => {
                          if (otherPatient.patient_id === patient.patient_id) return null;
                          
                          return (
                            <button
                              key={otherPatient.patient_id}
                              onClick={() => handleMerge(
                                patient.patient_id,
                                otherPatient.patient_id,
                                patient.full_name,
                                otherPatient.full_name
                              )}
                              disabled={isMerging}
                              style={{
                                padding: '0.4rem 0.75rem',
                                borderRadius: '0.4rem',
                                background: isMerging ? '#94a3b8' : '#dc2626',
                                color: '#ffffff',
                                fontWeight: 600,
                                border: 'none',
                                cursor: isMerging ? 'wait' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isMerging ? 'Merging...' : `Merge "${otherPatient.full_name}" →`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}





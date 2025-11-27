"use client";

import { useState } from 'react';
import type { DuplicateMembershipGroup } from '@/lib/membershipAudit';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  duplicateGroup: DuplicateMembershipGroup | null;
  onResolve: (
    primaryPatientId: string, 
    duplicatePatientIds: string[], 
    action: 'merge' | 'remove',
    disableMembershipPackages: boolean
  ) => Promise<void>;
};

export default function ResolveDuplicateModal({
  isOpen,
  onClose,
  duplicateGroup,
  onResolve
}: Props) {
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null);
  const [action, setAction] = useState<'merge' | 'remove'>('merge');
  const [disableMembershipPackages, setDisableMembershipPackages] = useState(true);
  const [resolving, setResolving] = useState(false);

  if (!isOpen || !duplicateGroup) return null;

  // Use actual patient records if available, otherwise fall back to membership packages
  const hasPatientRecords = duplicateGroup.patients && duplicateGroup.patients.length > 0;
  const patientRecords = duplicateGroup.patients || [];
  const membershipOptions = duplicateGroup.memberships || [];

  const handleResolve = async () => {
    if (!selectedPrimary) return;

    // If we have patient records, use actual patient IDs
    if (hasPatientRecords && patientRecords.length > 0) {
      const primaryId = selectedPrimary;
      const duplicateIds = patientRecords
        .filter(p => p.patient_id !== selectedPrimary)
        .map(p => p.patient_id);

      setResolving(true);
      try {
        await onResolve(primaryId, duplicateIds, action, disableMembershipPackages);
        onClose();
        setSelectedPrimary(null);
        setAction('merge');
        setDisableMembershipPackages(true);
      } catch (error) {
        console.error('Error resolving duplicates:', error);
        alert('Failed to resolve duplicates. Please try again.');
      } finally {
        setResolving(false);
      }
    } else {
      // If no patient records, we can't resolve yet - show message
      alert('Patient records not found. Please ensure patients exist in the system first.');
    }
  };

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
        maxWidth: '800px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
      }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '1rem' }}>
          Resolve Duplicate: {duplicateGroup.patient_name || duplicateGroup.norm_name}
        </h2>

        <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fef3c7', borderRadius: '0.5rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>⚠️ Select the correct patient record:</div>
          <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
            {action === 'merge' 
              ? 'All data from other records will be merged into the primary record.'
              : 'Other records will be marked as inactive and removed from active lists.'}
          </div>
        </div>

        {/* Show patient records if available */}
        {hasPatientRecords && patientRecords.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: '#0f172a' }}>
              Patient Records ({patientRecords.length})
            </h3>
            {patientRecords.map((patient) => (
              <div
                key={patient.patient_id}
                onClick={() => setSelectedPrimary(patient.patient_id)}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: selectedPrimary === patient.patient_id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                  backgroundColor: selectedPrimary === patient.patient_id ? '#eff6ff' : '#ffffff',
                  marginBottom: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    checked={selectedPrimary === patient.patient_id}
                    onChange={() => setSelectedPrimary(patient.patient_id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      {patient.patient_name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      {patient.email && `📧 ${patient.email} • `}
                      {patient.phone_primary && `📞 ${patient.phone_primary} • `}
                      Status: {patient.status_key || 'Unknown'}
                      {patient.has_active_membership && (
                        <span style={{ color: '#10b981', marginLeft: '0.5rem' }}>• Active Membership</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Show membership packages info */}
        {membershipOptions.length > 0 && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#0f172a' }}>
              Membership Packages ({membershipOptions.length})
            </h3>
            {membershipOptions.map((m, idx) => {
              const balanceValue = m.outstanding_balance ?? '0';
              const balance = parseFloat(balanceValue);
              return (
                <div key={idx} style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
                  • {m.plan_name || 'No plan'} • {m.status || 'No status'}
                  {balance > 0 && (
                    <span style={{ color: '#dc2626', marginLeft: '0.5rem' }}>
                      ${balance.toFixed(2)} owed
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!hasPatientRecords && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
            <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: '0.25rem' }}>
              ⚠️ No Patient Records Found
            </div>
            <div style={{ fontSize: '0.85rem', color: '#991b1b' }}>
              These are duplicate membership packages, but no matching patient records exist yet. 
              Please create patient records first, or these will need to be handled differently.
            </div>
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#0f172a' }}>
            Resolution Action
          </label>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={action === 'merge'}
                onChange={() => setAction('merge')}
              />
              <span>Merge into Primary</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={action === 'remove'}
                onChange={() => setAction('remove')}
              />
              <span>Remove Others</span>
            </label>
          </div>
          
          {/* Checkbox to disable membership packages */}
          {membershipOptions.length > 0 && (
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              cursor: 'pointer',
              padding: '0.75rem',
              backgroundColor: '#f8fafc',
              borderRadius: '0.5rem'
            }}>
              <input
                type="checkbox"
                checked={disableMembershipPackages}
                onChange={(e) => setDisableMembershipPackages(e.target.checked)}
              />
              <div>
                <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.9rem' }}>
                  Disable Duplicate Membership Plans
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Mark duplicate membership packages as inactive/expired (like expired memberships)
                </div>
              </div>
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={resolving}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#64748b',
              fontWeight: 600,
              cursor: resolving ? 'not-allowed' : 'pointer',
              opacity: resolving ? 0.5 : 1
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={!selectedPrimary || resolving || !hasPatientRecords}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: !selectedPrimary || resolving || !hasPatientRecords ? '#cbd5e1' : action === 'merge' ? '#3b82f6' : '#ef4444',
              color: '#ffffff',
              fontWeight: 600,
              cursor: !selectedPrimary || resolving || !hasPatientRecords ? 'not-allowed' : 'pointer'
            }}
          >
            {resolving ? 'Resolving...' : !hasPatientRecords ? 'Need Patient Records' : action === 'merge' ? 'Merge into Primary' : 'Remove Others'}
          </button>
        </div>
      </div>
    </div>
  );
}


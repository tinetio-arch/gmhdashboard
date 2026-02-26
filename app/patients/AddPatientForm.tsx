'use client';

import { useMemo, useState, useEffect } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { LookupSets } from '@/lib/lookups';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';
import { stripHonorifics } from '@/lib/nameUtils';

type Props = {
  lookups: LookupSets;
  currentUserRole: UserRole;
  currentUserEmail: string;
};

type FormState = {
  patientName: string;
  statusKey: string | null;
  paymentMethodKey: string | null;
  clientTypeKey: string | null;
  clinic: string | null;  // 'nowprimary.care' or 'nowmenshealth.care'
  phoneNumber: string;
  email: string;  // Email for Healthie matching
  address: string;
  regimen: string;
  dateOfBirth: string;
  lastLab: string;
  nextLab: string;
  serviceStartDate: string;
  contractEndDate: string;
};

const cardStyle: CSSProperties = {
  marginBottom: '1.5rem',
  padding: '1.5rem',
  borderRadius: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: '#ffffff',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem'
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: '#ffffff',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
};

export default function AddPatientForm({ lookups, currentUserRole, currentUserEmail }: Props) {
  const router = useRouter();
  const defaultStatus = useMemo(() => lookups.statuses[0]?.status_key ?? null, [lookups.statuses]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [form, setForm] = useState<FormState>({
    patientName: '',
    statusKey: defaultStatus,
    paymentMethodKey: null,
    clientTypeKey: null,
    clinic: null,
    phoneNumber: '',
    email: '',
    address: '',
    regimen: '',
    dateOfBirth: '',
    lastLab: '',
    nextLab: '',
    serviceStartDate: '',
    contractEndDate: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    warnings: string[];
    existingHealthieId: string | null;
  } | null>(null);
  const isReadOnly = currentUserRole === 'read';
  const isDisabled = saving || isReadOnly;

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear duplicate info when form changes
    if (duplicateInfo) setDuplicateInfo(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, forceCreate = false) {
    event.preventDefault();
    if (isReadOnly) {
      setMessage('You do not have permission to add patients.');
      return;
    }
    const cleanedName = stripHonorifics(form.patientName.trim());
    if (!cleanedName) {
      setMessage('Patient name is required.');
      return;
    }
    if (!form.statusKey) {
      setMessage('Alert status is required.');
      return;
    }
    if (!form.paymentMethodKey) {
      setMessage('Payment method is required.');
      return;
    }
    if (!form.clientTypeKey) {
      setMessage('Client type is required.');
      return;
    }
    if (!form.clinic) {
      setMessage('Clinic is required.');
      return;
    }
    if (!form.lastLab) {
      setMessage('Last lab date is required.');
      return;
    }
    if (!form.nextLab) {
      setMessage('Next lab date is required.');
      return;
    }
    if (!form.serviceStartDate) {
      setMessage('Service start date is required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setDuplicateInfo(null);
    try {
      const response = await fetch(withBasePath('/api/patients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: cleanedName,
          statusKey: form.statusKey,
          paymentMethodKey: form.paymentMethodKey,
          clientTypeKey: form.clientTypeKey,
          clinic: form.clinic,
          phoneNumber: form.phoneNumber.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          regimen: form.regimen.trim() || null,
          addedBy: currentUserEmail,
          dateOfBirth: form.dateOfBirth || null,
          lastLab: form.lastLab || null,
          nextLab: form.nextLab || null,
          serviceStartDate: form.serviceStartDate || null,
          contractEndDate: form.contractEndDate || null,
          regularClient: false,
          isVerified: false,
          forceCreate: forceCreate  // Allow bypassing duplicate check
        })
      });

      // Handle duplicate detection (409 Conflict)
      if (response.status === 409) {
        const data = await response.json();
        setDuplicateInfo({
          warnings: data.duplicateWarnings || [],
          existingHealthieId: data.existingHealthieId || null
        });
        setMessage('Potential duplicate detected - see options below');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData?.error || `Failed to create patient (${response.status})`;
        throw new Error(errorMessage);
      }
      setForm({
        patientName: '',
        statusKey: defaultStatus,
        paymentMethodKey: null,
        clientTypeKey: null,
        clinic: null,
        phoneNumber: '',
        email: '',
        address: '',
        regimen: '',
        dateOfBirth: '',
        lastLab: '',
        nextLab: '',
        serviceStartDate: '',
        contractEndDate: ''
      });
      setMessage('Patient added successfully.');
      router.refresh();
    } catch (error) {
      console.error('Error creating patient:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to add patient. Please check all required fields are filled.';
      setMessage(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  // Link to existing Healthie patient (forceCreate bypasses duplicate check)
  async function handleForceCreate() {
    // Create a synthetic event
    const syntheticEvent = { preventDefault: () => { } } as FormEvent<HTMLFormElement>;
    await handleSubmit(syntheticEvent, true);
  }

  if (!mounted) {
    return <div style={cardStyle} suppressHydrationWarning />;
  }

  return (
    <form onSubmit={handleSubmit} style={cardStyle} suppressHydrationWarning={true}>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Patient Name *</label>
          <input
            type="text"
            required
            value={form.patientName}
            onChange={(event) => updateForm('patientName', event.target.value)}
            style={inputStyle}
            placeholder="Jane Doe"
            disabled={isDisabled}
          />
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Alert Status</label>
          <select
            value={form.statusKey ?? ''}
            onChange={(event) => updateForm('statusKey', event.target.value || null)}
            style={inputStyle}
            disabled={isDisabled}
          >
            {lookups.statuses.map((status) => (
              <option key={status.status_key} value={status.status_key}>
                {status.display_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Payment Method</label>
          <select
            value={form.paymentMethodKey ?? ''}
            onChange={(event) => updateForm('paymentMethodKey', event.target.value || null)}
            style={inputStyle}
            disabled={isDisabled}
          >
            <option value="">(Unspecified)</option>
            {lookups.paymentMethods.map((method) => (
              <option key={method.method_key} value={method.method_key}>
                {method.display_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Client Type *</label>
          <select
            value={form.clientTypeKey ?? ''}
            onChange={(event) => updateForm('clientTypeKey', event.target.value || null)}
            style={inputStyle}
            disabled={isDisabled}
            required
          >
            <option value="">Select Client Type...</option>
            {lookups.clientTypes.map((type) => (
              <option key={type.type_key} value={type.type_key}>
                {type.display_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Clinic *</label>
          <select
            value={form.clinic ?? ''}
            onChange={(event) => updateForm('clinic', event.target.value || null)}
            style={inputStyle}
            disabled={isDisabled}
            required
          >
            <option value="">Select Clinic...</option>
            <option value="nowprimary.care">NOW Primary Care</option>
            <option value="nowmenshealth.care">NOW Men's Health</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Phone Number *</label>
          <input
            type="tel"
            value={form.phoneNumber}
            onChange={(event) => updateForm('phoneNumber', event.target.value)}
            style={inputStyle}
            placeholder="(555) 123-4567"
            disabled={isDisabled}
            required
          />
        </div>
        <div style={{ flex: '1 1 250px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Email (for Healthie matching)</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateForm('email', event.target.value)}
            style={inputStyle}
            placeholder="patient@example.com"
            disabled={isDisabled}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Regimen *</label>
          <input
            type="text"
            value={form.regimen}
            onChange={(event) => updateForm('regimen', event.target.value)}
            style={inputStyle}
            placeholder="0.5ml Q 4D"
            disabled={isDisabled}
            required
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Date of Birth *</label>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(event) => updateForm('dateOfBirth', event.target.value)}
            style={inputStyle}
            disabled={isDisabled}
            required
          />
        </div>
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Address *</label>
        <textarea
          value={form.address}
          onChange={(event) => updateForm('address', event.target.value)}
          style={{ ...inputStyle, minHeight: '64px' }}
          placeholder="123 Main St, Prescott, AZ 86301"
          disabled={isDisabled}
          required
        />
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Last Lab *</label>
          <input
            type="date"
            value={form.lastLab}
            onChange={(event) => updateForm('lastLab', event.target.value)}
            style={inputStyle}
            disabled={isDisabled}
            required
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Next Lab *</label>
          <input
            type="date"
            value={form.nextLab}
            onChange={(event) => updateForm('nextLab', event.target.value)}
            style={inputStyle}
            disabled={isDisabled}
            required
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Service Start Date *</label>
          <input
            type="date"
            value={form.serviceStartDate}
            onChange={(event) => updateForm('serviceStartDate', event.target.value)}
            style={inputStyle}
            disabled={isDisabled}
            required
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Contract End</label>
          <input
            type="date"
            value={form.contractEndDate}
            onChange={(event) => updateForm('contractEndDate', event.target.value)}
            style={inputStyle}
            disabled={isDisabled}
          />
        </div>
      </div>

      {/* Duplicate Detection Warning */}
      {duplicateInfo && (
        <div style={{
          padding: '1rem',
          borderRadius: '0.5rem',
          background: '#fef9c3',
          border: '1px solid #eab308',
          marginBottom: '1rem'
        }}>
          <div style={{ fontWeight: 600, color: '#854d0e', marginBottom: '0.5rem' }}>
            ⚠️ Potential Duplicate Detected
          </div>
          <ul style={{ margin: '0 0 1rem 1.5rem', padding: 0, color: '#854d0e' }}>
            {duplicateInfo.warnings.map((warning, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{warning}</li>
            ))}
          </ul>
          {duplicateInfo.existingHealthieId && (
            <div style={{ marginBottom: '1rem', color: '#854d0e' }}>
              <strong>Healthie Patient ID:</strong> {duplicateInfo.existingHealthieId}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleForceCreate}
              disabled={saving}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: '#22c55e',
                color: 'white',
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'Creating...' : '✅ Link to Healthie & Create Patient'}
            </button>
            <button
              type="button"
              onClick={() => setDuplicateInfo(null)}
              disabled={saving}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid #d1d5db',
                background: 'white',
                color: '#374151',
                fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="submit"
          disabled={isDisabled}
          style={{
            padding: '0.6rem 1.4rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: saving ? 'rgba(148, 163, 184, 0.35)' : '#38bdf8',
            color: '#0f172a',
            fontWeight: 600,
            cursor: isDisabled ? 'not-allowed' : 'pointer'
          }}
        >
          {saving ? 'Adding…' : isReadOnly ? 'View Only' : 'Add Patient'}
        </button>
        {message && <span style={{ color: duplicateInfo ? '#854d0e' : '#38bdf8' }}>{message}</span>}
      </div>
    </form>
  );
}

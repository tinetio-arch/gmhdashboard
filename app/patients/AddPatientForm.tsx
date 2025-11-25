'use client';

import { useMemo, useState } from 'react';
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
  phoneNumber: string;
  email: string;
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

  const [form, setForm] = useState<FormState>({
    patientName: '',
    statusKey: defaultStatus,
    paymentMethodKey: null,
    clientTypeKey: null,
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
  const isReadOnly = currentUserRole === 'read';
  const isDisabled = saving || isReadOnly;

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
    if (!form.email || !form.email.trim()) {
      setMessage('Email is required.');
      return;
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      setMessage('Please enter a valid email address.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(withBasePath('/api/patients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: cleanedName,
          statusKey: form.statusKey,
          paymentMethodKey: form.paymentMethodKey,
          clientTypeKey: form.clientTypeKey,
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
          isVerified: false
        })
      });
      if (!response.ok) {
        throw new Error('Failed to create patient');
      }
      setForm({
        patientName: '',
        statusKey: defaultStatus,
        paymentMethodKey: null,
        clientTypeKey: null,
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
      console.error(error);
      setMessage('Unable to add patient.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={cardStyle}>
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
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Client Type</label>
          <select
            value={form.clientTypeKey ?? ''}
            onChange={(event) => updateForm('clientTypeKey', event.target.value || null)}
            style={inputStyle}
            disabled={isDisabled}
          >
            <option value="">(Unspecified)</option>
            {lookups.clientTypes.map((type) => (
              <option key={type.type_key} value={type.type_key}>
                {type.display_name}
              </option>
            ))}
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
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Email *</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateForm('email', event.target.value)}
            style={inputStyle}
            placeholder="jane.doe@example.com"
            disabled={isDisabled}
            required
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
        {message && <span style={{ color: '#38bdf8' }}>{message}</span>}
      </div>
    </form>
  );
}

'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';
import { TESTOSTERONE_VENDORS, DEFAULT_TESTOSTERONE_DEA_CODE } from '@/lib/testosterone';

type StatusState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

type Props = {
  onCompleted?: () => void;
  currentUserRole: UserRole;
};

const fieldStyle: CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  fontSize: '0.95rem',
  color: '#0f172a',
  backgroundColor: '#ffffff',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
};

function InputLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: '#475569', flex: 1 }}>
      <span style={{ fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

function StatusBanner({ state }: { state: StatusState }) {
  if (state.type === 'idle' || state.type === 'loading') return null;
  const palette =
    state.type === 'success'
      ? { bg: 'rgba(74, 222, 128, 0.18)', color: '#047857', border: '1px solid rgba(52, 211, 153, 0.4)' }
      : { bg: 'rgba(248, 113, 113, 0.18)', color: '#b91c1c', border: '1px solid rgba(248, 113, 113, 0.4)' };
  return (
    <div
      style={{
        marginTop: '0.85rem',
        padding: '0.65rem 0.8rem',
        borderRadius: '0.6rem',
        backgroundColor: palette.bg,
        color: palette.color,
        border: palette.border
      }}
    >
      {state.message}
    </div>
  );
}

export default function BulkReceiveForm({ onCompleted, currentUserRole }: Props) {
  const [count, setCount] = useState(10);
  const [formulation, setFormulation] = useState<(typeof TESTOSTERONE_VENDORS)[number]>(TESTOSTERONE_VENDORS[0]);
  const [lotNumber, setLotNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [dateReceived, setDateReceived] = useState('');
  const [controlled, setControlled] = useState(true);
  const [location, setLocation] = useState<'TCMH Office Safe' | 'GMH OFFICE Safe'>('TCMH Office Safe');
  const [startingExternalId, setStartingExternalId] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<StatusState>({ type: 'idle' });

  const loading = status.type === 'loading';
  const isReadOnly = currentUserRole === 'read';
  const isDisabled = loading || isReadOnly;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly) {
      setStatus({ type: 'error', message: 'You do not have permission to receive vials.' });
      return;
    }
    setStatus({ type: 'loading' });
    try {
      const normalizedStartId = startingExternalId.trim();
      const response = await fetch(withBasePath('/api/inventory/vials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count,
          autoGenerate: normalizedStartId.length === 0,
          externalId: normalizedStartId.length ? normalizedStartId : null,
          sizeMl: Number(
            formulation.toLowerCase().includes('toprx') ? 10 : 30
          ),
          lotNumber: lotNumber || null,
          expirationDate: expirationDate || null,
          dateReceived: dateReceived || null,
          controlledSubstance: controlled,
          deaDrugName: controlled ? formulation : null,
          deaDrugCode: controlled ? DEFAULT_TESTOSTERONE_DEA_CODE : null,
          location,
          notes: notes || null
        })
      });
      
      // Check content type before parsing JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
      }
      
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to receive vials.');
      }
      const createdCount = Array.isArray(payload?.created) ? payload.created.length : 1;
      setStatus({ type: 'success', message: `Received ${createdCount} vial${createdCount === 1 ? '' : 's'} successfully.` });
      setNotes('');
      setStartingExternalId('');
      onCompleted?.();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  return (
    <section
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.85rem',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        padding: '1.5rem',
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)'
      }}
    >
      <header style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Receive Bulk Vials</h3>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
          Mirrors the Google Sheet workflow—choose formulation, count, and lot information to auto-generate sequential vial IDs.
        </p>
      </header>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <InputLabel label="Count">
            <input
              type="number"
              min={1}
              value={count}
              onChange={(event) => setCount(Number(event.target.value) || 1)}
              style={fieldStyle}
              disabled={isDisabled}
            />
          </InputLabel>
          <InputLabel label="Formulation">
            <select
              value={formulation}
              onChange={(event) => setFormulation(event.target.value as (typeof TESTOSTERONE_VENDORS)[number])}
              style={fieldStyle}
              disabled={isDisabled}
            >
              {TESTOSTERONE_VENDORS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </InputLabel>
          <InputLabel label="Lot #">
            <input
              value={lotNumber}
              onChange={(event) => setLotNumber(event.target.value)}
              style={fieldStyle}
              placeholder="ABC123"
              required
              disabled={isDisabled}
            />
          </InputLabel>
          <InputLabel label="Expiration">
            <input
              type="date"
              value={expirationDate}
              onChange={(event) => setExpirationDate(event.target.value)}
              style={fieldStyle}
              required
              disabled={isDisabled}
            />
          </InputLabel>
          <InputLabel label="Date Received">
            <input
              type="date"
              value={dateReceived}
              onChange={(event) => setDateReceived(event.target.value)}
              style={fieldStyle}
              required
              disabled={isDisabled}
            />
          </InputLabel>
          <InputLabel label="Starting Vial ID (optional)">
            <input
              value={startingExternalId}
              onChange={(event) => setStartingExternalId(event.target.value.toUpperCase())}
              style={fieldStyle}
              placeholder="e.g. V0006"
              disabled={isDisabled}
            />
          </InputLabel>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={controlled}
              onChange={(event) => setControlled(event.target.checked)}
              disabled={isDisabled}
            />
            Controlled Substance
          </label>
          <InputLabel label="DEA Code">
            <input
              value={DEFAULT_TESTOSTERONE_DEA_CODE}
              readOnly
              style={{ ...fieldStyle, backgroundColor: '#f1f5f9' }}
            />
          </InputLabel>
          <InputLabel label="Location">
            <select
              value={location}
                  onChange={(event) => setLocation(event.target.value as 'TCMH Office Safe' | 'GMH OFFICE Safe')}
              style={fieldStyle}
              disabled={isDisabled}
            >
              <option value="TCMH Office Safe">TCMH Office Safe</option>
              <option value="GMH OFFICE Safe">GMH OFFICE Safe</option>
            </select>
          </InputLabel>
        </div>

        <InputLabel label="Notes">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            style={{ ...fieldStyle, minHeight: '80px', resize: 'vertical' }}
            placeholder="Shipment notes, vendor, etc."
            disabled={isDisabled}
          />
        </InputLabel>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="submit"
            disabled={isDisabled}
            style={{
              padding: '0.6rem 1.4rem',
              borderRadius: '0.6rem',
              border: 'none',
              background: loading ? 'rgba(148, 163, 184, 0.4)' : '#38bdf8',
              color: '#0f172a',
              fontWeight: 600,
              cursor: isDisabled ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Receiving…' : isReadOnly ? 'View Only' : 'Receive Vials'}
          </button>
        </div>
      </form>
      <StatusBanner state={status} />
    </section>
  );
}


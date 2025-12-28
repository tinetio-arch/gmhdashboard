'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PatientOption } from '@/lib/patientQueries';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';
import {
  DEFAULT_TESTOSTERONE_DEA_CODE,
  DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
  DEFAULT_TESTOSTERONE_PRESCRIBER,
  DEFAULT_TESTOSTERONE_VENDOR,
  TESTOSTERONE_VENDORS
} from '@/lib/testosterone';
import { computeLabStatus } from '@/lib/patientFormatting';

type StatusState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

type VialOption = {
  vial_id: string;
  external_id: string | null;
  remaining_volume_ml: string | null;
  size_ml: string | null;
  status: string | null;
  dea_drug_name: string | null;
};

type Props = {
  patients: PatientOption[];
  vials: VialOption[];
  onSaved?: () => void;
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

const summaryBoxStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '0.85rem',
  padding: '0.95rem 1rem',
  borderRadius: '0.65rem',
  backgroundColor: '#f8fafc',
  border: '1px solid rgba(148, 163, 184, 0.22)'
};

const summaryItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  color: '#0f172a'
};

const warningStyle: CSSProperties = {
  padding: '0.65rem 0.9rem',
  borderRadius: '0.6rem',
  backgroundColor: 'rgba(248, 113, 113, 0.16)',
  border: '1px solid rgba(248, 113, 113, 0.35)',
  color: '#b91c1c',
  fontWeight: 600
};

const emptyInventoryStyle: CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '0.85rem',
  border: '1px solid rgba(248, 113, 113, 0.35)',
  padding: '1.5rem',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  color: '#b91c1c'
};

const WASTE_PER_SYRINGE = 0.1;

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

function toIsoDate(date: string): string {
  if (!date) {
    throw new Error('Dispense date required.');
  }
  return `${date}T00:00:00Z`;
}

function parseRegimenDose(regimen: string | null): number | null {
  if (!regimen) return null;
  const match = regimen.match(/(\d+(?:\.\d+)?)\s*(?:ml|mL)?/);
  return match ? Number.parseFloat(match[1]) : null;
}

function inferVialVendor(vial: VialOption | null): (typeof TESTOSTERONE_VENDORS)[number] {
  if (!vial) {
    return DEFAULT_TESTOSTERONE_VENDOR;
  }
  const name = (vial.dea_drug_name ?? '').toLowerCase();
  if (name.includes('toprx') || name.includes('cottonseed')) {
    return TESTOSTERONE_VENDORS[1];
  }
  if (name.includes('carrie') || name.includes('miglyol') || name.includes('pre-filled')) {
    return TESTOSTERONE_VENDORS[0];
  }
  const size = Number.parseFloat(vial.size_ml ?? '0');
  if (Number.isFinite(size) && size >= 20) {
    return TESTOSTERONE_VENDORS[0];
  }
  return TESTOSTERONE_VENDORS[1];
}

function formatMl(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(2)} mL`;
}

export default function TransactionForm({ patients, vials, onSaved, currentUserRole }: Props) {
  const [dispenseDate, setDispenseDate] = useState('');
  const [transactionType, setTransactionType] = useState('Dispense');
  const [selectedVialId, setSelectedVialId] = useState<string>('');
  const [dispenseEntireVial, setDispenseEntireVial] = useState(false);

  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientNameOverride, setPatientNameOverride] = useState('');
  const [dosePerSyringe, setDosePerSyringe] = useState('');
  const [syringes, setSyringes] = useState('');
  const [notes, setNotes] = useState('');
  const [prescriber, setPrescriber] = useState(DEFAULT_TESTOSTERONE_PRESCRIBER);
  const [deaDrugName, setDeaDrugName] = useState<(typeof TESTOSTERONE_VENDORS)[number]>(DEFAULT_TESTOSTERONE_VENDOR);
  const [status, setStatus] = useState<StatusState>({ type: 'idle' });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [splitNextVialId, setSplitNextVialId] = useState('');

  const loading = status.type === 'loading';
  const canRecord = currentUserRole !== 'read';

  const vialOptions = useMemo(
    () =>
      vials.map((vial) => {
        const remaining = Number.parseFloat(vial.remaining_volume_ml ?? '0');
        return {
          ...vial,
          remaining_numeric: Number.isNaN(remaining) ? 0 : remaining
        };
      }),
    [vials]
  );

  const selectedVial = useMemo(() => vialOptions.find((vial) => vial.vial_id === selectedVialId) ?? null, [vialOptions, selectedVialId]);
  const selectedRemaining = selectedVial?.remaining_numeric ?? 0;
  const selectedVialLabel = selectedVial ? selectedVial.external_id ?? selectedVial.vial_id : 'No vial selected';

  useEffect(() => {
    if (!selectedVialId && vialOptions.length > 0) {
      const first = vialOptions[0];
      setSelectedVialId(first.vial_id);
      setDeaDrugName(inferVialVendor(first));
    }
  }, [selectedVialId, vialOptions]);

  const patientLookup = useMemo(() => new Map(patients.map((patient) => [patient.patient_id, patient])), [patients]);
  const selectedPatient = selectedPatientId ? patientLookup.get(selectedPatientId) ?? null : null;
  const patientLabInfo = useMemo(() => {
    if (!selectedPatient) return null;
    return computeLabStatus(selectedPatient.last_lab ?? null, selectedPatient.next_lab ?? null);
  }, [selectedPatient]);
  const patientStatusKey = selectedPatient?.status_key?.toLowerCase() ?? null;
  const labReviewNeeded =
    patientStatusKey === 'active_pending' ||
    (patientLabInfo ? patientLabInfo.state === 'overdue' || patientLabInfo.state === 'due-soon' : false);
  const labStatusLabel =
    patientLabInfo?.label ??
    selectedPatient?.lab_status ??
    'No lab data';
  const regimenDisplay =
    selectedPatient?.regimen && selectedPatient.regimen.trim().length > 0 ? selectedPatient.regimen : '—';
  const filteredPatients = useMemo(() => {
    const query = patientQuery.trim().toLowerCase();
    if (!query) {
      return patients.slice(0, 50);
    }
    return patients
      .filter((patient) => {
        const name = patient.patient_name.toLowerCase();
        const type = (patient.type_of_client ?? '').toLowerCase();
        const cleanedName = name.replace(/[,/]/g, ' ');
        const tokens = cleanedName.split(/\s+/).filter(Boolean);
        const tokenMatch = tokens.some((token) => token.startsWith(query));
        const reversed = tokens.slice().reverse();
        const lastNameMatch = reversed.length > 0 && reversed[0].startsWith(query);
        return name.includes(query) || tokenMatch || lastNameMatch || type.includes(query);
      })
      .slice(0, 50);
  }, [patientQuery, patients]);

  const doseValue = Number.parseFloat(dosePerSyringe);
  const validDose = Number.isFinite(doseValue) && doseValue > 0;
  const syringeCount = Number.parseInt(syringes, 10);
  const validSyringes = Number.isFinite(syringeCount) && syringeCount > 0;

  const computedDispensed = dispenseEntireVial
    ? Number(selectedRemaining.toFixed(3))
    : validDose && validSyringes
      ? Number((doseValue * syringeCount).toFixed(3))
      : 0;

  const computedWaste = dispenseEntireVial
    ? 0
    : validSyringes
      ? Number((syringeCount * WASTE_PER_SYRINGE).toFixed(3))
      : 0;

  const totalRemoval = Number((computedDispensed + computedWaste).toFixed(3));
  const remainingAfter = Number(Math.max(selectedRemaining - totalRemoval, 0).toFixed(3));
  const perSyringeRemoval =
    !dispenseEntireVial && validDose ? Number((doseValue + WASTE_PER_SYRINGE).toFixed(3)) : null;
  const removalExceedsVial = !dispenseEntireVial && selectedVial !== null && totalRemoval > selectedRemaining + 0.0001;
  const removalShortfall = removalExceedsVial ? Number((totalRemoval - selectedRemaining).toFixed(3)) : 0;

  function handleVialChange(id: string) {
    setSelectedVialId(id);
    const next = vialOptions.find((vial) => vial.vial_id === id) ?? null;
    setDeaDrugName(inferVialVendor(next));
  }

  function handlePatientSelect(patient: PatientOption) {
    setSelectedPatientId(patient.patient_id);
    setPatientQuery(patient.patient_name ?? '');
    setPatientNameOverride('');
    setShowSuggestions(false);
    const regimenDose = parseRegimenDose(patient.regimen);
    if (regimenDose !== null && !dispenseEntireVial) {
      setDosePerSyringe(regimenDose.toString());
    }
  }

  function handlePatientInput(value: string) {
    setPatientQuery(value);
    setShowSuggestions(true);
    setSelectedPatientId('');
  }

  const finalPatientName =
    (patientNameOverride.trim() ||
      (selectedPatient?.patient_name ?? '') ||
      patientQuery.trim()) ||
    null;

  async function handleSplitAcrossVials() {
    if (!removalExceedsVial) {
      return;
    }
    if (!selectedVial) {
      setStatus({ type: 'error', message: 'Select an inventory vial before splitting.' });
      return;
    }
    if (!finalPatientName) {
      setStatus({ type: 'error', message: 'Select or enter a patient before splitting.' });
      return;
    }
    if (!perSyringeRemoval || perSyringeRemoval <= 0 || !validDose) {
      setStatus({
        type: 'error',
        message: 'Provide a regimen dose and syringe count to determine how to split across vials.'
      });
      return;
    }
    if (!validSyringes) {
      setStatus({ type: 'error', message: 'Syringe count is required to split across vials.' });
      return;
    }
    if (!splitNextVialId) {
      setStatus({ type: 'error', message: 'Choose the next vial to continue dispensing.' });
      return;
    }

    const nextVial = vialOptions.find((v) => v.vial_id === splitNextVialId) ?? null;
    if (!nextVial) {
      setStatus({ type: 'error', message: 'Selected next vial is no longer available.' });
      return;
    }

    const totalSyringes = syringeCount;
    const predictedCurrentSyringes = Math.min(
      totalSyringes,
      Math.max(1, Math.round(selectedRemaining / perSyringeRemoval))
    );
    const doseCurrent = Number((predictedCurrentSyringes * doseValue).toFixed(3));
    let wasteCurrent = Number((predictedCurrentSyringes * WASTE_PER_SYRINGE).toFixed(3));
    const delta = Number((selectedRemaining - (doseCurrent + wasteCurrent)).toFixed(3));
    if (delta > 0) {
      wasteCurrent = Number((wasteCurrent + delta).toFixed(3));
    }
    const removalCurrent = Number((doseCurrent + wasteCurrent).toFixed(3));

    const remainingRemoval = Number((totalRemoval - removalCurrent).toFixed(3));
    const remainingDispensed = Number((computedDispensed - doseCurrent).toFixed(3));
    const remainingWaste = Number((computedWaste - wasteCurrent).toFixed(3));
    const remainingSyringes = Math.max(totalSyringes - predictedCurrentSyringes, 0);
    const fallbackSyringes = perSyringeRemoval > 0 ? Math.max(1, Math.round(remainingRemoval / perSyringeRemoval)) : 0;
    const nextSyringes = remainingSyringes > 0 ? remainingSyringes : fallbackSyringes;

    const doseNext = Number((remainingDispensed > 0 ? remainingDispensed : nextSyringes * doseValue).toFixed(3));
    let wasteNext = Number((remainingWaste > 0 ? remainingWaste : nextSyringes * WASTE_PER_SYRINGE).toFixed(3));
    const correction = Number((remainingRemoval - (doseNext + wasteNext)).toFixed(3));
    if (Math.abs(correction) > 0.005) {
      wasteNext = Number((wasteNext + correction).toFixed(3));
    }

    const nextVendor = inferVialVendor(nextVial);

    setStatus({ type: 'loading' });
    try {
      const firstResponse = await fetch(withBasePath('/api/inventory/transactions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vialExternalId: selectedVial.external_id ?? selectedVial.vial_id,
          dispenseDate: toIsoDate(dispenseDate),
          transactionType,
          patientId: selectedPatientId || null,
          patientName: finalPatientName,
          totalDispensedMl: doseCurrent,
          syringeCount: predictedCurrentSyringes,
          dosePerSyringeMl: Number(doseValue.toFixed(3)),
          wasteMl: wasteCurrent,
          totalAmount: removalCurrent,
          notes: notes.trim() || null,
          prescriber: prescriber.trim() || null,
          deaSchedule: DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
          deaDrugName: deaDrugName,
          deaDrugCode: DEFAULT_TESTOSTERONE_DEA_CODE,
          recordDea: true,
          signatureStatus: 'awaiting_signature'
        })
      });
      const payloadCurrent = await firstResponse.json().catch(() => ({}));
      if (!firstResponse.ok) {
        throw new Error(payloadCurrent?.error ?? 'Unable to record dispense for the current vial.');
      }

      if (remainingRemoval > 0.01) {
        const secondResponse = await fetch(withBasePath('/api/inventory/transactions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vialExternalId: nextVial.external_id ?? nextVial.vial_id,
            dispenseDate: toIsoDate(dispenseDate),
            transactionType,
            patientId: selectedPatientId || null,
            patientName: finalPatientName,
            totalDispensedMl: Math.max(doseNext, 0),
            syringeCount: nextSyringes > 0 ? nextSyringes : null,
            dosePerSyringeMl: Number(doseValue.toFixed(3)),
            wasteMl: Math.max(wasteNext, 0),
            totalAmount: Math.max(remainingRemoval, 0),
            notes: notes.trim() || null,
            prescriber: prescriber.trim() || null,
            deaSchedule: DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
            deaDrugName: nextVendor,
            deaDrugCode: DEFAULT_TESTOSTERONE_DEA_CODE,
            recordDea: true,
            signatureStatus: 'awaiting_signature'
          })
        });
        const payloadNext = await secondResponse.json().catch(() => ({}));
        if (!secondResponse.ok) {
          throw new Error(payloadNext?.error ?? 'Unable to record dispense for the next vial.');
        }
      }

      setSelectedVialId(nextVial.vial_id);
      setDeaDrugName(nextVendor);
      setSplitNextVialId('');
      setSyringes('');
      onSaved?.();
      setStatus({
        type: 'success',
        message: `Finished vial ${selectedVial.external_id ?? selectedVial.vial_id} and logged the remaining ${remainingRemoval > 0 ? `${remainingRemoval.toFixed(2)} mL` : ''} on ${nextVial.external_id ?? nextVial.vial_id}.`
      });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord) {
      setStatus({ type: 'error', message: 'You do not have permission to record transactions.' });
      return;
    }
    if (!dispenseDate) {
      setStatus({ type: 'error', message: 'Dispense date is required.' });
      return;
    }
    if (!selectedVial) {
      setStatus({ type: 'error', message: 'Select an inventory vial.' });
      return;
    }
    if (!finalPatientName) {
      setStatus({ type: 'error', message: 'Select or enter a patient name.' });
      return;
    }
    if (!dispenseEntireVial && (!validDose || !validSyringes)) {
      setStatus({ type: 'error', message: 'Provide regimen dosage and syringe count.' });
      return;
    }
    if (totalRemoval <= 0) {
      setStatus({ type: 'error', message: 'Calculated removal must be greater than zero.' });
      return;
    }
    if (removalExceedsVial) {
      setStatus({
        type: 'error',
        message: `Selected vial only has ${selectedRemaining.toFixed(2)} mL remaining. Use the split helper below to finish this vial and continue with another.`
      });
      return;
    }

    setStatus({ type: 'loading' });
    try {
      const payload = {
        vialExternalId: selectedVial.external_id ?? selectedVial.vial_id,
        dispenseDate: toIsoDate(dispenseDate),
        transactionType,
        patientId: selectedPatientId || null,
        patientName: finalPatientName,
        totalDispensedMl: computedDispensed,
        syringeCount: !dispenseEntireVial && validSyringes ? syringeCount : null,
        dosePerSyringeMl: !dispenseEntireVial && validDose ? Number(doseValue.toFixed(3)) : null,
        wasteMl: computedWaste,
        totalAmount: totalRemoval,
        notes: notes.trim() || null,
        prescriber: prescriber.trim() || null,
        deaSchedule: DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
        deaDrugName,
        deaDrugCode: DEFAULT_TESTOSTERONE_DEA_CODE,
        recordDea: true,
        signatureStatus: 'awaiting_signature'
      };

      const response = await fetch(withBasePath('/api/inventory/transactions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? 'Unable to record transaction.');
      }

      const message =
        remainingAfter >= 0
          ? `Transaction saved. Remaining volume in ${selectedVialLabel}: ${remainingAfter.toFixed(2)} mL.`
          : 'Transaction saved.';

      setStatus({ type: 'success', message });
      setNotes('');
      setDispenseEntireVial(false);
      setSyringes('');
      onSaved?.();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  if (vialOptions.length === 0) {
    return (
      <section style={emptyInventoryStyle}>
        <h3 style={{ margin: 0, fontSize: '1.3rem' }}>No active testosterone vials available</h3>
        <p style={{ marginTop: '0.75rem' }}>
          Receive inventory in the <strong>Inventory</strong> workspace before logging dispenses.
        </p>
      </section>
    );
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
        <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Log Testosterone Dispense</h3>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
          Automatically tracks medication volume, mandated 0.1 mL waste per syringe, and updates the DEA ledger.
        </p>
      </header>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <InputLabel label="Date">
            <input
              type="date"
              value={dispenseDate}
              onChange={(event) => setDispenseDate(event.target.value)}
              style={fieldStyle}
              required
            />
          </InputLabel>
          <InputLabel label="Inventory Vial">
            <select
              value={selectedVialId}
              onChange={(event) => handleVialChange(event.target.value)}
              style={fieldStyle}
              required
            >
              {vialOptions.map((vial) => (
                <option key={vial.vial_id} value={vial.vial_id}>
                  {(vial.external_id ?? vial.vial_id) + ` · ${vial.remaining_numeric.toFixed(2)} mL remaining`}
                </option>
              ))}
            </select>
          </InputLabel>
          <InputLabel label="Transaction Type">
            <select value={transactionType} onChange={(event) => setTransactionType(event.target.value)} style={fieldStyle}>
              <option value="Dispense">Dispense</option>
              <option value="Waste">Waste</option>
              <option value="Return">Return</option>
            </select>
          </InputLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 220px' }}>
            <input
              id="entire-vial"
              type="checkbox"
              checked={dispenseEntireVial}
              onChange={(event) => {
                setDispenseEntireVial(event.target.checked);
                if (event.target.checked) {
                  setSyringes('');
                }
              }}
            />
            <label htmlFor="entire-vial" style={{ color: '#0f172a', fontWeight: 600 }}>
              Dispense entire vial
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ flex: '1 1 280px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Patient Search
            </span>
            <input
              value={patientQuery}
              onChange={(event) => handlePatientInput(event.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              placeholder="Start typing last name…"
              style={fieldStyle}
              disabled={!canRecord}
            />
            {showSuggestions && filteredPatients.length > 0 && (
              <ul
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  borderRadius: '0.5rem',
                  margin: 0,
                  marginTop: '0.35rem',
                  padding: '0.3rem 0',
                  listStyle: 'none',
                  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
                  maxHeight: '240px',
                  overflowY: 'auto',
                  zIndex: 5
                }}
              >
                {filteredPatients.map((patient) => (
                  <li key={patient.patient_id}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
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
                        {patient.type_of_client ?? '—'}
                        {patient.date_of_birth ? ` · ${patient.date_of_birth}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <InputLabel label="Regimen">
            <input
              value={regimenDisplay}
              readOnly
              style={{ ...fieldStyle, backgroundColor: '#f1f5f9' }}
            />
          </InputLabel>
          <InputLabel label="Patient Name Override">
            <input
              value={patientNameOverride}
              onChange={(event) => setPatientNameOverride(event.target.value)}
              style={fieldStyle}
              placeholder="Defaults to selected patient"
            />
          </InputLabel>
          <InputLabel label="Dose per Syringe (mL)">
            <input
              type="number"
              step="0.01"
              value={dosePerSyringe}
              onChange={(event) => setDosePerSyringe(event.target.value)}
              style={{ ...fieldStyle, backgroundColor: dispenseEntireVial ? '#f1f5f9' : '#ffffff' }}
              disabled={dispenseEntireVial}
              placeholder="e.g. 0.50"
            />
          </InputLabel>
          <InputLabel label="# of Syringes">
            <input
              type="number"
              min={1}
              value={syringes}
              onChange={(event) => setSyringes(event.target.value)}
              style={{ ...fieldStyle, backgroundColor: dispenseEntireVial ? '#f1f5f9' : '#ffffff' }}
              disabled={dispenseEntireVial}
              placeholder="Total syringes (e.g. 16)"
            />
          </InputLabel>
        </div>

        {labReviewNeeded && selectedPatient && (
          <div style={{ ...warningStyle, marginTop: '0.5rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
              Lab review required for {selectedPatient.patient_name}.
            </strong>
            <span style={{ display: 'block', fontSize: '0.9rem' }}>
              Current lab status: {labStatusLabel}. Please verify labs or update status before dispensing.
            </span>
          </div>
        )}

        {removalExceedsVial && (
          <div style={warningStyle}>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {selectedVialLabel} only has {selectedRemaining.toFixed(2)} mL remaining. Finish this vial, then continue with another.
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
              Remaining volume needed: {removalShortfall.toFixed(2)} mL
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 260px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#b91c1c' }}>
                  Next Vial
                </span>
                <select
                  value={splitNextVialId}
                  onChange={(event) => setSplitNextVialId(event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Select next vial…</option>
                  {vialOptions
                    .filter((vial) => vial.vial_id !== selectedVial.vial_id && vial.remaining_numeric > 0)
                    .map((vial) => (
                      <option key={vial.vial_id} value={vial.vial_id}>
                        {(vial.external_id ?? vial.vial_id) + ` · ${vial.remaining_numeric.toFixed(2)} mL remaining`}
                      </option>
                    ))}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleSplitAcrossVials}
                  style={{
                    padding: '0.55rem 1.35rem',
                    borderRadius: '0.6rem',
                    border: '1px solid rgba(248, 113, 113, 0.5)',
                    backgroundColor: '#fee2e2',
                    color: '#b91c1c',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Finish vial & continue
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={summaryBoxStyle}>
          <div style={summaryItemStyle}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.08em' }}>
              Medication Volume
            </span>
            <strong style={{ fontSize: '1.1rem' }}>{formatMl(computedDispensed)}</strong>
          </div>
          <div style={summaryItemStyle}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.08em' }}>
              Waste (0.1 mL × syringes)
            </span>
            <strong style={{ fontSize: '1.1rem' }}>{formatMl(computedWaste)}</strong>
          </div>
          <div style={summaryItemStyle}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.08em' }}>
              Total Removal
            </span>
            <strong style={{ fontSize: '1.1rem', color: '#1d4ed8' }}>{formatMl(totalRemoval)}</strong>
          </div>
          <div style={summaryItemStyle}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.08em' }}>
              Remaining in {selectedVialLabel}
            </span>
            <strong style={{ fontSize: '1.1rem' }}>{formatMl(remainingAfter)}</strong>
          </div>
          {selectedPatient && (
            <div style={summaryItemStyle}>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.08em' }}>
                Lab Status
              </span>
              <strong style={{ fontSize: '1.05rem', color: labReviewNeeded ? '#b91c1c' : '#0f172a' }}>
                {labStatusLabel}
              </strong>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <InputLabel label="Prescriber">
            <input value={prescriber} onChange={(event) => setPrescriber(event.target.value)} style={fieldStyle} />
          </InputLabel>
          <InputLabel label="DEA Schedule">
            <input value={DEFAULT_TESTOSTERONE_DEA_SCHEDULE} style={{ ...fieldStyle, backgroundColor: '#f1f5f9' }} readOnly />
          </InputLabel>
          <InputLabel label="DEA Drug Name">
            <select
              value={deaDrugName}
              onChange={(event) => setDeaDrugName(event.target.value as (typeof TESTOSTERONE_VENDORS)[number])}
              style={fieldStyle}
            >
              {TESTOSTERONE_VENDORS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </InputLabel>
          <InputLabel label="DEA Drug Code">
            <input value={DEFAULT_TESTOSTERONE_DEA_CODE} style={{ ...fieldStyle, backgroundColor: '#f1f5f9' }} readOnly />
          </InputLabel>
        </div>

        <InputLabel label="Notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} style={{ ...fieldStyle, minHeight: '80px', resize: 'vertical' }} />
        </InputLabel>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="submit"
            disabled={loading || !canRecord}
            style={{
              padding: '0.6rem 1.4rem',
              borderRadius: '0.6rem',
              border: 'none',
              background: loading ? 'rgba(148, 163, 184, 0.4)' : '#22c55e',
              color: '#0f172a',
              fontWeight: 600,
              cursor: loading ? 'wait' : canRecord ? 'pointer' : 'not-allowed'
            }}
          >
            {loading ? 'Saving…' : canRecord ? 'Save Transaction' : 'View Only'}
          </button>
        </div>
      </form>
      <StatusBanner state={status} />
    </section>
  );
}


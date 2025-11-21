'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { PatientDataEntryRow, ProfessionalPatient } from '@/lib/patientQueries';
import type { LookupSets } from '@/lib/lookups';
import { computeLabStatus, deriveRowColors } from '@/lib/patientFormatting';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';
import Link from 'next/link';

type EditablePatient = {
  id: string;
  patientName: string;
  alertStatus: string | null;
  statusKey: string | null;
  statusRowColor: string | null;
  statusAlertColor: string | null;
  paymentMethodKey: string | null;
  methodOfPayment: string | null;
  paymentMethodColor: string | null;
  clientTypeKey: string | null;
  typeOfClient: string | null;
  clientTypeColor: string | null;
  isPrimaryCare: boolean;
  regimen: string;
  labStatus: string;
  patientNotes: string;
  labNotes: string;
  lastLab: string;
  nextLab: string;
  serviceStartDate: string;
  contractEnd: string;
  dateOfBirth: string;
  address: string;
  phoneNumber: string;
  addedBy: string;
  dateAdded: string;
  lastModified: string;
  email: string;
  membershipOwes: string;
  lastSupplyDate: string;
  eligibleForNextSupply: string;
  lastSupplyFromDea: boolean;
};

type EditableFieldKey = keyof EditablePatient;

type Props = {
  patients: PatientDataEntryRow[];
  lookups: LookupSets;
  professionalPatients: ProfessionalPatient[];
  currentUserRole: UserRole;
  currentUserEmail: string;
};

type EditableCellProps = {
  rowId: string;
  field: EditableFieldKey;
  cellStyle: CSSProperties;
  display: ReactNode;
  renderEditor: (helpers: { onBlur: () => void }) => ReactNode;
  allowEdit?: boolean;
};

const tableWrapperStyles: CSSProperties = {
  position: 'relative',
  borderRadius: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  background: '#ffffff',
  overflow: 'visible'
};

const tableStyles: CSSProperties = {
  width: 'max-content',
  minWidth: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: '0.9rem',
  tableLayout: 'auto'
};

const headerRowContainerStyles: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 6,
  backgroundColor: '#f1f5f9'
};

const cellStyles: CSSProperties = {
  padding: '0.35rem 0.45rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
  verticalAlign: 'top',
  minWidth: '150px',
  color: '#0f172a',
  whiteSpace: 'nowrap'
};

const headerCellStyles: CSSProperties = {
  ...cellStyles,
  textAlign: 'left',
  color: '#475569',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  backgroundColor: '#f1f5f9',
  position: 'sticky',
  top: 0,
  zIndex: 5
};

const narrowCell: CSSProperties = {
  ...cellStyles,
  minWidth: '120px'
};

const compactCell: CSSProperties = {
  ...cellStyles,
  minWidth: '100px'
};

const selectStyle: CSSProperties = {
  width: '100%',
  padding: '0.35rem 0.5rem',
  borderRadius: '0.4rem',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  fontSize: '0.85rem',
  direction: 'ltr',
  textAlign: 'left'
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.25rem 0.4rem',
  borderRadius: '0.4rem',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  lineHeight: 1.2,
  fontSize: '0.85rem',
  direction: 'ltr',
  textAlign: 'left'
};

type NotesEditorProps = {
  rowId: string;
  initialValue: string;
  onCommit: (value: string) => void;
  onBlur: () => void;
};

function NotesEditor({ rowId, initialValue, onCommit, onBlur }: NotesEditorProps) {
  const [value, setValue] = useState(initialValue ?? '');

  useEffect(() => {
    setValue(initialValue ?? '');
  }, [rowId, initialValue]);

  return (
    <textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        onCommit(value);
        onBlur();
      }}
      autoFocus
      rows={2}
      style={{
        ...inputStyle,
        minHeight: '36px',
        resize: 'vertical',
        direction: 'ltr',
        textAlign: 'left'
      }}
    />
  );
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}

function toStringValue(value: unknown): string {
  return toNullableString(value) ?? '';
}

function toBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (!token) return false;
    return ['true', '1', 'yes', 'y', 'on', 'checked'].includes(token);
  }
  return false;
}

function mapPatient(row: PatientDataEntryRow, supplement?: ProfessionalPatient): EditablePatient {
  const extra = supplement ?? null;
  const controlledSource = toNullableString(row.last_controlled_dispense_at ?? extra?.last_controlled_dispense_at);
  const manualSource = toNullableString(row.last_supply_date ?? extra?.last_supply_date);
  const lastSupplyFromDea = Boolean(controlledSource);
  const chosenSupply = lastSupplyFromDea ? controlledSource : manualSource;
  const eligibleSupply = calculateEligibleDate(chosenSupply);
  const normalizedLastLab = toNullableString(row.last_lab ?? extra?.last_lab);
  const normalizedNextLab = toNullableString(row.next_lab ?? extra?.next_lab);
  const providedLabStatus = toNullableString(row.lab_status);
  const labInfo = computeLabStatus(normalizedLastLab ?? null, normalizedNextLab ?? null);
  const derivedLabStatus = providedLabStatus ?? labInfo.label ?? 'No lab data';
  const rawStatusKey = toNullableString(row.status_key);
  const enforcedStatusKey =
    rawStatusKey && rawStatusKey.toLowerCase() === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')
      ? 'active_pending'
      : rawStatusKey;
  const enforcedAlertStatus =
    enforcedStatusKey === 'active_pending'
      ? 'Active - Pending'
      : toNullableString(row.alert_status);
  return {
    id: row.patient_id,
    patientName: toStringValue(row.patient_name),
    alertStatus: enforcedAlertStatus,
    statusKey: enforcedStatusKey,
    statusRowColor: toNullableString(row.status_row_color),
    statusAlertColor: toNullableString(row.status_alert_color),
    paymentMethodKey: toNullableString(row.payment_method_key),
    methodOfPayment: toNullableString(row.method_of_payment),
    paymentMethodColor: toNullableString(row.payment_method_color),
    clientTypeKey: toNullableString(row.client_type_key),
    typeOfClient: toNullableString(row.type_of_client),
    clientTypeColor: toNullableString(row.client_type_color),
    isPrimaryCare: toBooleanValue(row.is_primary_care),
    regimen: toStringValue(row.regimen),
    labStatus: toStringValue(derivedLabStatus),
    patientNotes: toStringValue(row.patient_notes),
    labNotes: toStringValue(row.lab_notes),
    lastLab: toStringValue(normalizedLastLab),
    nextLab: toStringValue(normalizedNextLab),
    serviceStartDate: toStringValue(row.service_start_date ?? extra?.service_start_date),
    contractEnd: toStringValue(row.contract_end ?? extra?.contract_end),
    dateOfBirth: toStringValue(row.date_of_birth ?? extra?.date_of_birth),
    address: toStringValue(row.address ?? row.address_line1 ?? extra?.address),
    phoneNumber: toStringValue(row.phone_number ?? extra?.phone_number),
    addedBy: toStringValue(row.added_by ?? extra?.added_by),
    dateAdded: toStringValue(row.date_added ?? extra?.date_added),
    lastModified: toStringValue(row.last_modified ?? extra?.last_modified),
    email: toStringValue(row.email ?? row.qbo_customer_email ?? extra?.patient_email),
    membershipOwes: toStringValue(row.membership_owes ?? extra?.membership_owes),
    lastSupplyDate: toStringValue(chosenSupply),
    eligibleForNextSupply: toStringValue(eligibleSupply),
    lastSupplyFromDea: lastSupplyFromDea
  };
}

function normaliseDateSource(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === 'string' ? value : String(value);
  return text.trim();
}

function formatDateInput(value: unknown): string {
  const source = normaliseDateSource(value);
  if (!source) return '';
  const date = parseDate(source);
  if (!date) return source;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

function toDateTimeInput(value: unknown): string {
  const source = normaliseDateSource(value);
  if (!source) return '';
  const candidate = source.replace(' ', 'T');
  const isoCandidate = candidate.includes('Z') || candidate.includes('+') ? candidate : `${candidate}Z`;
  const date = new Date(isoCandidate);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 16);
  }
  return candidate.slice(0, 16);
}

function formatDisplayDate(value: unknown): string {
  const formatted = formatDateInput(value);
  return formatted || '—';
}

function parseDate(value: unknown): Date | null {
  const source = normaliseDateSource(value);
  if (!source) return null;
  const shortMatch = source.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (shortMatch) {
    const month = Number(shortMatch[1]);
    const day = Number(shortMatch[2]);
    let year = Number(shortMatch[3]);
    if (year < 100) {
      year += year < 70 ? 2000 : 1900;
    }
    if (
      Number.isInteger(month) &&
      Number.isInteger(day) &&
      Number.isInteger(year) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }
  const candidate = source.replace(' ', 'T');
  const isoCandidate = candidate.includes('Z') || candidate.includes('+') ? candidate : `${candidate}Z`;
  const date = new Date(isoCandidate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normalizeDateValue(value: unknown): string | null {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateEligibleDate(value: string | null): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return '';
  }
  const future = new Date(parsed);
  future.setMonth(future.getMonth() + 2);
  return future.toISOString();
}

function deriveLabLabelFromDates(lastLab: string | null | undefined, nextLab: string | null | undefined): string {
  return computeLabStatus(lastLab ?? null, nextLab ?? null).label || 'No lab data';
}

function statusPriority(row: EditablePatient): number {
  const key = (row.statusKey ?? '').toLowerCase();
  const alert = (row.alertStatus ?? '').toLowerCase();
  const text = key || alert;
  if (text.startsWith('hold')) return 0;
  if (text === 'active_pending' || text === 'active - pending') return 1;
  if (text === 'active') return 2;
  if (text === 'inactive') return 3;
  return 4;
}

function labUrgency(row: EditablePatient): number {
  const key = (row.statusKey ?? '').toLowerCase();
  const alert = (row.alertStatus ?? '').toLowerCase();
  const isPending = key === 'active_pending' || alert === 'active - pending';
  if (!isPending) return 99;
  const status = (row.labStatus ?? '').toLowerCase();
  if (!status) return 3;
  if (status.includes('overdue')) return 0;
  if (status.includes('due')) return 1;
  if (status.includes('current')) return 2;
  return 3;
}

function comparePatients(a: EditablePatient, b: EditablePatient): number {
  const statusDiff = statusPriority(a) - statusPriority(b);
  if (statusDiff !== 0) return statusDiff;

  const labDiff = labUrgency(a) - labUrgency(b);
  if (labDiff !== 0) return labDiff;

  const typeA = (a.typeOfClient ?? '').toLowerCase();
  const typeB = (b.typeOfClient ?? '').toLowerCase();
  if (typeA !== typeB) {
    return typeA < typeB ? 1 : -1;
  }

  return a.patientName.localeCompare(b.patientName);
}

export default function PatientTable({
  patients,
  lookups,
  professionalPatients,
  currentUserRole,
  currentUserEmail
}: Props) {
  const router = useRouter();
  const professionalMap = useMemo(() => {
    const map = new Map<string, ProfessionalPatient>();
    professionalPatients.forEach((record) => {
      map.set(record.patient_id, record);
    });
    return map;
  }, [professionalPatients]);
  const statusLookupByKey = useMemo(() => new Map(lookups.statuses.map((status) => [status.status_key, status])), [lookups.statuses]);
  const methodLookupByKey = useMemo(() => new Map(lookups.paymentMethods.map((method) => [method.method_key, method])), [lookups.paymentMethods]);
  const clientLookupByKey = useMemo(() => new Map(lookups.clientTypes.map((client) => [client.type_key, client])), [lookups.clientTypes]);

  const [rows, setRows] = useState<EditablePatient[]>(() =>
    patients.map((row) => mapPatient(row, professionalMap.get(row.patient_id)))
  );
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<{ rowId: string; field: EditableFieldKey } | null>(null);
  const [pendingValues, setPendingValues] = useState<
    Record<string, Partial<Record<EditableFieldKey, string>>>
  >({});
  const canEdit = currentUserRole !== 'read';
  const canDeletePatient = currentUserRole === 'admin';

  useEffect(() => {
    setRows(patients.map((row) => mapPatient(row, professionalMap.get(row.patient_id))));
  }, [patients, professionalMap]);

  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const autoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  useEffect(
    () => () => {
      Object.values(autoSaveTimers.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    },
    []
  );

  function clearPendingAutoSave(rowId: string) {
    const timer = autoSaveTimers.current[rowId];
    if (timer) {
      clearTimeout(timer);
      delete autoSaveTimers.current[rowId];
    }
  }

  function scheduleAutoSave(rowId: string) {
    if (!canEdit) return;
    clearPendingAutoSave(rowId);
    autoSaveTimers.current[rowId] = setTimeout(() => {
      const latest = rowsRef.current.find((candidate) => candidate.id === rowId);
      if (latest) {
        void handleSave(latest);
      }
      delete autoSaveTimers.current[rowId];
    }, 200);
  }

  const getPendingValue = (rowId: string, field: EditableFieldKey): string | undefined =>
    pendingValues[rowId]?.[field];

  function setPendingValue(rowId: string, field: EditableFieldKey, value: string) {
    setPendingValues((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] ?? {}),
        [field]: value
      }
    }));
  }

  function clearPendingValue(rowId: string, field: EditableFieldKey) {
    setPendingValues((prev) => {
      const entry = prev[rowId];
      if (!entry || !(field in entry)) {
        return prev;
      }
      const { [field]: _, ...rest } = entry;
      const next = { ...prev };
      if (Object.keys(rest).length === 0) {
        delete next[rowId];
      } else {
        next[rowId] = rest;
      }
      return next;
    });
  }

  const filteredRows = useMemo(() => {
    const matches = rows.filter((row) => {
      const matchesStatus = filterStatus === 'all' || row.alertStatus?.toLowerCase() === filterStatus;
      const matchesSearch = !searchTerm || row.patientName.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
    });
    matches.sort(comparePatients);
    return matches;
  }, [rows, filterStatus, searchTerm]);

  const headerLabels = [
    'Patient Name',
    'Alert Status',
    'Method of Payment',
    'Client Type',
    'Regimen',
    'Lab Status',
    'Patient Notes',
    'Last Lab',
    'Next Lab',
    'Service Start',
    'Contract End',
    'DOB',
    'Address',
    'Phone',
    'Added By',
    'Date Added',
    'Last Modified',
    'Last Supply',
    'Eligible Date',
    ...(canDeletePatient ? ['Actions'] : [])
  ];

  const renderText = (value: string | null | undefined): string => {
    if (value === null || value === undefined) return '—';
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '—';
  };

  const EditableCell: React.FC<EditableCellProps> = ({
    rowId,
    field,
    cellStyle,
    display,
    renderEditor,
    allowEdit = true
  }) => {
    const isActive = activeCell?.rowId === rowId && activeCell.field === field;
    const canActivate = allowEdit && canEdit;
    const deactivate = () => {
      setActiveCell((current) => (current && current.rowId === rowId && current.field === field ? null : current));
    };
    const handleBlur = () => {
      deactivate();
      scheduleAutoSave(rowId);
    };

    return (
      <td
        style={cellStyle}
        onDoubleClick={() => {
          if (canActivate) {
            setActiveCell({ rowId, field });
          }
        }}
      >
        {canActivate && isActive
          ? renderEditor({ onBlur: handleBlur })
          : <div style={{ cursor: canActivate ? 'pointer' : 'default', whiteSpace: 'inherit' }}>{display}</div>}
      </td>
    );
  };

  function updateRow(id: string, updater: (row: EditablePatient) => EditablePatient) {
    setRows((prev) => prev.map((row) => (row.id === id ? updater(row) : row)));
  }

  async function handleSave(row: EditablePatient) {
    if (!canEdit) {
      setFeedback('Your account does not have permission to edit patient records.');
      return;
    }
    clearPendingAutoSave(row.id);
    const timestamp = new Date().toISOString();
    setSavingId(row.id);
    setFeedback(null);
    try {
      const response = await fetch(withBasePath(`/api/patients/${row.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: row.patientName,
          statusKey: row.statusKey,
          paymentMethodKey: row.paymentMethodKey,
          clientTypeKey: row.clientTypeKey,
          regimen: row.regimen || null,
          patientNotes: row.patientNotes || null,
          labStatus: row.labStatus || null,
          labNotes: row.labNotes || null,
          lastLab: normalizeDateValue(row.lastLab),
          nextLab: normalizeDateValue(row.nextLab),
          serviceStartDate: normalizeDateValue(row.serviceStartDate),
          contractEndDate: normalizeDateValue(row.contractEnd),
          dateOfBirth: normalizeDateValue(row.dateOfBirth),
          address: row.address || null,
          phoneNumber: row.phoneNumber || null,
          addedBy: currentUserEmail,
          dateAdded: row.dateAdded || timestamp,
          lastModified: timestamp,
          email: row.email || null,
          membershipOwes: row.membershipOwes || null
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to save changes');
      }

      if (payload?.data) {
        const refreshedRow = mapPatient(
          payload.data,
          professionalMap.get(payload.data.patient_id)
        );
        setRows((currentRows) =>
          currentRows.map((candidate) => (candidate.id === row.id ? refreshedRow : candidate))
        );
      } else {
        updateRow(row.id, (current) => ({
          ...current,
          addedBy: currentUserEmail,
          lastModified: timestamp
        }));
      }
      setFeedback('Changes saved');
      setActiveCell(null);
      router.refresh();
    } catch (error) {
      console.error(error);
      setFeedback('Save failed – please try again.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!canDeletePatient) {
      setFeedback('Only administrators can delete patient records.');
      return;
    }
    if (!confirm('Remove this patient from the roster?')) {
      return;
    }
    setSavingId(id);
    setFeedback(null);
    try {
      const response = await fetch(withBasePath(`/api/patients/${id}`), { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Delete request failed');
      }
      setFeedback('Patient removed.');
      router.refresh();
    } catch (error) {
      console.error(error);
      setFeedback('Unable to delete patient.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search patients"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          style={{
            padding: '0.6rem 0.9rem',
            borderRadius: '0.5rem',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: '#ffffff',
            color: '#0f172a',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
          }}
        />
        <select
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value)}
          style={{
            padding: '0.6rem 0.9rem',
            borderRadius: '0.5rem',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: '#ffffff',
            color: '#0f172a',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
          }}
        >
          <option value="all">All statuses</option>
          {lookups.statuses.map((status) => (
            <option key={status.status_key} value={status.display_name.toLowerCase()}>
              {status.display_name}
            </option>
          ))}
        </select>
        {feedback && <span style={{ color: '#38bdf8' }}>{feedback}</span>}
      </div>
      <div style={tableWrapperStyles}>
        <div style={{ overflowX: 'auto', borderRadius: 'inherit' }}>
          <table style={tableStyles}>
            <thead style={headerRowContainerStyles}>
            <tr>
              {headerLabels.map((header) => (
                <th
                  key={header}
                  style={headerCellStyles}
                >
                  {header}
                </th>
              ))}
            </tr>
            </thead>
          <tbody>
            {filteredRows.map((row) => {
              const palette = deriveRowColors(row.alertStatus, row.typeOfClient, row.methodOfPayment);
              const baseCell = { ...cellStyles, backgroundColor: palette.rowColor };
              const wrapCell = { ...baseCell, whiteSpace: 'normal' as const };
              const narrowCellStyle = { ...narrowCell, backgroundColor: palette.rowColor };
              const compactCellStyle = { ...compactCell, backgroundColor: palette.rowColor };
              const statusCell = { ...cellStyles, backgroundColor: palette.statusColor };
              const paymentCell = { ...cellStyles, backgroundColor: palette.paymentColor };
              const typeCell = { ...cellStyles, backgroundColor: palette.typeColor };

              return (
                <tr
                  key={row.id}
                  style={{
                    borderLeft: row.isPrimaryCare ? '4px solid #38bdf8' : '4px solid transparent'
                  }}
                >
                  <EditableCell
                    rowId={row.id}
                    field="patientName"
                    cellStyle={baseCell}
                    display={renderText(row.patientName)}
                    renderEditor={({ onBlur }) => (
                      <input
                        type="text"
                        value={row.patientName}
                        onChange={(event) =>
                          updateRow(row.id, (current) => ({ ...current, patientName: event.target.value }))
                        }
                        onBlur={onBlur}
                        autoFocus
                        style={inputStyle}
                      />
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="statusKey"
                    cellStyle={statusCell}
                    display={renderText(row.alertStatus)}
                    renderEditor={({ onBlur }) => (
                      <select
                        value={row.statusKey ?? ''}
                        onChange={(event) =>
                          updateRow(row.id, (current) => {
                            const statusMeta = statusLookupByKey.get(event.target.value || '') ?? null;
                            return {
                              ...current,
                              statusKey: event.target.value || null,
                              alertStatus: statusMeta?.display_name ?? current.alertStatus,
                              statusRowColor: statusMeta?.dashboard_row_hex_color ?? current.statusRowColor,
                              statusAlertColor: statusMeta?.dashboard_alert_hex ?? current.statusAlertColor
                            };
                          })
                        }
                        onBlur={onBlur}
                        autoFocus
                        style={{ ...selectStyle, backgroundColor: palette.statusColor }}
                      >
                        <option value="">(none)</option>
                        {lookups.statuses.map((status) => (
                          <option key={status.status_key} value={status.status_key}>
                            {status.display_name}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="paymentMethodKey"
                    cellStyle={paymentCell}
                    display={renderText(row.methodOfPayment)}
                    renderEditor={({ onBlur }) => (
                      <select
                        value={row.paymentMethodKey ?? ''}
                        onChange={(event) =>
                          updateRow(row.id, (current) => {
                            const methodMeta = methodLookupByKey.get(event.target.value || '') ?? null;
                            return {
                              ...current,
                              paymentMethodKey: event.target.value || null,
                              methodOfPayment: methodMeta?.display_name ?? current.methodOfPayment,
                              paymentMethodColor: methodMeta?.hex_color ?? current.paymentMethodColor
                            };
                          })
                        }
                        onBlur={onBlur}
                        autoFocus
                        style={{ ...selectStyle, backgroundColor: palette.paymentColor }}
                      >
                        <option value="">(none)</option>
                        {lookups.paymentMethods.map((method) => (
                          <option key={method.method_key} value={method.method_key}>
                            {method.display_name}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="clientTypeKey"
                    cellStyle={typeCell}
                    display={renderText(row.typeOfClient)}
                    renderEditor={({ onBlur }) => (
                      <select
                        value={row.clientTypeKey ?? ''}
                        onChange={(event) =>
                          updateRow(row.id, (current) => {
                            const clientMeta = clientLookupByKey.get(event.target.value || '') ?? null;
                            return {
                              ...current,
                              clientTypeKey: event.target.value || null,
                              typeOfClient: clientMeta?.display_name ?? current.typeOfClient,
                              clientTypeColor: clientMeta?.hex_color ?? current.clientTypeColor,
                              isPrimaryCare: clientMeta?.is_primary_care ?? current.isPrimaryCare
                            };
                          })
                        }
                        onBlur={onBlur}
                        autoFocus
                        style={{ ...selectStyle, backgroundColor: palette.typeColor }}
                      >
                        <option value="">(none)</option>
                        {lookups.clientTypes.map((type) => (
                          <option key={type.type_key} value={type.type_key}>
                            {type.display_name}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="regimen"
                    cellStyle={baseCell}
                    display={renderText(row.regimen)}
                    renderEditor={({ onBlur }) => (
                      <input
                        type="text"
                        value={row.regimen}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, regimen: event.target.value }))}
                        onBlur={onBlur}
                        autoFocus
                        style={inputStyle}
                      />
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="labStatus"
                    cellStyle={baseCell}
                    display={renderText(row.labStatus)}
                    renderEditor={({ onBlur }) => (
                      <input
                        type="text"
                        value={row.labStatus}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, labStatus: event.target.value }))}
                        onBlur={onBlur}
                        autoFocus
                        style={inputStyle}
                      />
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="patientNotes"
                    cellStyle={{ ...wrapCell, minWidth: '220px' }}
                    display={
                      <span style={{ whiteSpace: 'normal' }}>{row.patientNotes?.trim() ? row.patientNotes : '—'}</span>
                    }
                    renderEditor={({ onBlur }) => (
                      <NotesEditor
                        rowId={row.id}
                        initialValue={row.patientNotes ?? ''}
                        onCommit={(nextValue) =>
                          updateRow(row.id, (current) => ({
                            ...current,
                            patientNotes: nextValue
                          }))
                        }
                        onBlur={onBlur}
                      />
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="lastLab"
                    cellStyle={narrowCellStyle}
                    display={formatDisplayDate(row.lastLab)}
                    renderEditor={({ onBlur }) => {
                      const pending = getPendingValue(row.id, 'lastLab');
                      return (
                        <input
                          type="text"
                          value={pending ?? formatDateInput(row.lastLab)}
                          placeholder="MM-DD-YYYY"
                          inputMode="numeric"
                          onChange={(event) => setPendingValue(row.id, 'lastLab', event.target.value)}
                          onBlur={() => {
                            const nextPending = getPendingValue(row.id, 'lastLab');
                            if (nextPending !== undefined) {
                              const trimmed = nextPending.trim();
                              if (!trimmed) {
                                updateRow(row.id, (current) => {
                                  const nextLabIso = normalizeDateValue(current.nextLab) ?? null;
                                  const labInfo = computeLabStatus(null, nextLabIso);
                                  const currentKey = (current.statusKey ?? '').toLowerCase();
                                  let nextStatusKey = current.statusKey;
                                  if (currentKey === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')) {
                                    nextStatusKey = 'active_pending';
                                  } else if (currentKey === 'active_pending' && labInfo.state === 'current') {
                                    nextStatusKey = 'active';
                                  }
                                  const nextAlertStatus =
                                    nextStatusKey === 'active_pending'
                                      ? 'Active - Pending'
                                      : nextStatusKey === 'active'
                                        ? 'Active'
                                        : current.alertStatus;
                                  return {
                                    ...current,
                                    lastLab: '',
                                    labStatus: labInfo.label,
                                    statusKey: nextStatusKey,
                                    alertStatus: nextAlertStatus
                                  };
                                });
                              } else {
                                const isoValue = normalizeDateValue(trimmed);
                                if (!isoValue) {
                                  setFeedback('Enter date as MM-DD-YYYY');
                                  onBlur();
                                  return;
                                }
                                updateRow(row.id, (current) => {
                                  const nextLabIso = normalizeDateValue(current.nextLab) ?? null;
                                  const labInfo = computeLabStatus(isoValue, nextLabIso);
                                  const currentKey = (current.statusKey ?? '').toLowerCase();
                                  let nextStatusKey = current.statusKey;
                                  if (currentKey === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')) {
                                    nextStatusKey = 'active_pending';
                                  } else if (currentKey === 'active_pending' && labInfo.state === 'current') {
                                    nextStatusKey = 'active';
                                  }
                                  const nextAlertStatus =
                                    nextStatusKey === 'active_pending'
                                      ? 'Active - Pending'
                                      : nextStatusKey === 'active'
                                        ? 'Active'
                                        : current.alertStatus;
                                  return {
                                    ...current,
                                    lastLab: isoValue,
                                    labStatus: labInfo.label,
                                    statusKey: nextStatusKey,
                                    alertStatus: nextAlertStatus
                                  };
                                });
                              }
                              clearPendingValue(row.id, 'lastLab');
                            }
                            onBlur();
                          }}
                          autoFocus={pending === undefined}
                          style={inputStyle}
                        />
                      );
                    }}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="nextLab"
                    cellStyle={narrowCellStyle}
                    display={formatDisplayDate(row.nextLab)}
                    renderEditor={({ onBlur }) => {
                      const pending = getPendingValue(row.id, 'nextLab');
                      return (
                        <input
                          type="text"
                          value={pending ?? formatDateInput(row.nextLab)}
                          placeholder="MM-DD-YYYY"
                          inputMode="numeric"
                          onChange={(event) => setPendingValue(row.id, 'nextLab', event.target.value)}
                          onBlur={() => {
                            const nextPending = getPendingValue(row.id, 'nextLab');
                            if (nextPending !== undefined) {
                              const trimmed = nextPending.trim();
                              if (!trimmed) {
                                updateRow(row.id, (current) => {
                                  const lastLabIso = normalizeDateValue(current.lastLab) ?? null;
                                  const labInfo = computeLabStatus(lastLabIso, null);
                                  const currentKey = (current.statusKey ?? '').toLowerCase();
                                  let nextStatusKey = current.statusKey;
                                  if (currentKey === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')) {
                                    nextStatusKey = 'active_pending';
                                  } else if (currentKey === 'active_pending' && labInfo.state === 'current') {
                                    nextStatusKey = 'active';
                                  }
                                  const nextAlertStatus =
                                    nextStatusKey === 'active_pending'
                                      ? 'Active - Pending'
                                      : nextStatusKey === 'active'
                                        ? 'Active'
                                        : current.alertStatus;
                                  return {
                                    ...current,
                                    nextLab: '',
                                    labStatus: labInfo.label,
                                    statusKey: nextStatusKey,
                                    alertStatus: nextAlertStatus
                                  };
                                });
                              } else {
                                const isoValue = normalizeDateValue(trimmed);
                                if (!isoValue) {
                                  setFeedback('Enter date as MM-DD-YYYY');
                                  onBlur();
                                  return;
                                }
                                updateRow(row.id, (current) => {
                                  const lastLabIso = normalizeDateValue(current.lastLab) ?? null;
                                  const labInfo = computeLabStatus(lastLabIso, isoValue);
                                  const currentKey = (current.statusKey ?? '').toLowerCase();
                                  let nextStatusKey = current.statusKey;
                                  if (currentKey === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')) {
                                    nextStatusKey = 'active_pending';
                                  } else if (currentKey === 'active_pending' && labInfo.state === 'current') {
                                    nextStatusKey = 'active';
                                  }
                                  const nextAlertStatus =
                                    nextStatusKey === 'active_pending'
                                      ? 'Active - Pending'
                                      : nextStatusKey === 'active'
                                        ? 'Active'
                                        : current.alertStatus;
                                  return {
                                    ...current,
                                    nextLab: isoValue,
                                    labStatus: labInfo.label,
                                    statusKey: nextStatusKey,
                                    alertStatus: nextAlertStatus
                                  };
                                });
                              }
                              clearPendingValue(row.id, 'nextLab');
                            }
                            onBlur();
                          }}
                          autoFocus={pending === undefined}
                          style={inputStyle}
                        />
                      );
                    }}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="serviceStartDate"
                    cellStyle={narrowCellStyle}
                    display={formatDisplayDate(row.serviceStartDate)}
                    renderEditor={({ onBlur }) => {
                      const pending = getPendingValue(row.id, 'serviceStartDate');
                      return (
                        <input
                          type="text"
                          value={pending ?? formatDateInput(row.serviceStartDate)}
                          placeholder="MM-DD-YYYY"
                          inputMode="numeric"
                          onChange={(event) => setPendingValue(row.id, 'serviceStartDate', event.target.value)}
                          onBlur={() => {
                            const nextPending = getPendingValue(row.id, 'serviceStartDate');
                            if (nextPending !== undefined) {
                              const trimmed = nextPending.trim();
                              if (!trimmed) {
                                updateRow(row.id, (current) => ({ ...current, serviceStartDate: '' }));
                              } else {
                                const isoValue = normalizeDateValue(trimmed);
                                if (!isoValue) {
                                  setFeedback('Enter date as MM-DD-YYYY');
                                  onBlur();
                                  return;
                                }
                                updateRow(row.id, (current) => ({ ...current, serviceStartDate: isoValue }));
                              }
                              clearPendingValue(row.id, 'serviceStartDate');
                            }
                            onBlur();
                          }}
                          autoFocus={pending === undefined}
                          style={inputStyle}
                        />
                      );
                    }}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="contractEnd"
                    cellStyle={narrowCellStyle}
                    display={formatDisplayDate(row.contractEnd)}
                    renderEditor={({ onBlur }) => {
                      const pending = getPendingValue(row.id, 'contractEnd');
                      return (
                        <input
                          type="text"
                          value={pending ?? formatDateInput(row.contractEnd)}
                          placeholder="MM-DD-YYYY"
                          inputMode="numeric"
                          onChange={(event) => setPendingValue(row.id, 'contractEnd', event.target.value)}
                          onBlur={() => {
                            const nextPending = getPendingValue(row.id, 'contractEnd');
                            if (nextPending !== undefined) {
                              const trimmed = nextPending.trim();
                              if (!trimmed) {
                                updateRow(row.id, (current) => ({ ...current, contractEnd: '' }));
                              } else {
                                const isoValue = normalizeDateValue(trimmed);
                                if (!isoValue) {
                                  setFeedback('Enter date as MM-DD-YYYY');
                                  onBlur();
                                  return;
                                }
                                updateRow(row.id, (current) => ({ ...current, contractEnd: isoValue }));
                              }
                              clearPendingValue(row.id, 'contractEnd');
                            }
                            onBlur();
                          }}
                          autoFocus={pending === undefined}
                          style={inputStyle}
                        />
                      );
                    }}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="dateOfBirth"
                    cellStyle={narrowCellStyle}
                    display={formatDisplayDate(row.dateOfBirth)}
                    renderEditor={({ onBlur }) => {
                      const pending = getPendingValue(row.id, 'dateOfBirth');
                      return (
                        <input
                          type="text"
                          value={pending ?? formatDateInput(row.dateOfBirth)}
                          placeholder="MM-DD-YYYY"
                          inputMode="numeric"
                          onChange={(event) => setPendingValue(row.id, 'dateOfBirth', event.target.value)}
                          onBlur={() => {
                            const nextPending = getPendingValue(row.id, 'dateOfBirth');
                            if (nextPending !== undefined) {
                              const trimmed = nextPending.trim();
                              if (!trimmed) {
                                updateRow(row.id, (current) => ({ ...current, dateOfBirth: '' }));
                              } else {
                                const isoValue = normalizeDateValue(trimmed);
                                if (!isoValue) {
                                  setFeedback('Enter date as MM-DD-YYYY');
                                  onBlur();
                                  return;
                                }
                                updateRow(row.id, (current) => ({ ...current, dateOfBirth: isoValue }));
                              }
                              clearPendingValue(row.id, 'dateOfBirth');
                            }
                            onBlur();
                          }}
                          autoFocus={pending === undefined}
                          style={inputStyle}
                        />
                      );
                    }}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="address"
                    cellStyle={{ ...wrapCell, minWidth: '240px' }}
                    display={<span style={{ whiteSpace: 'normal' }}>{row.address?.trim() ? row.address : '—'}</span>}
                    renderEditor={({ onBlur }) => (
                      <textarea
                        value={row.address}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, address: event.target.value }))}
                        onBlur={onBlur}
                        autoFocus
                        rows={3}
                        style={{
                          ...inputStyle,
                          minHeight: '48px',
                          resize: 'vertical',
                          direction: 'ltr',
                          textAlign: 'left'
                        }}
                      />
                    )}
                  />
                  <EditableCell
                    rowId={row.id}
                    field="phoneNumber"
                    cellStyle={compactCellStyle}
                    display={renderText(row.phoneNumber)}
                    renderEditor={({ onBlur }) => (
                      <input
                        type="text"
                        value={row.phoneNumber}
                        onChange={(event) =>
                          updateRow(row.id, (current) => ({ ...current, phoneNumber: event.target.value }))
                        }
                        onBlur={onBlur}
                        autoFocus
                        style={inputStyle}
                      />
                    )}
                  />
                  <td style={compactCellStyle}>{renderText(row.addedBy)}</td>
                  <td style={compactCellStyle}>{formatDisplayDate(row.dateAdded)}</td>
                  <td style={compactCellStyle}>{formatDisplayDate(row.lastModified)}</td>
                  <td style={narrowCellStyle}>
                    {row.lastSupplyDate?.trim() ? (
                      <Link
                        href={`/patients/${row.id}`}
                        style={{
                          color: row.lastSupplyFromDea ? '#0284c7' : '#0f172a',
                          fontWeight: row.lastSupplyFromDea ? 600 : 500,
                          textDecoration: row.lastSupplyFromDea ? 'underline' : 'none'
                        }}
                      >
                        {formatDisplayDate(row.lastSupplyDate)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={narrowCellStyle}>{formatDisplayDate(row.eligibleForNextSupply)}</td>
                  {canDeletePatient && (
                    <td style={{ ...baseCell, minWidth: '120px' }}>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        disabled={savingId === row.id}
                        style={{
                          padding: '0.45rem 0.95rem',
                          borderRadius: '0.5rem',
                          border: '1px solid rgba(248, 113, 113, 0.6)',
                          background: 'rgba(248, 113, 113, 0.15)',
                          color: '#f87171',
                          cursor: savingId === row.id ? 'wait' : 'pointer',
                          fontWeight: 600
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
      {filteredRows.length === 0 && <p style={{ color: '#64748b' }}>No patients match your filters.</p>}
    </div>
  );
}

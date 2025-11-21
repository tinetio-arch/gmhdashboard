"use client";

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { MembershipAuditData, QuickBooksAuditData } from '@/lib/membershipAudit';
import type { LookupSets } from '@/lib/lookups';
import { withBasePath } from '@/lib/basePath';
import { stripHonorifics } from '@/lib/nameUtils';

type Props = {
  data: MembershipAuditData;
  quickbooksData: QuickBooksAuditData;
  lookups: LookupSets;
};

const ISSUE_LABELS: Record<string, string> = {
  no_gmh_match: 'Needs Intake',
  multiple_gmh_matches: 'Multiple GMH',
  no_clinicsync_match: 'No ClinicSync Match',
  multiple_clinicsync_matches: 'Multiple ClinicSync',
  already_mapped: 'Already Mapped',
  unknown: 'Review'
};

const ISSUE_DESCRIPTIONS: Record<string, string> = {
  no_gmh_match: 'Membership exists in ClinicSync/Jane but no GMH patient could be matched.',
  multiple_gmh_matches: 'Multiple GMH patients share this normalized name. Add phone/email to disambiguate.',
  no_clinicsync_match: 'Jane membership row has no matching ClinicSync record.',
  multiple_clinicsync_matches: 'Multiple ClinicSync records share this name. Resolve duplicates there first.',
  already_mapped: 'This membership already has a manual mapping. Resolve once confirmed.',
  unknown: 'Catch-all for items that still need human review.'
};

const ISSUE_KEYS = Object.keys(ISSUE_LABELS);
const CLEANUP_ISSUES = ISSUE_KEYS.filter((issue) => issue !== 'no_gmh_match');

type IntakeFormState = {
  patientName: string;
  statusKey: string | null;
  paymentMethodKey: string | null;
  clientTypeKey: string | null;
  phoneNumber: string;
  address: string;
  regimen: string;
  dateOfBirth: string;
  lastLab: string;
  nextLab: string;
  serviceStartDate: string;
  contractEndDate: string;
  membershipProgram: string | null;
  membershipStatus: string | null;
  membershipBalance: string | null;
  notes: string;
  email: string;
};

type NeedsDataRow = MembershipAuditData['needsData'][number];
type DuplicateGroup = MembershipAuditData['duplicates'][number];
type QuickBooksRecurringRow = QuickBooksAuditData['unmappedRecurring'][number];
type QuickBooksInvoiceRow = QuickBooksAuditData['overdueInvoices'][number];
type QuickBooksPatientRow = QuickBooksAuditData['unmappedPatients'][number];
type PatientMatch = {
  patient_id: string;
  full_name: string;
  status_key: string | null;
  alert_status: string | null;
  phone_primary: string | null;
  service_start_date: string | null;
  contract_end_date: string | null;
  dob: string | null;
};

type LinkContext =
  | { kind: 'clinicsync'; row: NeedsDataRow }
  | { kind: 'quickbooks'; qbCustomerId: string; customerName: string };

function formatPatientName(value: string | null | undefined): string {
  return stripHonorifics(value ?? '');
}

function formatCurrency(value: string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (Number.isNaN(amount)) {
    return '$0.00';
  }
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function findStatusKey(lookups: LookupSets, key: string): string | null {
  return lookups.statuses.find((status) => status.status_key === key)?.status_key ?? null;
}

function pickDefaultStatus(lookups: LookupSets, row: NeedsDataRow): string | null {
  const defaultStatus = lookups.statuses[0]?.status_key ?? null;
  const outstanding = parseFloat(row.outstanding_balance ?? '0') > 0;
  const statusToken = row.status?.toLowerCase() ?? '';
  const expired =
    statusToken.startsWith('expired') ||
    statusToken.startsWith('inactive') ||
    (row.contract_end_date ? new Date(row.contract_end_date) < new Date() : false);

  if (expired) {
    return findStatusKey(lookups, 'hold_contract_renewal') ?? defaultStatus;
  }
  if (outstanding) {
    return findStatusKey(lookups, 'hold_payment_research') ?? defaultStatus;
  }
  return defaultStatus;
}

function pickPaymentMethodKey(lookups: LookupSets): string | null {
  const jane = lookups.paymentMethods.find((method) => /jane/i.test(method.display_name));
  return jane?.method_key ?? null;
}

function pickClientTypeKey(lookups: LookupSets): string | null {
  const membership = lookups.clientTypes.find((type) => /membership/i.test(type.display_name));
  return membership?.type_key ?? null;
}

function buildIntakeDefaults(row: NeedsDataRow, lookups: LookupSets): IntakeFormState {
  return {
    patientName: stripHonorifics(row.patient_name),
    statusKey: pickDefaultStatus(lookups, row),
    paymentMethodKey: pickPaymentMethodKey(lookups),
    clientTypeKey: pickClientTypeKey(lookups),
    phoneNumber: '',
    address: '',
    regimen: '',
    dateOfBirth: '',
    lastLab: '',
    nextLab: '',
    serviceStartDate: row.service_start_date ?? '',
    contractEndDate: row.contract_end_date ?? '',
    membershipProgram: row.plan_name ?? null,
    membershipStatus: row.status ?? null,
    membershipBalance: row.outstanding_balance ?? null,
    notes: '',
    email: ''
  };
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header style={{ marginBottom: '1rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h2>
      {description ? (
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.95rem' }}>{description}</p>
      ) : null}
    </header>
  );
}

function EmptyState() {
  return <p style={{ color: '#94a3b8' }}>Nothing to review.</p>;
}

export default function MembershipAuditClient({ data, quickbooksData, lookups }: Props) {
  const [auditData, setAuditData] = useState(data);
  const [quickbooksAudit, setQuickbooksAudit] = useState(quickbooksData);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [intakeRow, setIntakeRow] = useState<NeedsDataRow | null>(null);
  const [intakeForm, setIntakeForm] = useState<IntakeFormState | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [linkContext, setLinkContext] = useState<LinkContext | null>(null);
  const [linkResults, setLinkResults] = useState<PatientMatch[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const needsIntakeRows = useMemo(
    () => auditData.needsData.filter((row) => row.issue === 'no_gmh_match'),
    [auditData.needsData]
  );

  const issueBuckets = useMemo(() => {
    const bucket = new Map<string, NeedsDataRow[]>();
    auditData.needsData.forEach((row) => {
      const current = bucket.get(row.issue) ?? [];
      current.push(row);
      bucket.set(row.issue, current);
    });
    return bucket;
  }, [auditData.needsData]);

  const duplicateLookup = useMemo(() => {
    const map = new Map<string, DuplicateGroup>();
    auditData.duplicates.forEach((group) => {
      map.set(group.norm_name, group);
    });
    return map;
  }, [auditData.duplicates]);

  async function openIntake(row: NeedsDataRow) {
    setIntakeRow(row);
    setIntakeError(null);
    setIntakeForm(buildIntakeDefaults(row, lookups));
    setIntakeLoading(true);
    try {
      const response = await fetch(withBasePath('/api/admin/memberships/audit/intake-defaults'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normName: row.norm_name, patientName: row.patient_name })
      });
      if (response.ok) {
        const payload = await response.json();
        const defaults = payload?.data;
        if (defaults) {
          setIntakeForm((prev) =>
            prev
              ? {
                  ...prev,
                  patientName: stripHonorifics(defaults.patientName ?? prev.patientName),
                  phoneNumber: defaults.phoneNumber ?? prev.phoneNumber,
                  email: defaults.email ?? prev.email,
                  address: defaults.address ?? prev.address,
                  dateOfBirth: defaults.dateOfBirth ?? prev.dateOfBirth,
                  notes: defaults.notes ?? prev.notes
                }
              : prev
          );
        }
      }
    } catch (error) {
      console.error(error);
      setIntakeError('Unable to load historical data for this patient.');
    } finally {
      setIntakeLoading(false);
    }
  }

  function closeIntake() {
    setIntakeRow(null);
    setIntakeForm(null);
    setIntakeError(null);
    setIntakeSaving(false);
    setIntakeLoading(false);
  }

  function updateIntakeForm<K extends keyof IntakeFormState>(key: K, value: IntakeFormState[K]) {
    setIntakeForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function searchPatients(params: { query?: string; normName?: string }) {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await fetch(withBasePath('/api/admin/patients/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const payload = await res.json();
      setLinkResults(payload?.data ?? []);
    } catch (error) {
      console.error(error);
      setLinkError('Unable to search patients. Please try a different name.');
      setLinkResults([]);
    } finally {
      setLinkLoading(false);
    }
  }

  async function openClinicLinkDrawer(row: NeedsDataRow) {
    if (!row.clinicsync_patient_id) {
      setMessage('This membership does not have a ClinicSync ID to link.');
      return;
    }
    setLinkContext({ kind: 'clinicsync', row });
    setLinkError(null);
    const defaultQuery = formatPatientName(row.patient_name);
    setLinkQuery(defaultQuery);
    await searchPatients({ normName: row.norm_name, query: defaultQuery });
  }

  async function openQuickBooksLinkDrawer(row: QuickBooksRecurringRow) {
    setLinkContext({ kind: 'quickbooks', qbCustomerId: row.qbCustomerId, customerName: row.customerName });
    setLinkError(null);
    const defaultQuery = stripHonorifics(row.customerName);
    setLinkQuery(defaultQuery);
    await searchPatients({ query: defaultQuery });
  }

  function closeLinkDrawer() {
    setLinkContext(null);
    setLinkResults([]);
    setLinkQuery('');
    setLinkError(null);
    setLinkLoading(false);
  }

  async function handleLinkSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkContext) {
      return;
    }
    if (linkContext.kind === 'clinicsync') {
      await searchPatients({
        query: linkQuery || formatPatientName(linkContext.row.patient_name),
        normName: linkContext.row.norm_name
      });
    } else {
      await searchPatients({
        query: linkQuery || stripHonorifics(linkContext.customerName)
      });
    }
  }

  async function handleLinkSelection(patientId: string) {
    if (!linkContext) {
      return;
    }
    if (linkContext.kind === 'clinicsync') {
      if (!linkContext.row.clinicsync_patient_id) {
        setLinkError('This membership does not have a ClinicSync ID to link.');
        return;
      }
      await handleClinicLink(patientId, linkContext.row.clinicsync_patient_id, {
        removeNorm: linkContext.row.norm_name,
        removeIssue: linkContext.row.issue
      });
      closeLinkDrawer();
    } else {
      await handleQuickBooksLink(patientId, linkContext.qbCustomerId);
      closeLinkDrawer();
    }
  }

  async function handleClinicLink(
    patientId: string,
    clinicsyncPatientId: string,
    options?: { removeNorm?: string; removeIssue?: string }
  ) {
    setBusyId(clinicsyncPatientId);
    setMessage(null);
    try {
      const res = await fetch('/ops/api/admin/memberships/audit/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, clinicsyncPatientId })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setAuditData((prev) => ({
        ...prev,
        readyToMap: prev.readyToMap.filter((row) => row.clinicsync_patient_id !== clinicsyncPatientId),
        needsData: options?.removeNorm
          ? prev.needsData.filter(
              (row) => row.norm_name !== options.removeNorm || (options.removeIssue && row.issue !== options.removeIssue)
            )
          : prev.needsData
      }));
      setMessage('Mapping saved. Refresh the page after syncing to verify.');
    } catch (error) {
      console.error(error);
      setMessage('Link failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleQuickBooksLink(patientId: string, qbCustomerId: string) {
    setBusyId(qbCustomerId);
    setMessage(null);
    try {
      const res = await fetch(withBasePath('/api/admin/quickbooks/patient-matching'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, qbCustomerId, matchMethod: 'manual' })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setQuickbooksAudit((prev) => ({
        ...prev,
        unmappedRecurring: prev.unmappedRecurring.filter((row) => row.qbCustomerId !== qbCustomerId),
        unmappedPatients: prev.unmappedPatients.filter((row) => row.patient_id !== patientId)
      }));
      setMessage('QuickBooks customer linked successfully.');
    } catch (error) {
      console.error(error);
      setMessage('Unable to link QuickBooks customer. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleResolve(normName: string) {
    setBusyId(normName);
    setMessage(null);
    try {
      const res = await fetch('/ops/api/admin/memberships/audit/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normName })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setAuditData((prev) => ({
        ...prev,
        needsData: prev.needsData.filter((row) => row.norm_name !== normName)
      }));
      setMessage('Marked as resolved.');
    } catch (error) {
      console.error(error);
      setMessage('Unable to resolve row.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleIntakeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intakeForm || !intakeRow) {
      return;
    }
    const currentRow = intakeRow;
    if (!intakeForm.patientName.trim()) {
      setIntakeError('Patient name is required.');
      return;
    }
    if (!intakeForm.statusKey) {
      setIntakeError('Alert status is required.');
      return;
    }
    if (!intakeForm.paymentMethodKey) {
      setIntakeError('Payment method is required.');
      return;
    }
    if (!intakeForm.clientTypeKey) {
      setIntakeError('Client type is required.');
      return;
    }
    const requiredFields: Array<[keyof IntakeFormState, string]> = [
      ['phoneNumber', 'Phone number is required.'],
      ['address', 'Address is required.'],
      ['regimen', 'Regimen is required.'],
      ['dateOfBirth', 'Date of birth is required.'],
      ['lastLab', 'Last lab date is required.'],
      ['nextLab', 'Next lab date is required.'],
      ['serviceStartDate', 'Service start date is required.']
    ];
    for (const [key, errorMessage] of requiredFields) {
      if (!intakeForm[key] || (typeof intakeForm[key] === 'string' && !(intakeForm[key] as string).trim())) {
        setIntakeError(errorMessage);
        return;
      }
    }

    setIntakeSaving(true);
    setIntakeError(null);
    try {
      const response = await fetch(withBasePath('/api/patients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: stripHonorifics(intakeForm.patientName.trim()),
          statusKey: intakeForm.statusKey,
          paymentMethodKey: intakeForm.paymentMethodKey,
          clientTypeKey: intakeForm.clientTypeKey,
          phoneNumber: intakeForm.phoneNumber.trim(),
          address: intakeForm.address.trim(),
          regimen: intakeForm.regimen.trim(),
          dateOfBirth: intakeForm.dateOfBirth,
          lastLab: intakeForm.lastLab,
          nextLab: intakeForm.nextLab,
          serviceStartDate: intakeForm.serviceStartDate,
          contractEndDate: intakeForm.contractEndDate || null,
          membershipProgram: intakeForm.membershipProgram,
          membershipStatus: intakeForm.membershipStatus,
          membershipBalance: intakeForm.membershipBalance,
          patientNotes: intakeForm.notes.trim() || null,
          email: intakeForm.email.trim() || null,
          paymentMethod: null,
          clientType: null
        })
      });
      if (!response.ok) {
        throw new Error('Failed to create patient');
      }
      const payload = await response.json();
      const newPatientId: string | undefined = payload?.data?.patient_id;
      setAuditData((prev) => ({
        ...prev,
        needsData: prev.needsData.filter(
          (row) => !(row.norm_name === currentRow.norm_name && row.issue === 'no_gmh_match')
        )
      }));
      closeIntake();
      setMessage('Patient created from intake. Link the membership to finish.');
      if (newPatientId && currentRow.clinicsync_patient_id) {
        await handleClinicLink(newPatientId, currentRow.clinicsync_patient_id, {
          removeNorm: currentRow.norm_name,
          removeIssue: currentRow.issue
        });
      }
    } catch (error) {
      console.error(error);
      setIntakeError('Unable to create patient. Please review the required fields.');
    } finally {
      setIntakeSaving(false);
    }
  }

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {message ? (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.6rem',
            background: 'rgba(14,165,233,0.08)',
            border: '1px solid rgba(14,165,233,0.25)',
            color: '#0369a1'
          }}
        >
          {message}
        </div>
      ) : null}

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)',
        }}
      >
        <SectionHeading
          title="Ready to Map"
          description="Link memberships with confident matches so holds/renewals update automatically."
        />
        {auditData.readyToMap.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Membership Name', 'GMH Patient', 'Plan', 'Status', 'Remaining', 'Contract End', 'Balance', ''].map(
                    (label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: 'left',
                          padding: '0.75rem',
                          background: '#f1f5f9',
                          borderBottom: '1px solid #e2e8f0'
                        }}
                      >
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {auditData.readyToMap.map((row) => (
                  <tr key={row.clinicsync_patient_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem' }}>{formatPatientName(row.patient_name)}</td>
                    <td style={{ padding: '0.75rem' }}>{row.matched_patient}</td>
                    <td style={{ padding: '0.75rem' }}>{row.plan_name ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.status ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.remaining_cycles ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.contract_end_date ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.outstanding_balance ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() =>
                          handleClinicLink(row.patient_id, row.clinicsync_patient_id, {
                            removeNorm: row.norm_name
                          })
                        }
                        disabled={busyId === row.clinicsync_patient_id}
                        style={{
                          padding: '0.4rem 0.9rem',
                          borderRadius: '0.5rem',
                          border: 'none',
                          background: '#0ea5e9',
                          color: '#ffffff',
                          cursor: 'pointer',
                          opacity: busyId === row.clinicsync_patient_id ? 0.6 : 1
                        }}
                      >
                        {busyId === row.clinicsync_patient_id ? 'Linking...' : 'Link'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {quickbooksAudit.connected && (
        <section
          style={{
            border: '1px solid rgba(148,163,184,0.3)',
            borderRadius: '1rem',
            padding: '1.5rem',
            background: '#ffffff',
            boxShadow: '0 10px 25px rgba(15,23,42,0.05)'
          }}
        >
          <SectionHeading
            title="QuickBooks Payment Issues"
            description="Once a QuickBooks customer is linked, any failed charge automatically moves the patient to Hold - Payment Research."
          />
          {quickbooksAudit.overdueInvoices.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {['Patient', 'Balance', 'Days Overdue', 'Invoice #', 'Alert Status'].map((label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: 'left',
                          padding: '0.75rem',
                          background: '#f1f5f9',
                          borderBottom: '1px solid #e2e8f0'
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quickbooksAudit.overdueInvoices.map((row) => (
                    <tr key={row.qb_invoice_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>{formatPatientName(row.patient_name)}</td>
                      <td style={{ padding: '0.75rem' }}>{formatCurrency(row.balance.toString())}</td>
                      <td style={{ padding: '0.75rem' }}>{row.days_overdue}</td>
                      <td style={{ padding: '0.75rem' }}>{row.invoice_number ?? '—'}</td>
                      <td style={{ padding: '0.75rem' }}>{row.status_key ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)'
        }}
      >
        <SectionHeading
          title="QuickBooks Recurring (Needs Mapping)"
          description="These QuickBooks recurring templates are charging patients but are not linked to a GMH chart yet."
        />
        {!quickbooksAudit.connected ? (
          <p style={{ color: '#b91c1c', margin: 0 }}>
            QuickBooks is not connected. Connect from the QuickBooks admin page to populate this list.
          </p>
        ) : quickbooksAudit.unmappedRecurring.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Customer', 'Template', 'Amount', 'Next Charge', 'Email', 'Phone', 'Actions'].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: 'left',
                        padding: '0.75rem',
                        background: '#f1f5f9',
                        borderBottom: '1px solid #e2e8f0'
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quickbooksAudit.unmappedRecurring.map((row) => (
                  <tr key={row.qbCustomerId} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{formatPatientName(row.customerName)}</td>
                    <td style={{ padding: '0.75rem' }}>{row.templateName ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>
                      {typeof row.amount === 'number' ? formatCurrency(row.amount.toString()) : '—'}
                    </td>
                    <td style={{ padding: '0.75rem' }}>{row.nextChargeDate ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.email ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.phone ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => openQuickBooksLinkDrawer(row)}
                        style={{
                          padding: '0.4rem 0.9rem',
                          borderRadius: '0.5rem',
                          border: '1px solid rgba(14,165,233,0.45)',
                          background: '#0ea5e9',
                          color: '#ffffff',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          opacity: busyId === row.qbCustomerId ? 0.6 : 1
                        }}
                      >
                        {busyId === row.qbCustomerId ? 'Linking...' : 'Link to GMH'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)'
        }}
      >
        <SectionHeading
          title='Needs Intake / No GMH Match'
          description='These ClinicSync memberships have no GMH patient yet. Start an intake or link manually once you create the profile.'
        />
        {needsIntakeRows.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Membership Name', 'Plan', 'Status', 'Remaining', 'Contract End', 'Outstanding', 'Actions'].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: 'left',
                        padding: '0.75rem',
                        background: '#f1f5f9',
                        borderBottom: '1px solid #e2e8f0'
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {needsIntakeRows.map((row) => (
                  <tr key={`${row.norm_name}-${row.clinicsync_patient_id ?? row.patient_name}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{formatPatientName(row.patient_name)}</td>
                    <td style={{ padding: '0.75rem' }}>{row.plan_name ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.status ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.remaining_cycles ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.contract_end_date ?? '—'}</td>
                    <td style={{ padding: '0.75rem' }}>{formatCurrency(row.outstanding_balance ?? '0')}</td>
                    <td style={{ padding: '0.75rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => openIntake(row)}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '0.45rem',
                          border: '1px solid rgba(14,165,233,0.45)',
                          background: 'transparent',
                          color: '#0369a1',
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        Start Intake
                      </button>
                      <button
                        type="button"
                        onClick={() => openClinicLinkDrawer(row)}
                        disabled={!row.clinicsync_patient_id}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '0.45rem',
                          border: 'none',
                          background: row.clinicsync_patient_id ? '#0ea5e9' : 'rgba(148,163,184,0.5)',
                          color: '#ffffff',
                          fontSize: '0.85rem',
                          cursor: row.clinicsync_patient_id ? 'pointer' : 'not-allowed',
                          opacity: busyId === row.clinicsync_patient_id ? 0.6 : 1
                        }}
                      >
                        {row.clinicsync_patient_id ? 'Link to GMH' : 'No ClinicSync ID'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolve(row.norm_name)}
                        disabled={busyId === row.norm_name}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '0.45rem',
                          border: '1px solid #e2e8f0',
                          background: '#f8fafc',
                          cursor: 'pointer',
                          opacity: busyId === row.norm_name ? 0.6 : 1
                        }}
                      >
                        {busyId === row.norm_name ? 'Resolving...' : 'Resolve'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)',
        }}
      >
        <SectionHeading
          title="Needs Data Cleanup"
          description="Add missing phone/email or fix duplicate names, then resolve to hide the row."
        />
        {CLEANUP_ISSUES.every((issue) => (issueBuckets.get(issue) ?? []).length === 0) ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {CLEANUP_ISSUES.map((issue) => {
              const rows = issueBuckets.get(issue) ?? [];
              if (rows.length === 0) {
                return null;
              }
              const rowsToShow = rows.slice(0, 6);
              return (
                <details
                  key={issue}
                  open={issue === 'multiple_gmh_matches' || rows.length <= 3}
                  style={{
                    border: '1px solid rgba(148,163,184,0.3)',
                    borderRadius: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: '#f8fafc'
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem'
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {ISSUE_LABELS[issue]}{' '}
                      <span
                        style={{
                          fontSize: '0.8rem',
                          color: '#475569',
                          marginLeft: '0.35rem'
                        }}
                      >
                        ({rows.length})
                      </span>
                    </span>
                    <small style={{ color: '#94a3b8' }}>{ISSUE_DESCRIPTIONS[issue]}</small>
                  </summary>
                  <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr>
                          {['Membership Name', 'Plan', 'Status', 'Contract End', 'Balance', ''].map((label) => (
                            <th
                              key={label}
                              style={{
                                textAlign: 'left',
                                padding: '0.6rem',
                                background: '#e2e8f0',
                                borderBottom: '1px solid #d1d5db'
                              }}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rowsToShow.map((row) => (
                          <tr key={`${row.norm_name}-${row.issue}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '0.65rem' }}>{formatPatientName(row.patient_name)}</td>
                            <td style={{ padding: '0.65rem' }}>{row.plan_name ?? '—'}</td>
                            <td style={{ padding: '0.65rem' }}>{row.status ?? '—'}</td>
                            <td style={{ padding: '0.65rem' }}>{row.contract_end_date ?? '—'}</td>
                            <td style={{ padding: '0.65rem' }}>{row.outstanding_balance ?? '—'}</td>
                            <td style={{ padding: '0.65rem' }}>
                              <button
                                type="button"
                                onClick={() => handleResolve(row.norm_name)}
                                disabled={busyId === row.norm_name}
                                style={{
                                  padding: '0.35rem 0.8rem',
                                  borderRadius: '0.45rem',
                                  border: '1px solid #cbd5f5',
                                  background: '#ffffff',
                                  cursor: 'pointer',
                                  opacity: busyId === row.norm_name ? 0.6 : 1
                                }}
                              >
                                {busyId === row.norm_name ? 'Resolving...' : 'Resolve'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > rowsToShow.length ? (
                      <p style={{ marginTop: '0.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                        Showing the first {rowsToShow.length} rows. Resolve a few and refresh to load more.
                      </p>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)',
        }}
      >
        <SectionHeading
          title="Inactive / Discharged"
          description="These memberships came in as inactive. The automation will skip them until you reactivate manually."
        />
        {auditData.inactive.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Membership Name', 'Plan', 'Status', 'Contract End'].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: 'left',
                        padding: '0.75rem',
                        background: '#f1f5f9',
                        borderBottom: '1px solid #e2e8f0'
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditData.inactive.map((row) => (
                  <tr key={row.norm_name} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem' }}>{formatPatientName(row.patient_name)}</td>
                    <td style={{ padding: '0.75rem' }}>{row.plan_name ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.status ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.contract_end_date ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(15,23,42,0.05)'
        }}
      >
        <SectionHeading
          title="Duplicate Memberships"
          description="Review patients who have more than one active Jane membership so billing can be consolidated."
        />
        {auditData.duplicates.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {auditData.duplicates.map((group) => (
              <div
                key={group.norm_name}
                style={{
                  border: '1px solid rgba(148,163,184,0.25)',
                  borderRadius: '0.8rem',
                  padding: '1rem',
                  background: '#f8fafc'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{formatPatientName(group.patient_name)}</div>
                  <span style={{ color: '#475569', fontSize: '0.9rem' }}>
                    {group.memberships.length} memberships
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {['Plan', 'Status', 'Start Date', 'Contract End', 'Balance'].map((label) => (
                          <th
                            key={label}
                            style={{
                              textAlign: 'left',
                              padding: '0.5rem',
                              background: '#e2e8f0',
                              fontSize: '0.85rem'
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.memberships.map((membership, index) => (
                        <tr key={`${group.norm_name}-${index}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '0.5rem' }}>{membership.plan_name ?? '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{membership.status ?? '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{membership.service_start_date ?? '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{membership.contract_end_date ?? '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{membership.outstanding_balance ?? '0.00'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {intakeRow && intakeForm ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 50,
            padding: '1rem'
          }}
        >
          <form
            onSubmit={handleIntakeSubmit}
            style={{
              width: '100%',
              maxWidth: '720px',
              background: '#ffffff',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0 }}>Start Intake</h3>
                <p style={{ margin: '0.4rem 0 0', color: '#475569' }}>
                  Fill the required Patient_Data_Entry columns for {formatPatientName(intakeRow.patient_name)}.
                </p>
                {intakeLoading ? (
                  <p style={{ margin: '0.25rem 0 0', color: '#0ea5e9', fontSize: '0.9rem' }}>Loading historical data…</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeIntake}
                style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}
                aria-label="Close intake"
              >
                ×
              </button>
            </div>

            {duplicateLookup.get(intakeRow.norm_name) ? (
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.6rem',
                  background: 'rgba(249,115,22,0.12)',
                  border: '1px solid rgba(249,115,22,0.3)',
                  color: '#9a3412'
                }}
              >
                This patient already has {duplicateLookup.get(intakeRow.norm_name)!.memberships.length} memberships in Jane.
                Confirm which plan should stay active before creating a new profile.
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Patient Name *</label>
                <input
                  type="text"
                  value={intakeForm.patientName}
                  onChange={(event) => updateIntakeForm('patientName', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Alert Status *</label>
                <select
                  value={intakeForm.statusKey ?? ''}
                  onChange={(event) => updateIntakeForm('statusKey', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="">(Select)</option>
                  {lookups.statuses.map((status) => (
                    <option key={status.status_key} value={status.status_key}>
                      {status.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Payment Method *</label>
                <select
                  value={intakeForm.paymentMethodKey ?? ''}
                  onChange={(event) => updateIntakeForm('paymentMethodKey', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="">(Select)</option>
                  {lookups.paymentMethods.map((method) => (
                    <option key={method.method_key} value={method.method_key}>
                      {method.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Client Type *</label>
                <select
                  value={intakeForm.clientTypeKey ?? ''}
                  onChange={(event) => updateIntakeForm('clientTypeKey', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="">(Select)</option>
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
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Phone *</label>
                <input
                  type="tel"
                  value={intakeForm.phoneNumber}
                  onChange={(event) => updateIntakeForm('phoneNumber', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Regimen *</label>
                <input
                  type="text"
                  value={intakeForm.regimen}
                  onChange={(event) => updateIntakeForm('regimen', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                  placeholder="0.5ml Q4D"
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>DOB *</label>
                <input
                  type="date"
                  value={intakeForm.dateOfBirth}
                  onChange={(event) => updateIntakeForm('dateOfBirth', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Email</label>
                <input
                  type="email"
                  value={intakeForm.email}
                  onChange={(event) => updateIntakeForm('email', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Address *</label>
              <textarea
                value={intakeForm.address}
                onChange={(event) => updateIntakeForm('address', event.target.value)}
                style={{ width: '100%', padding: '0.5rem', minHeight: '64px' }}
              />
            </div>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Last Lab *</label>
                <input
                  type="date"
                  value={intakeForm.lastLab}
                  onChange={(event) => updateIntakeForm('lastLab', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Next Lab *</label>
                <input
                  type="date"
                  value={intakeForm.nextLab}
                  onChange={(event) => updateIntakeForm('nextLab', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Service Start *</label>
                <input
                  type="date"
                  value={intakeForm.serviceStartDate}
                  onChange={(event) => updateIntakeForm('serviceStartDate', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Contract End</label>
                <input
                  type="date"
                  value={intakeForm.contractEndDate}
                  onChange={(event) => updateIntakeForm('contractEndDate', event.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Membership Plan</label>
                <input
                  type="text"
                  value={intakeForm.membershipProgram ?? ''}
                  onChange={(event) => updateIntakeForm('membershipProgram', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                  disabled
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Membership Status</label>
                <input
                  type="text"
                  value={intakeForm.membershipStatus ?? ''}
                  onChange={(event) => updateIntakeForm('membershipStatus', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                  disabled
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Outstanding Balance</label>
                <input
                  type="text"
                  value={intakeForm.membershipBalance ?? ''}
                  onChange={(event) => updateIntakeForm('membershipBalance', event.target.value || null)}
                  style={{ width: '100%', padding: '0.5rem' }}
                  disabled
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', color: '#475569' }}>Notes</label>
              <textarea
                value={intakeForm.notes}
                onChange={(event) => updateIntakeForm('notes', event.target.value)}
                style={{ width: '100%', padding: '0.5rem', minHeight: '64px' }}
                placeholder="Payment details, special instructions, etc."
              />
            </div>

            {intakeError ? <div style={{ color: '#b91c1c' }}>{intakeError}</div> : null}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={closeIntake}
                style={{
                  padding: '0.55rem 1.2rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148,163,184,0.4)',
                  background: '#ffffff',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={intakeSaving}
                style={{
                  padding: '0.55rem 1.4rem',
                  borderRadius: '0.5rem',
                  border: 'none',
                  background: '#0ea5e9',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: intakeSaving ? 'not-allowed' : 'pointer',
                  opacity: intakeSaving ? 0.6 : 1
                }}
              >
                {intakeSaving ? 'Saving…' : 'Create Patient'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {linkContext ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 40,
            padding: '1rem'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              background: '#ffffff',
              borderRadius: '1rem',
              padding: '1.25rem',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  Link {formatPatientName(linkContext.kind === 'clinicsync' ? linkContext.row.patient_name : linkContext.customerName)} to GMH
                </h3>
                <p style={{ margin: '0.35rem 0 0', color: '#475569', fontSize: '0.9rem' }}>
                  {linkContext.kind === 'clinicsync'
                    ? 'Select the correct GMH patient record. This will attach the Jane membership so billing and holds stay in sync.'
                    : 'Select the GMH patient who should be tied to this QuickBooks recurring payment so failed charges can pause automation.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeLinkDrawer}
                style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}
                aria-label="Close link drawer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleLinkSearch} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={linkQuery}
                onChange={(event) => setLinkQuery(event.target.value)}
                placeholder="Search by name, phone, or email"
                style={{
                  flex: '1 1 260px',
                  padding: '0.6rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148,163,184,0.4)'
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: '0.5rem',
                  border: 'none',
                  background: '#0ea5e9',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Search
              </button>
            </form>

            {linkError ? <div style={{ color: '#b91c1c' }}>{linkError}</div> : null}

            <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.75rem' }}>
              {linkLoading ? (
                <p style={{ padding: '1rem', margin: 0, color: '#475569' }}>Searching…</p>
              ) : linkResults.length === 0 ? (
                <p style={{ padding: '1rem', margin: 0, color: '#475569' }}>No matching GMH patients found.</p>
              ) : (
                linkResults.map((patient) => (
                  <div
                    key={patient.patient_id}
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid rgba(148,163,184,0.2)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}
                  >
                    <div style={{ flex: '1 1 auto' }}>
                      <div style={{ fontWeight: 600 }}>{patient.full_name}</div>
                      <div style={{ color: '#475569', fontSize: '0.85rem' }}>
                        {patient.status_key ? patient.status_key.replace(/_/g, ' ') : 'No status'} •{' '}
                        {patient.dob ?? 'DOB unknown'} • {patient.phone_primary ?? 'No phone'}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                        Service Start: {patient.service_start_date ?? '—'} • Contract End: {patient.contract_end_date ?? '—'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLinkSelection(patient.patient_id)}
                      style={{
                        padding: '0.45rem 0.9rem',
                        borderRadius: '0.45rem',
                        border: 'none',
                        background: '#22c55e',
                        color: '#ffffff',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Link
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


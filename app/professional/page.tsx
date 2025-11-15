export const dynamic = 'force-dynamic';

import { fetchProfessionalDashboardPatients } from '@/lib/patientQueries';
import { computeLabStatus, deriveRowColors } from '@/lib/patientFormatting';
import type { CSSProperties } from 'react';
import { requireUser } from '@/lib/auth';

const headerStyle: CSSProperties = {
  padding: '0.55rem 0.7rem',
  textAlign: 'left',
  color: '#475569',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  backgroundColor: '#f1f5f9',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 5
};

const cellStyle: CSSProperties = {
  padding: '0.55rem 0.7rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
  color: '#0f172a',
  whiteSpace: 'nowrap'
};

function formatDate(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '—' : value.toLocaleDateString();
  }
  const str = String(value).trim();
  if (!str) return '—';
  const candidate = str.replace(' ', 'T');
  const isoCandidate = candidate.includes('Z') || candidate.includes('+') ? candidate : `${candidate}Z`;
  const date = new Date(isoCandidate);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString();
  }
  return str;
}

export default async function ProfessionalDashboardPage() {
  await requireUser('read');
  const patients = await fetchProfessionalDashboardPatients();

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Professional_Patient_Dashboard (Read Only)</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '60rem' }}>
        This mirror of the Google Sheet is optimised for clinicians and leadership. Data updates as soon as staff makes
        changes in the Data Entry panel. Use it to scan memberships, lab cadence, supply eligibility, and DEA activity
        without risking accidental edits.
      </p>

      <div
        style={{
          position: 'relative',
          borderRadius: '0.75rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          background: '#ffffff',
          overflow: 'visible'
        }}
      >
        <div style={{ overflowX: 'auto', borderRadius: 'inherit' }}>
          <table
            style={{
              width: 'max-content',
              minWidth: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              tableLayout: 'auto',
              fontSize: '0.9rem'
            }}
          >
            <thead style={{ position: 'sticky', top: 0, zIndex: 6, backgroundColor: '#f1f5f9' }}>
            <tr>
              {[
                'Patient Name',
                'DOB',
                'Regimen',
                'Last Lab',
                'Next Lab',
                'Lab Status',
                'Last Supply',
                'Eligible Date',
                'Supply Status',
                'Address',
                'Phone',
                'Payment Method',
                'Client Type',
                'Service Start',
                'Contract End',
                'Alert Status',
                'Last DEA Activity',
                'DEA Drug'
              ].map((header) => (
                <th key={header} style={headerStyle}>
                  {header}
                </th>
              ))}
            </tr>
            </thead>
          <tbody>
            {patients.map((patient) => {
              const labInfo = computeLabStatus(patient.last_lab ?? null, patient.next_lab ?? null);
              const statusKey = (patient.status_key ?? '').toLowerCase();
              const effectiveAlertStatus =
                statusKey === 'active' && (labInfo.state === 'overdue' || labInfo.state === 'due-soon')
                  ? 'Active - Pending'
                  : patient.alert_status ?? '—';
              const palette = deriveRowColors(effectiveAlertStatus, patient.type_of_client, patient.method_of_payment);
              const baseCell = { ...cellStyle, backgroundColor: palette.rowColor };
              const wrapCell = { ...baseCell, whiteSpace: 'normal' as const };
              const paymentCell = { ...cellStyle, backgroundColor: palette.paymentColor };
              const typeCell = { ...cellStyle, backgroundColor: palette.typeColor };
              const statusCell = { ...cellStyle, backgroundColor: palette.statusColor };

              const labStatus = patient.lab_status?.trim() || labInfo.label;
              return (
                <tr
                  key={patient.patient_id}
                  style={{
                    borderLeft: patient.is_primary_care ? '4px solid #38bdf8' : '4px solid transparent'
                  }}
                >
                  <td style={baseCell}>{patient.patient_name}</td>
                  <td style={baseCell}>{formatDate(patient.date_of_birth)}</td>
                  <td style={baseCell}>{patient.regimen ?? '—'}</td>
                  <td style={baseCell}>{formatDate(patient.last_lab)}</td>
                  <td style={baseCell}>{formatDate(patient.next_lab)}</td>
                  <td style={baseCell}>{labStatus ?? '—'}</td>
                  <td style={baseCell}>{formatDate(patient.last_supply_date)}</td>
                  <td style={baseCell}>{formatDate(patient.eligible_for_next_supply)}</td>
                  <td style={wrapCell}>{patient.supply_status ?? '—'}</td>
                  <td style={{ ...wrapCell, minWidth: '240px' }}>{patient.address ?? '—'}</td>
                  <td style={baseCell}>{patient.phone_number ?? '—'}</td>
                  <td style={paymentCell}>{patient.method_of_payment ?? '—'}</td>
                  <td style={typeCell}>{patient.type_of_client ?? '—'}</td>
                  <td style={baseCell}>{formatDate(patient.service_start_date)}</td>
                  <td style={baseCell}>{formatDate(patient.contract_end)}</td>
                  <td style={statusCell}>{effectiveAlertStatus}</td>
                  <td style={baseCell}>{formatDate(patient.last_controlled_dispense_at)}</td>
                  <td style={baseCell}>{patient.last_dea_drug ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

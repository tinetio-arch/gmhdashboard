'use client';

import { useState } from 'react';
import type { MembershipAuditData } from '@/lib/membershipAudit';

type Props = {
  data: MembershipAuditData;
};

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

export default function MembershipAuditClient({ data }: Props) {
  const [auditData, setAuditData] = useState(data);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleLink(patientId: string, clinicsyncPatientId: string) {
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
        readyToMap: prev.readyToMap.filter((row) => row.clinicsync_patient_id !== clinicsyncPatientId)
      }));
      setMessage('Mapping saved. Refresh the page after syncing to verify.');
    } catch (error) {
      console.error(error);
      setMessage('Link failed. Please try again.');
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
                    <td style={{ padding: '0.75rem' }}>{row.patient_name}</td>
                    <td style={{ padding: '0.75rem' }}>{row.matched_patient}</td>
                    <td style={{ padding: '0.75rem' }}>{row.plan_name ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.status ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.remaining_cycles ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.contract_end_date ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.outstanding_balance ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => handleLink(row.patient_id, row.clinicsync_patient_id)}
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
        {auditData.needsData.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Membership Name', 'Plan', 'Status', 'Issue', 'Remaining', 'Contract End', 'Balance', ''].map(
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
                {auditData.needsData.map((row) => (
                  <tr key={`${row.norm_name}-${row.issue}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem' }}>{row.patient_name}</td>
                    <td style={{ padding: '0.75rem' }}>{row.plan_name ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.status ?? ''}</td>
                    <td style={{ padding: '0.75rem', textTransform: 'capitalize' }}>{row.issue.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '0.75rem' }}>{row.remaining_cycles ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.contract_end_date ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>{row.outstanding_balance ?? ''}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => handleResolve(row.norm_name)}
                        disabled={busyId === row.norm_name}
                        style={{
                          padding: '0.4rem 0.9rem',
                          borderRadius: '0.5rem',
                          border: '1px solid #e2e8f0',
                          background: '#f1f5f9',
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
                    <td style={{ padding: '0.75rem' }}>{row.patient_name}</td>
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
    </div>
  );
}


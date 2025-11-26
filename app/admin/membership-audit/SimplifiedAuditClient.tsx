"use client";

import { useState } from 'react';
import Link from 'next/link';
import type { MembershipAuditData, QuickBooksAuditData } from '@/lib/membershipAudit';
import type { LookupSets } from '@/lib/lookups';
import { withBasePath } from '@/lib/basePath';

type Props = {
  data: MembershipAuditData;
  quickbooksData: QuickBooksAuditData;
  lookups: LookupSets;
};

function formatCurrency(value: string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (Number.isNaN(amount)) {
    return '$0.00';
  }
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function SimplifiedAuditClient({ data, quickbooksData, lookups }: Props) {
  const [activeTab, setActiveTab] = useState<'outstanding' | 'needs-intake' | 'duplicates' | 'quickbooks'>('outstanding');

  // Calculate outstanding balances
  const janeOutstanding = data.readyToMap
    .filter(row => parseFloat(row.outstanding_balance || '0') > 0)
    .reduce((sum, row) => sum + parseFloat(row.outstanding_balance || '0'), 0);
  
  const qbOutstanding = quickbooksData.overdueInvoices
    .reduce((sum, row) => sum + parseFloat(row.amount_due || '0'), 0);

  // Get patients needing intake
  const needsIntake = data.needsData.filter(row => !row.gmh_patient_id);

  // Get duplicates
  const duplicates = data.duplicates;

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
            Membership Audit
          </h1>
          <p style={{ color: '#64748b', fontSize: '1rem' }}>
            Actionable items requiring attention. Focus on what matters.
          </p>
        </div>

        {/* Summary Cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)',
            border: '2px solid #ef4444',
            boxShadow: '0 10px 40px rgba(239, 68, 68, 0.2)'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Outstanding
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#dc2626', marginBottom: '0.25rem' }}>
              {formatCurrency((janeOutstanding + qbOutstanding).toString())}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              {data.readyToMap.filter(r => parseFloat(r.outstanding_balance || '0') > 0).length + quickbooksData.overdueInvoices.length} patients
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #dbeafe 0%, #e0f2fe 100%)',
            border: '2px solid #3b82f6',
            boxShadow: '0 10px 40px rgba(59, 130, 246, 0.2)'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Needs Intake
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#2563eb', marginBottom: '0.25rem' }}>
              {needsIntake.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Patients to add to system
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
            border: '2px solid #f59e0b',
            boxShadow: '0 10px 40px rgba(245, 158, 11, 0.2)'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Duplicates
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#d97706', marginBottom: '0.25rem' }}>
              {duplicates.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Groups to merge
            </div>
          </div>

          <div style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
            border: '2px solid #8b5cf6',
            boxShadow: '0 10px 40px rgba(139, 92, 246, 0.2)'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Ready to Map
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#7c3aed', marginBottom: '0.25rem' }}>
              {data.readyToMap.length}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Memberships ready
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          marginBottom: '1.5rem',
          borderBottom: '2px solid #e2e8f0'
        }}>
          {[
            { id: 'outstanding', label: 'Outstanding Balances', count: data.readyToMap.filter(r => parseFloat(r.outstanding_balance || '0') > 0).length + quickbooksData.overdueInvoices.length },
            { id: 'needs-intake', label: 'Needs Intake', count: needsIntake.length },
            { id: 'duplicates', label: 'Duplicates', count: duplicates.length },
            { id: 'quickbooks', label: 'QuickBooks Issues', count: quickbooksData.unmappedRecurring.length + quickbooksData.unmappedPatients.length }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '0.75rem 1.5rem',
                border: 'none',
                background: 'transparent',
                borderBottom: activeTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
                color: activeTab === tab.id ? '#3b82f6' : '#64748b',
                fontWeight: activeTab === tab.id ? 600 : 500,
                cursor: 'pointer',
                fontSize: '0.95rem',
                transition: 'all 0.2s'
              }}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)'
        }}>
          {activeTab === 'outstanding' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
                Outstanding Balances
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {/* Jane Outstanding */}
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#1e40af' }}>
                    Jane Patients ({formatCurrency(janeOutstanding.toString())})
                  </h3>
                  <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    {data.readyToMap
                      .filter(row => parseFloat(row.outstanding_balance || '0') > 0)
                      .slice(0, 20)
                      .map((row, idx) => (
                        <div key={idx} style={{
                          padding: '0.75rem',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                              {row.norm_name}
                            </div>
                            {row.plan_name && (
                              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                {row.plan_name}
                              </div>
                            )}
                          </div>
                          <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '1rem' }}>
                            {formatCurrency(row.outstanding_balance)}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* QuickBooks Outstanding */}
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#ea580c' }}>
                    QuickBooks Patients ({formatCurrency(qbOutstanding.toString())})
                  </h3>
                  <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    {quickbooksData.overdueInvoices.slice(0, 20).map((row, idx) => (
                      <div key={idx} style={{
                        padding: '0.75rem',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                            {row.customer_name}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            Invoice #{row.invoice_number}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '1rem' }}>
                          {formatCurrency(row.amount_due)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'needs-intake' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
                Patients Needing Intake
              </h2>
              <p style={{ color: '#64748b', marginBottom: '1rem' }}>
                These patients have memberships but no GMH patient record. Add them to the system.
              </p>
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 10 }}>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Plan</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>Balance</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needsIntake.slice(0, 50).map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem', fontWeight: 600 }}>{row.norm_name}</td>
                        <td style={{ padding: '0.75rem', color: '#64748b' }}>{row.plan_name || '—'}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: parseFloat(row.outstanding_balance || '0') > 0 ? '#dc2626' : '#64748b' }}>
                          {formatCurrency(row.outstanding_balance)}
                        </td>
                        <td style={{ padding: '0.75rem', color: '#64748b' }}>{row.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'duplicates' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
                Duplicate Patients
              </h2>
              <p style={{ color: '#64748b', marginBottom: '1rem' }}>
                These groups have multiple patient records that should be merged.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {duplicates.slice(0, 20).map((group, idx) => (
                  <div key={idx} style={{
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#0f172a' }}>
                      {group.normalized_name} ({group.patients.length} records)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {group.patients.map((patient, pIdx) => (
                        <div key={pIdx} style={{
                          padding: '0.5rem',
                          background: '#ffffff',
                          borderRadius: '0.5rem',
                          fontSize: '0.85rem'
                        }}>
                          <Link 
                            href={withBasePath(`/patients/${patient.patient_id}`)}
                            style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {patient.full_name}
                          </Link>
                          <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>
                            • {patient.status_key || 'No status'} • {patient.phone_primary || 'No phone'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'quickbooks' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
                QuickBooks Issues
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#ea580c' }}>
                    Unmapped Recurring ({quickbooksData.unmappedRecurring.length})
                  </h3>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {quickbooksData.unmappedRecurring.slice(0, 20).map((row, idx) => (
                      <div key={idx} style={{
                        padding: '0.75rem',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '0.9rem'
                      }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.customer_name}</div>
                        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                          {formatCurrency(row.amount)} • {row.frequency || 'Unknown frequency'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#ea580c' }}>
                    Unmapped Patients ({quickbooksData.unmappedPatients.length})
                  </h3>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {quickbooksData.unmappedPatients.slice(0, 20).map((row, idx) => (
                      <div key={idx} style={{
                        padding: '0.75rem',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '0.9rem'
                      }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.customer_name}</div>
                        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                          {row.email || 'No email'} • {row.phone || 'No phone'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


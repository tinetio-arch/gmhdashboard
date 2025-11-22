import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fetchPatientById } from '@/lib/patientQueries';
import { fetchDispensesForPatient } from '@/lib/inventoryQueries';
import { fetchPatientFinancialData } from '@/lib/patientFinancials';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: { id: string };
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function formatVolume(value: string | null | undefined): string {
  if (!value) return '—';
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return value;
  }
  return `${numeric.toFixed(2)} mL`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default async function PatientDetailPage({ params }: PageProps) {
  await requireUser('write');
  const patient = await fetchPatientById(params.id);
  if (!patient) {
    notFound();
  }

  const financials = await fetchPatientFinancialData(params.id);
  const dispenses = await fetchDispensesForPatient(params.id, 200);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/patients" style={{ color: '#0284c7', fontWeight: 600 }}>
          ← Back to Patients
        </Link>
        <h1 style={{ margin: 0, fontSize: '2rem', color: '#0f172a' }}>{patient.patient_name}</h1>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '1.2rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          borderRadius: '0.9rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          padding: '1.75rem'
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Status
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {patient.alert_status ?? patient.status_key ?? '—'}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Regimen
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {patient.regimen ?? '—'}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Method of Payment
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {patient.method_of_payment ?? '—'}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Client Type
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {patient.type_of_client ?? '—'}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Contact
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#0f172a' }}>{patient.phone_number ?? '—'}</p>
          <p style={{ margin: 0, color: '#0f172a' }}>{patient.email ?? '—'}</p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Address
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#0f172a', whiteSpace: 'pre-line' }}>{patient.address ?? '—'}</p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Last Supply
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {formatDate(patient.last_supply_date)}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Eligible Date
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {formatDate(patient.eligible_for_next_supply)}
          </p>
        </div>
      </div>

      <div
        style={{
          borderRadius: '0.9rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>Financial Overview</h2>
          <p style={{ margin: 0, color: '#475569' }}>Combined view of QuickBooks and ClinicSync data for this patient.</p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem'
          }}
        >
          <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', padding: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              QuickBooks Mapping
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {financials.quickbooks.mapping ? 'Linked' : 'Not Linked'}
            </p>
            {financials.quickbooks.mapping && (
              <p style={{ margin: '0.15rem 0 0', color: '#475569' }}>{financials.quickbooks.mapping.name ?? financials.quickbooks.mapping.customerId}</p>
            )}
          </div>
          <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', padding: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              QuickBooks Open Balance
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {formatCurrency(financials.quickbooks.stats.openBalance)}
            </p>
            <p style={{ margin: '0.15rem 0 0', color: '#475569' }}>
              {financials.quickbooks.stats.openInvoices} open {financials.quickbooks.stats.openInvoices === 1 ? 'invoice' : 'invoices'}
            </p>
          </div>
          <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', padding: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ClinicSync Memberships
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {financials.clinicsync.stats.activeMemberships} active
            </p>
            <p style={{ margin: '0.15rem 0 0', color: '#475569' }}>
              {financials.clinicsync.stats.nextPaymentDue
                ? `Next payment ${formatDate(financials.clinicsync.stats.nextPaymentDue)}`
                : 'No payment due'}
            </p>
          </div>
          <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', padding: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Payment Issues
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {financials.paymentIssues.length}
            </p>
            <p style={{ margin: '0.15rem 0 0', color: '#475569' }}>Unresolved alerts for this patient</p>
          </div>
        </div>

        {financials.quickbooks.invoices.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>QuickBooks Invoices</h3>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  {['Invoice', 'Status', 'Amount', 'Balance', 'Due Date', 'Days Overdue'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.quickbooks.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {invoice.invoiceNumber ?? invoice.invoiceId}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', textTransform: 'capitalize' }}>
                      {invoice.paymentStatus ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatCurrency(invoice.amountDue)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', color: invoice.balance > 0 ? '#dc2626' : '#0f172a' }}>
                      {formatCurrency(invoice.balance)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {invoice.daysOverdue > 0 ? `${invoice.daysOverdue} days` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {financials.quickbooks.salesReceipts.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Recent Sales Receipts</h3>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  {['Receipt', 'Date', 'Amount', 'Payment Method', 'Recurring ID', 'Status', 'Notes'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.quickbooks.salesReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{receipt.id}</td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(receipt.date)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatCurrency(receipt.amount)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {receipt.paymentMethod ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {receipt.recurringId ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {receipt.status ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {receipt.note ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {financials.quickbooks.payments.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>QuickBooks Payments</h3>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 560 }}>
              <thead>
                <tr>
                  {['Payment', 'Date', 'Amount', 'Deposit Account'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.quickbooks.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{payment.id}</td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(payment.date)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatCurrency(payment.amount)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {payment.depositAccount ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {financials.clinicsync.memberships.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>ClinicSync Memberships</h3>
            {/* Show active memberships count if multiple */}
            {financials.clinicsync.memberships.filter(m => m.isActive).length > 1 && (
              <div style={{ 
                padding: '0.5rem 1rem', 
                backgroundColor: '#dbeafe', 
                borderRadius: '0.375rem',
                marginBottom: '0.75rem',
                color: '#1e40af',
                fontSize: '0.875rem'
              }}>
                ℹ️ This patient has {financials.clinicsync.memberships.filter(m => m.isActive).length} active memberships
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  {['Plan', 'Pass ID', 'Tier', 'Status', 'Balance', 'Next Payment', 'End Date'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.clinicsync.memberships.map((membership) => (
                  <tr key={`${membership.clinicsyncId}-${membership.updatedAt ?? ''}`}
                      style={{ 
                        backgroundColor: membership.isActive ? 'transparent' : 'rgba(243, 244, 246, 0.5)'
                      }}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {membership.plan ?? membership.clinicsyncId}
                      {!membership.isActive && membership.contractEnd && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>
                          Expired
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {membership.passId ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{membership.tier ?? '—'}</td>
                    <td
                      style={{
                        padding: '0.65rem 0.9rem',
                        borderBottom: '1px solid rgba(148,163,184,0.15)',
                        color: membership.isActive ? '#15803d' : '#64748b'
                      }}
                    >
                      {membership.status ?? (membership.isActive ? 'active' : 'expired')}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatCurrency(membership.balanceOwing || membership.amountDue)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(membership.nextPaymentDue)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(membership.contractEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {financials.paymentIssues.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Open Payment Issues</h3>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 560 }}>
              <thead>
                <tr>
                  {['Issue', 'Severity', 'Amount Owed', 'Days Overdue', 'Created'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.paymentIssues.map((issue) => (
                  <tr key={issue.issueId}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', textTransform: 'capitalize' }}>
                      {issue.issueType.replace('_', ' ')}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{issue.severity}</td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', color: '#dc2626' }}>
                      {formatCurrency(issue.amountOwed)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {issue.daysOverdue > 0 ? `${issue.daysOverdue} days` : '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {formatDate(issue.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          borderRadius: '0.9rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          padding: '1.5rem'
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>Dispensing History</h2>
        {dispenses.length === 0 ? (
          <p style={{ marginTop: '1rem', color: '#64748b' }}>No dispensing records found for this patient.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1.25rem' }}>
            <table style={{ width: '100%', minWidth: 960, borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {[
                    'Date',
                    'Transaction',
                    'Dose (mL)',
                    'Waste (mL)',
                    'Total Volume',
                    'Vial',
                    'Recorded By',
                    'Signed By',
                    'Notes'
                  ].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.75rem 1rem',
                        textAlign: 'left',
                        color: '#475569',
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        backgroundColor: '#f1f5f9',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.18)'
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispenses.map((row) => (
                  <tr key={row.dispense_id}>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {formatDate(row.dispense_date)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {row.transaction_type ?? '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {formatVolume(row.total_dispensed_ml)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {formatVolume(row.waste_ml)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {formatVolume(row.total_amount)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {row.vial_external_id ?? '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {row.created_by_name ?? '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}>
                      {row.signed_by_name ? `${row.signed_by_name} (${formatDate(row.signed_at)})` : '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.14)', maxWidth: 320 }}>
                      {row.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}


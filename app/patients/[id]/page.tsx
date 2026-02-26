import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fetchPatientById } from '@/lib/patientQueries';
import { fetchDispensesForPatient } from '@/lib/inventoryQueries';
import { fetchPatientFinancialData } from '@/lib/patientFinancials';
import { query } from '@/lib/db';
import { createGHLClient } from '@/lib/ghl';
import PatientDetailClient from './PatientDetailClient';
import { fetchHealthiePatientProfile } from '@/lib/healthiePatientData';

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

  // Fetch GHL sync status directly
  const [ghlSync] = await query<{
    ghl_contact_id: string | null;
    ghl_sync_status: string | null;
    ghl_last_synced_at: string | null;
    ghl_sync_error: string | null;
    ghl_tags: string | null;
  }>(
    `SELECT 
      ghl_contact_id,
      ghl_sync_status,
      ghl_last_synced_at,
      ghl_sync_error,
      ghl_tags
    FROM patients
    WHERE patient_id = $1`,
    [params.id]
  );

  // Fetch avatar URL
  const [avatarRow] = await query<{ avatar_url: string | null }>(
    `SELECT avatar_url FROM patients WHERE patient_id = $1`,
    [params.id]
  );
  const avatarUrl = avatarRow?.avatar_url ?? null;

  // Get GHL location ID from client or environment for profile links
  const ghlClient = createGHLClient();
  const ghlLocationId = ghlClient?.getLocationId() || process.env.GHL_LOCATION_ID || '';

  const financials = await fetchPatientFinancialData(params.id);
  const dispenses = await fetchDispensesForPatient(params.id, 200);
  const healthie = await fetchHealthiePatientProfile(params.id);

  // Generate initials for avatar fallback
  const initials = (patient.patient_name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word: string) => word[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/patients" style={{ color: '#0284c7', fontWeight: 600 }}>
          ← Back to Patients
        </Link>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${patient.patient_name}'s avatar`}
            style={{
              width: '5rem',
              height: '5rem',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '2px solid rgba(148, 163, 184, 0.3)',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.1)'
            }}
          />
        ) : (
          <div
            style={{
              width: '5rem',
              height: '5rem',
              borderRadius: '50%',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              fontWeight: 700,
              border: '2px solid rgba(148, 163, 184, 0.2)',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.1)',
              flexShrink: 0
            }}
          >
            {initials || '?'}
          </div>
        )}
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
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Date of Birth
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {formatDate(patient.date_of_birth)}
          </p>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Last Lab
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {formatDate(patient.last_lab)}
          </p>
          {patient.lab_status && (
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Status: {patient.lab_status}
            </p>
          )}
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Next Lab
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {formatDate(patient.next_lab)}
          </p>
        </div>
        {patient.membership_program && (
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Membership
            </h2>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
              {patient.membership_program}
            </p>
            {patient.membership_status && (
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: patient.membership_status.toLowerCase() === 'active' ? '#059669' : '#d97706' }}>
                {patient.membership_status}
                {patient.membership_balance ? ` · Balance: ${patient.membership_balance}` : ''}
              </p>
            )}
            {patient.next_charge_date && (
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Next charge: {formatDate(patient.next_charge_date)}
              </p>
            )}
          </div>
        )}
        {patient.service_start_date && (
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Service Dates
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#0f172a' }}>
              Start: {formatDate(patient.service_start_date)}
            </p>
            {patient.contract_end && (
              <p style={{ margin: '0.15rem 0 0', color: '#0f172a' }}>
                Contract End: {formatDate(patient.contract_end)}
              </p>
            )}
          </div>
        )}
        {patient.date_added && (
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Added
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#0f172a' }}>
              {formatDate(patient.date_added)}
              {patient.added_by ? ` by ${patient.added_by}` : ''}
            </p>
          </div>
        )}
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            GHL Sync Status
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.15rem', fontWeight: 600, color: '#0f172a' }}>
            {ghlSync?.ghl_contact_id ? (
              <span style={{
                color: ghlSync.ghl_sync_status === 'synced' ? '#059669' :
                  ghlSync.ghl_sync_status === 'error' ? '#dc2626' :
                    ghlSync.ghl_sync_status === 'syncing' ? '#d97706' : '#64748b',
                textTransform: 'capitalize'
              }}>
                {ghlSync.ghl_sync_status === 'synced' ? '✓ Synced' :
                  ghlSync.ghl_sync_status === 'error' ? '✗ Error' :
                    ghlSync.ghl_sync_status === 'syncing' ? '⟳ Syncing' :
                      'Pending'}
              </span>
            ) : (
              <span style={{ color: '#64748b' }}>Not Linked</span>
            )}
          </p>
          {ghlSync?.ghl_contact_id && (
            <>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.875rem', color: '#64748b', fontFamily: 'monospace' }}>
                ID: {ghlSync.ghl_contact_id.substring(0, 8)}...
              </p>
              {ghlLocationId ? (
                <a
                  href={`https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${ghlSync.ghl_contact_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '0.5rem',
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#ffffff',
                    backgroundColor: '#0284c7',
                    borderRadius: '0.375rem',
                    textDecoration: 'none',
                  }}
                >
                  View in GHL →
                </a>
              ) : (
                <a
                  href={`https://app.gohighlevel.com/contacts/detail/${ghlSync.ghl_contact_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '0.5rem',
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#ffffff',
                    backgroundColor: '#0284c7',
                    borderRadius: '0.375rem',
                    textDecoration: 'none',
                  }}
                >
                  View in GHL →
                </a>
              )}
            </>
          )}
          {ghlSync?.ghl_last_synced_at && (
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              {formatDate(ghlSync.ghl_last_synced_at)}
            </p>
          )}
        </div>
        {healthie.healthieClientId && (
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Healthie
            </h2>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', fontWeight: 600, color: '#059669' }}>
              ✓ Linked
            </p>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
              ID: {healthie.healthieClientId}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <a
                href={`https://secure.gethealthie.com/users/${healthie.healthieClientId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#ffffff',
                  backgroundColor: '#059669',
                  borderRadius: '0.375rem',
                  textDecoration: 'none',
                }}
              >
                View in Healthie →
              </a>
            </div>
            {(healthie.documents > 0 || healthie.forms > 0) && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                {healthie.documents > 0 ? `${healthie.documents} docs` : ''}
                {healthie.documents > 0 && healthie.forms > 0 ? ' · ' : ''}
                {healthie.forms > 0 ? `${healthie.forms} forms` : ''}
              </p>
            )}
          </div>
        )}
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
          <p style={{ margin: 0, color: '#475569' }}>Combined view of QuickBooks and Healthie billing data for this patient.</p>
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
              Healthie Last Payment
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {(() => {
                const succeeded = healthie.billingItems.filter(b => b.state === 'succeeded' || b.state === 'completed');
                const last = succeeded[0];
                return last ? `$${last.amount_paid_string ?? last.amount_paid ?? '0.00'}` : '—';
              })()}
            </p>
            <p style={{ margin: '0.15rem 0 0', color: '#475569' }}>
              {(() => {
                const succeeded = healthie.billingItems.filter(b => b.state === 'succeeded' || b.state === 'completed');
                const last = succeeded[0];
                return last?.created_at ? formatDate(last.created_at) : 'No payments recorded';
              })()}
            </p>
            {healthie.billingItems.filter(b => b.state === 'succeeded' || b.state === 'completed').length > 0 && (
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Total paid: {formatCurrency(healthie.billingItems.filter(b => b.state === 'succeeded' || b.state === 'completed').reduce((sum, b) => sum + Number(b.amount_paid || 0), 0))} ({healthie.billingItems.filter(b => b.state === 'succeeded' || b.state === 'completed').length} payments)
              </p>
            )}
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

        {healthie.billingItems.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Healthie Billing Items ({healthie.billingItems.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 700 }}>
              <thead>
                <tr>
                  {['Date', 'Amount', 'Status', 'Offering', 'Payment Method', 'Description'].map((header) => (
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
                {healthie.billingItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', whiteSpace: 'nowrap' }}>
                      {formatDate(item.created_at)}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', fontWeight: 600 }}>
                      ${item.amount_paid_string ?? item.amount_paid ?? '0.00'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', textTransform: 'capitalize' }}>
                      <span style={{ color: (item.state === 'succeeded' || item.state === 'completed') ? '#059669' : item.state === 'failed' ? '#dc2626' : item.state === 'scheduled' ? '#d97706' : '#64748b' }}>
                        {item.state ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', maxWidth: 250, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.offering_name ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                      {item.payment_medium ?? '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', maxWidth: 250, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.85rem', color: '#64748b' }}>
                      {item.shown_description ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {financials.paymentIssues.length > 0 && (
          <PatientDetailClient
            paymentIssues={financials.paymentIssues}
            patientId={params.id}
          />
        )}
      </div>

      {/* Patient Notes */}
      {patient.patient_notes && (
        <div
          style={{
            borderRadius: '0.9rem',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            backgroundColor: '#fffbeb',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
            padding: '1.25rem',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#92400e' }}>📝 Patient Notes</h2>
          <p style={{ margin: 0, color: '#78350f', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {patient.patient_notes}
          </p>
          {patient.lab_notes && (
            <p style={{ margin: '0.75rem 0 0', color: '#78350f', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              <strong>Lab Notes:</strong> {patient.lab_notes}
            </p>
          )}
        </div>
      )}

      {/* Clinical Info from Healthie */}
      {healthie.healthieClientId && (
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
            <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>Clinical Info</h2>
            <p style={{ margin: 0, color: '#475569' }}>Medications, allergies, and prescriptions from Healthie EMR.</p>
          </div>

          {/* Medications */}
          {healthie.medications.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Medications ({healthie.medications.length})</h3>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 560 }}>
                <thead>
                  <tr>
                    {['Medication', 'Dosage', 'Frequency', 'Route', 'Status'].map((h) => (
                      <th key={h} style={{ padding: '0.65rem 0.9rem', textAlign: 'left', fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', backgroundColor: '#f8fafc', borderBottom: '1px solid rgba(148,163,184,0.3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {healthie.medications.map((med) => (
                    <tr key={med.id}>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', fontWeight: 500 }}>{med.name ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{med.dosage ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{med.frequency ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{med.route ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                        <span style={{ color: med.normalized_status === 'active' ? '#059669' : '#64748b', textTransform: 'capitalize' }}>{med.normalized_status ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>No medications recorded in Healthie.</p>
          )}

          {/* Allergies */}
          {healthie.allergies.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Allergies ({healthie.allergies.length})</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {healthie.allergies.map((allergy) => (
                  <div
                    key={allergy.id}
                    style={{
                      padding: '0.5rem 0.85rem',
                      borderRadius: '0.5rem',
                      backgroundColor: allergy.severity === 'severe' ? '#fef2f2' : '#fff7ed',
                      border: `1px solid ${allergy.severity === 'severe' ? '#fecaca' : '#fed7aa'}`,
                      fontSize: '0.85rem',
                    }}
                  >
                    <strong style={{ color: allergy.severity === 'severe' ? '#dc2626' : '#d97706' }}>
                      {allergy.name ?? 'Unknown'}
                    </strong>
                    {allergy.reaction && (
                      <span style={{ color: '#64748b', marginLeft: '0.35rem' }}>— {allergy.reaction}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prescriptions */}
          {healthie.prescriptions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Prescriptions ({healthie.prescriptions.length})</h3>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 700 }}>
                <thead>
                  <tr>
                    {['Medication', 'Dosage', 'Directions', 'Qty', 'Refills', 'Status', 'Pharmacy'].map((h) => (
                      <th key={h} style={{ padding: '0.65rem 0.9rem', textAlign: 'left', fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', backgroundColor: '#f8fafc', borderBottom: '1px solid rgba(148,163,184,0.3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {healthie.prescriptions.map((rx) => (
                    <tr key={rx.id}>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', fontWeight: 500 }}>{rx.product_name ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{rx.dosage ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rx.directions ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{rx.quantity ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{rx.refills ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                        <span style={{ color: rx.normalized_status === 'active' ? '#059669' : '#64748b', textTransform: 'capitalize' }}>{rx.normalized_status ?? rx.status ?? '—'}</span>
                      </td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', fontSize: '0.85rem' }}>{rx.pharmacy?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Subscriptions & Payment Methods */}
      {healthie.healthieClientId && (healthie.subscriptions.length > 0 || healthie.paymentMethods.length > 0) && (
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
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>Subscriptions & Payments</h2>

          {/* Active Subscriptions */}
          {healthie.subscriptions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Active Subscriptions ({healthie.subscriptions.length})</h3>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 500 }}>
                <thead>
                  <tr>
                    {['Package', 'Status', 'Amount', 'Next Charge', 'Start Date'].map((h) => (
                      <th key={h} style={{ padding: '0.65rem 0.9rem', textAlign: 'left', fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', backgroundColor: '#f8fafc', borderBottom: '1px solid rgba(148,163,184,0.3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {healthie.subscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)', fontWeight: 500 }}>{sub.package_id}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                        <span style={{ color: sub.status === 'active' ? '#059669' : sub.status === 'cancelled' ? '#dc2626' : '#d97706', textTransform: 'capitalize' }}>{sub.status ?? '—'}</span>
                      </td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{sub.amount ? formatCurrency(sub.amount) : '—'}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{formatDate(sub.next_charge_date)}</td>
                      <td style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>{formatDate(sub.start_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Payment Methods */}
          {healthie.paymentMethods.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>Payment Methods on File</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                {healthie.paymentMethods.map((pm) => (
                  <div
                    key={pm.id}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(148,163,184,0.2)',
                      backgroundColor: pm.is_default ? '#f0fdf4' : '#f8fafc',
                      minWidth: 180,
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 600, color: '#0f172a' }}>
                      {pm.type === 'CreditCard' ? '💳' : '🏦'} {pm.type}
                      {pm.last_four ? ` ···· ${pm.last_four}` : ''}
                    </p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                      {pm.is_default ? '✓ Default' : ''}
                      {pm.expires_at ? ` · Exp: ${pm.expires_at}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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


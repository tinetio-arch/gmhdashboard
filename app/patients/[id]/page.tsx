import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fetchPatientById } from '@/lib/patientQueries';
import { fetchDispensesForPatient } from '@/lib/inventoryQueries';

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

export default async function PatientDetailPage({ params }: PageProps) {
  await requireUser('write');
  const patient = await fetchPatientById(params.id);
  if (!patient) {
    notFound();
  }

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


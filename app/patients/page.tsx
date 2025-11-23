export const dynamic = 'force-dynamic';

import PatientTable from './PatientTable';
import { fetchPatientDataEntries, fetchProfessionalDashboardPatients } from '@/lib/patientQueries';
import { fetchLookupSets } from '@/lib/lookups';
import AddPatientForm from './AddPatientForm';
import { requireUser } from '@/lib/auth';

export default async function PatientsPage({
  searchParams
}: {
  searchParams: { status?: string; search?: string }
}) {
  const user = await requireUser('write');
  const [patients, lookups, professionalPatients] = await Promise.all([
    fetchPatientDataEntries(),
    fetchLookupSets(),
    fetchProfessionalDashboardPatients()
  ]);
  const userEmail = user.email;

  return (
    <section>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Patient_Data_Entry (Staff Panel)</h2>
        <p style={{ color: '#64748b', maxWidth: '48rem' }}>
          This view mirrors the collaborative Google Sheet: add patients, adjust lab cadence, update payment status,
          and keep contact details in sync. Every change writes directly to Postgres and is logged for auditing.
        </p>
      </div>
      <AddPatientForm lookups={lookups} currentUserRole={user.role} currentUserEmail={userEmail} />
      <PatientTable
        patients={patients}
        lookups={lookups}
        professionalPatients={professionalPatients}
        currentUserRole={user.role}
        currentUserEmail={userEmail}
        initialStatusFilter={searchParams.status}
        initialSearchQuery={searchParams.search}
      />
    </section>
  );
}

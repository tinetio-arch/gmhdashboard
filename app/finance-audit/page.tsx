export const dynamic = 'force-dynamic';

import { requireUser } from '@/lib/auth';
import FinanceAuditTable from './FinanceAuditTable';

export default async function FinanceAuditPage() {
  await requireUser('read');

  return (
    <section style={{ padding: '0 1rem' }}>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Finance Audit</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '60rem' }}>
        All active patients with their Healthie billing status. Use filters to find patients missing
        recurring payments, cards on file, or with mismatched payment types. Data is cached for 1 hour
        — click Refresh to pull fresh data from Healthie.
      </p>
      <FinanceAuditTable />
    </section>
  );
}

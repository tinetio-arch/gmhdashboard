export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { fetchInventory, fetchTransactions } from '@/lib/inventoryQueries';
import { fetchActivePatientOptions } from '@/lib/patientQueries';
import TransactionsActions from './TransactionsActions';
import StagedDosesManager from '../inventory/StagedDosesManager';
import { requireUser } from '@/lib/auth';
import { TransactionsTable as TransactionsTableClient } from './TransactionsTable';

export default async function TransactionsPage() {
  const user = await requireUser('write');
  const [transactions, patientOptions, inventory] = await Promise.all([
    fetchTransactions(500),
    fetchActivePatientOptions(),
    fetchInventory()
  ]);

  const activeVials = inventory
    .filter((vial) => {
      const status = (vial.status ?? '').toLowerCase();
      const remaining = Number.parseFloat(vial.remaining_volume_ml ?? '0');
      return status !== 'inactive' && remaining > 0;
    })
    .map((vial) => ({
      vial_id: vial.vial_id,
      external_id: vial.external_id,
      remaining_volume_ml: vial.remaining_volume_ml,
      size_ml: vial.size_ml,
      status: vial.status,
      dea_drug_name: vial.dea_drug_name,
      expiration_date: vial.expiration_date
    }));

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Transactions & DEA Log</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '60rem' }}>
        Record dispenses, waste entries, and refunds in one place. Submissions adjust inventory balances and append to the DEA ledger automatically.
        Need to manage stock?{' '}
        <Link href="/inventory" style={{ color: '#0ea5e9', fontWeight: 600 }}>
          Return to the Inventory workspace.
        </Link>
      </p>

      {/* Prefilled Doses */}
      <StagedDosesManager patients={patientOptions} />

      <TransactionsActions patients={patientOptions} vials={activeVials} currentUserRole={user.role} />

      <TransactionsTableClient transactions={transactions} canDelete={user.role === 'admin'} />
    </section>
  );
}

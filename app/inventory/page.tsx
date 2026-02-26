export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { fetchInventory, fetchInventorySummary } from '@/lib/inventoryQueries';
import { fetchActivePatientOptions } from '@/lib/patientQueries';
import InventoryActions from './InventoryActions';
import InventoryTable from './InventoryTable';
import MorningCheckForm from './MorningCheckForm';
import StagedDosesManager from './StagedDosesManager';
import { requireUser } from '@/lib/auth';

export default async function InventoryPage() {
  const user = await requireUser('write');
  const [summary, vials, patientOptions] = await Promise.all([
    fetchInventorySummary(),
    fetchInventory(),
    fetchActivePatientOptions()
  ]);

  const transactionVials = vials
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
      dea_drug_name: vial.dea_drug_name
    }));

  const remainingVolume = Number.isFinite(summary.total_remaining_ml)
    ? summary.total_remaining_ml
    : Number(summary.total_remaining_ml ?? 0);

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Vial Inventory</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
        Keep track of stock levels, expiration dates, and controlled substances. Complete morning check before dispensing.
      </p>

      {/* Prefilled Doses - Document before morning check */}
      <StagedDosesManager patients={patientOptions} />

      {/* Morning + EOD Check Forms - DEA Compliance */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 400px' }}>
          <MorningCheckForm checkType="morning" />
        </div>
        <div style={{ flex: '1 1 400px' }}>
          <MorningCheckForm checkType="evening" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <SummaryCard label="Active Vials" value={summary.active_vials} />
        <SummaryCard label="Expired Vials" value={summary.expired_vials} />
        <SummaryCard label="Remaining Volume (mL)" value={remainingVolume.toFixed(1)} />
      </div>

      <InventoryActions
        patientOptions={patientOptions}
        vials={transactionVials}
        showBulk
        showTransactions={false}
        currentUserRole={user.role}
      />

      <p style={{ color: '#64748b', margin: '0 0 1.5rem' }}>
        Need to log a dispense or audit history?{' '}
        <Link href="/transactions" style={{ color: '#0ea5e9', fontWeight: 600 }}>
          Open the Transactions workspace.
        </Link>
      </p>

      <InventoryTable vials={vials} currentUserRole={user.role} />
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <article
      style={{
        padding: '1.25rem 1.5rem',
        borderRadius: '0.75rem',
        minWidth: '220px',
        background: '#ffffff',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)'
      }}
    >
      <h3 style={{ margin: '0 0 0.4rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </h3>
      <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: '#0f172a' }}>{value}</p>
    </article>
  );
}

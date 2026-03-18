export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { fetchInventory, fetchInventorySummary } from '@/lib/inventoryQueries';
import { query } from '@/lib/db';
import { fetchActivePatientOptions } from '@/lib/patientQueries';
import InventoryActions from './InventoryActions';
import InventoryTable from './InventoryTable';
import MorningCheckForm from './MorningCheckForm';
import StagedDosesManager from './StagedDosesManager';
import { requireUser } from '@/lib/auth';

export default async function InventoryPage() {
  const user = await requireUser('write');
  const [summary, vials, patientOptions, retiredVials] = await Promise.all([
    fetchInventorySummary(),
    fetchInventory(),
    fetchActivePatientOptions(),
    query<any>(`
      SELECT DISTINCT ON (d.vial_id)
        v.external_id, v.lot_number, v.dea_drug_name, v.size_ml,
        d.waste_ml, d.created_at as retired_at, d.notes,
        d.created_by
      FROM dispenses d
      JOIN vials v ON d.vial_id = v.vial_id
      WHERE d.transaction_type = 'waste_retirement'
      ORDER BY d.vial_id, d.created_at DESC
      LIMIT 20
    `).catch(() => [] as any[]),
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

      <RetiredVialsSection vials={retiredVials} />
    </section>
  );
}

function RetiredVialsSection({ vials }: { vials: any[] }) {
  if (vials.length === 0) return null;
  return (
    <details style={{ marginTop: '2rem' }}>
      <summary style={{
        fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
        color: '#64748b', marginBottom: '0.75rem'
      }}>
        Retired Vials ({vials.length})
      </summary>
      <div style={{
        display: 'grid', gap: '0.5rem',
        background: '#f8fafc', borderRadius: '0.75rem', padding: '1rem',
        border: '1px solid rgba(148, 163, 184, 0.22)'
      }}>
        {vials.map((v, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.5rem 0.75rem', background: '#fff', borderRadius: '0.5rem',
            border: '1px solid #e2e8f0', fontSize: '0.875rem'
          }}>
            <span><strong>{v.external_id}</strong> — {v.dea_drug_name || 'Testosterone Cypionate'} ({v.size_ml}mL)</span>
            <span style={{ color: '#94a3b8' }}>
              {v.waste_ml ? `${parseFloat(v.waste_ml).toFixed(2)} mL wasted` : ''}
              {v.retired_at ? ` · ${new Date(v.retired_at).toLocaleDateString()}` : ''}
            </span>
          </div>
        ))}
      </div>
    </details>
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

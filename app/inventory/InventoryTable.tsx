'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { VialRow } from '@/lib/inventoryQueries';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';
import { DEFAULT_TESTOSTERONE_DEA_CODE, TESTOSTERONE_VENDORS } from '@/lib/testosterone';

type Props = {
  vials: VialRow[];
  currentUserRole: UserRole;
};

const VENDOR_CARRIE_BOYD = 'Carrie Boyd - Testosterone Miglyol 812 Oil Injection 200mg/ml (Pre-Filled Syringes) - 30 ML Vials';
const VENDOR_TOPRX = 'TopRX (Testosterone Cypionate Cottonseed Oil (200mg/ml) - 10 ML Vials)';

const headerCellStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  color: '#475569',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  backgroundColor: '#f1f5f9',
  position: 'sticky',
  top: 0,
  zIndex: 2
};

const cellStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
  backgroundColor: 'transparent',
  color: '#0f172a'
};

const selectStyle: CSSProperties = {
  width: '100%',
  padding: '0.35rem 0.5rem',
  borderRadius: '0.4rem',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  fontSize: '0.85rem'
};

function rowBackground(vial: VialRow) {
  const remaining = Number.parseFloat(vial.remaining_volume_ml ?? '0');
  const capacity = Number.parseFloat(vial.size_ml ?? '0');

  if (remaining <= 0.05) {
    return '#f8d7da'; // empty
  }

  if (capacity > 0 && remaining >= capacity * 0.9) {
    return '#d9ead3'; // full
  }

  return '#fff2cc'; // in use
}

function inferVendor(vial: VialRow): string {
  const name = (vial.dea_drug_name ?? '').trim();
  if (name) {
    return name;
  }
  const size = Number.parseFloat(vial.size_ml ?? '');
  if (!Number.isNaN(size)) {
    if (size >= 20) return VENDOR_CARRIE_BOYD;
    if (size <= 10) return VENDOR_TOPRX;
  }
  return 'Testosterone';
}

export default function InventoryTable({ vials, currentUserRole }: Props) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [updatingVendorId, setUpdatingVendorId] = useState<string | null>(null);
  const canDelete = currentUserRole === 'admin';
  const canEditVendor = currentUserRole !== 'read';
  const selectableIds = useMemo(() => (canDelete ? vials.map((vial) => vial.vial_id) : []), [canDelete, vials]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));
  const hasSelection = selectedIds.length > 0;

  useEffect(() => {
    if (!canDelete) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => selectableIds.includes(id)));
  }, [canDelete, selectableIds]);

  async function handleDelete(vial: VialRow) {
    if (!canDelete) {
      setError('Only administrators can delete vials.');
      return;
    }
    const label = vial.external_id ?? vial.vial_id;
    if (!confirm(`Remove vial ${label} from inventory and DEA logs?`)) {
      return;
    }

    setDeletingId(vial.vial_id);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/inventory/vials/${encodeURIComponent(vial.vial_id)}`), {
        method: 'DELETE'
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Unable to delete vial.');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((candidate) => candidate !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableIds);
    }
  }

  async function handleBulkDelete() {
    if (!canDelete || !hasSelection) {
      return;
    }
    if (!confirm(`Delete ${selectedIds.length} vial(s) and associated logs? This cannot be undone.`)) {
      return;
    }
    setBulkDeleting(true);
    setError(null);
    try {
      const response = await fetch(withBasePath('/api/inventory/vials/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vialIds: selectedIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to delete selected vials.');
      }
      setSelectedIds([]);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleVendorChange(vial: VialRow, vendor: string) {
    if (!canEditVendor) {
      return;
    }
    setUpdatingVendorId(vial.vial_id);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/inventory/vials/${encodeURIComponent(vial.vial_id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deaDrugName: vendor,
          deaDrugCode: DEFAULT_TESTOSTERONE_DEA_CODE
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Unable to update DEA drug.');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingVendorId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {canDelete && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
            {hasSelection ? `${selectedIds.length} vial${selectedIds.length === 1 ? '' : 's'} selected` : 'No vials selected'}
          </span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={!hasSelection || bulkDeleting}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '0.55rem',
              border: '1px solid rgba(248, 113, 113, 0.5)',
              backgroundColor: !hasSelection || bulkDeleting ? 'rgba(248, 113, 113, 0.2)' : 'rgba(248, 113, 113, 0.15)',
              color: '#b91c1c',
              fontWeight: 600,
              cursor: !hasSelection || bulkDeleting ? 'not-allowed' : 'pointer'
            }}
          >
            {bulkDeleting ? 'Deleting…' : 'Delete Selected'}
          </button>
        </div>
      )}
      <div
        style={{
          overflowX: 'auto',
          borderRadius: '0.75rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
        }}
      >
        <table style={{ minWidth: 1600, width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {canDelete && (
              <th style={{ ...headerCellStyle, width: '48px' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
            )}
            {[
              'Vial ID',
              'Lot #',
              'Status',
              'Remaining (mL)',
              'Formulation',
              'Date Received',
              'Expires',
              'Location',
              'DEA Code',
              'Controlled',
              'Notes',
              'Actions'
            ].map((header) => (
              <th key={header} style={headerCellStyle}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vials.map((vial) => {
            const label = vial.external_id ?? vial.vial_id;
            const vendor = inferVendor(vial);
            return (
              <tr key={vial.vial_id} style={{ backgroundColor: rowBackground(vial) }}>
                {canDelete && (
                  <td style={{ ...cellStyle, width: '48px' }}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(vial.vial_id)}
                      onChange={() => toggleSelect(vial.vial_id)}
                      aria-label={`Select vial ${label}`}
                    />
                  </td>
                )}
                <td style={cellStyle}>{label}</td>
                <td style={cellStyle}>{vial.lot_number ?? '—'}</td>
                <td style={cellStyle}>{vial.status ?? '—'}</td>
                <td style={cellStyle}>{vial.remaining_volume_ml ?? '—'}</td>
                <td style={cellStyle}>
                  {canEditVendor ? (
                    <select
                      value={vendor}
                      onChange={(event) => handleVendorChange(vial, event.target.value)}
                      disabled={updatingVendorId === vial.vial_id}
                      style={selectStyle}
                    >
                      {TESTOSTERONE_VENDORS.map((option) => {
                        const sizeLabel = option.toLowerCase().includes('toprx') ? '10 mL Vial' : '30 mL Vial';
                        return (
                          <option key={option} value={option}>
                            {option} · {sizeLabel}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    `${vendor}${vendor.includes('TopRX') ? ' · 10 mL Vial' : vendor.includes('Carrie Boyd') ? ' · 30 mL Vial' : ''}`
                  )}
                </td>
                <td style={cellStyle}>{vial.date_received ?? '—'}</td>
                <td style={cellStyle}>{vial.expiration_date ?? '—'}</td>
                <td style={cellStyle}>{vial.location ?? '—'}</td>
                <td style={cellStyle}>{vial.dea_drug_code ?? DEFAULT_TESTOSTERONE_DEA_CODE}</td>
                <td style={cellStyle}>{vial.controlled_substance ? 'Schedule III' : '—'}</td>
                <td style={{ ...cellStyle, minWidth: '220px' }}>{vial.notes ?? '—'}</td>
                <td style={cellStyle}>
                  <button
                    type="button"
                    onClick={() => handleDelete(vial)}
                    disabled={deletingId === vial.vial_id || !canDelete}
                    style={{
                      padding: '0.45rem 0.9rem',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(248, 113, 113, 0.5)',
                      backgroundColor:
                        deletingId === vial.vial_id
                          ? 'rgba(248, 113, 113, 0.25)'
                          : canDelete
                            ? 'rgba(248, 113, 113, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                      color: canDelete ? '#b91c1c' : '#94a3b8',
                      fontWeight: 600,
                      cursor: deletingId === vial.vial_id ? 'wait' : canDelete ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {deletingId === vial.vial_id ? 'Removing…' : 'Delete'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <p style={{ color: '#b91c1c', padding: '0.75rem 1rem', margin: 0 }}>
          {error}
        </p>
      )}
      </div>
    </div>
  );
}


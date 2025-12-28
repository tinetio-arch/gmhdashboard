'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { TransactionRow } from '@/lib/inventoryQueries';
import { withBasePath } from '@/lib/basePath';

const headerStyle: CSSProperties = {
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
  backgroundColor: '#ffffff',
  color: '#0f172a'
};

const deleteButtonStyle: CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(248, 113, 113, 0.4)',
  background: 'rgba(248, 113, 113, 0.18)',
  color: '#b91c1c',
  fontWeight: 600,
  cursor: 'pointer'
};

function formatDate(value: unknown) {
  if (value === null || value === undefined) return '—';
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const str = String(value).trim();
    if (!str) return '—';
    const candidate = str.replace(' ', 'T');
    const iso = candidate.includes('Z') || candidate.includes('+') ? candidate : `${candidate}Z`;
    date = new Date(iso);
  }
  if (Number.isNaN(date.getTime())) return '—';
  // Use UTC to avoid server/client timezone hydration mismatch
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function formatMl(value: unknown) {
  if (value === null || value === undefined) return '—';
  const numeric = Number.parseFloat(String(value));
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return numeric.toFixed(1);
}

function formatMlWithUnit(value: unknown) {
  const base = formatMl(value);
  return base === '—' ? base : `${base} mL`;
}

type Props = {
  transactions: TransactionRow[];
  canDelete: boolean;
};

export function TransactionsTable({ transactions, canDelete }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(dispenseId: string) {
    if (!canDelete) return;
    if (!confirm('Delete this transaction? This removes the associated DEA log entry.')) return;
    setDeletingId(dispenseId);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/inventory/transactions/${dispenseId}`), { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to delete transaction.');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.22)', backgroundColor: '#ffffff', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)' }}>
      <table style={{ minWidth: 1200, width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {[
              'Date',
              'Vial ID',
              'Transaction',
              'Patient',
              'Patient DOB',
              'Dose (mL)',
              '# Syringes',
              'Dose/Syringe (mL)',
              'Waste (mL)',
              'Total Volume (mL)',
              'Recorded By',
              'Signed By',
              'Signed At',
              'Signature Note',
              'Status',
              'Notes',
              ...(canDelete ? ['Actions'] : [])
            ].map((header) => (
              <th key={header} style={headerStyle}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.dispense_id}>
              <td style={cellStyle}>{formatDate(tx.dispense_date)}</td>
              <td style={cellStyle}>{tx.vial_external_id ?? '—'}</td>
              <td style={cellStyle}>{tx.transaction_type ?? '—'}</td>
              <td style={cellStyle}>{tx.patient_name ?? '—'}</td>
              <td style={cellStyle}>{formatDate(tx.patient_dob)}</td>
              <td style={cellStyle}>{formatMlWithUnit(tx.total_amount)}</td>
              <td style={cellStyle}>{tx.syringe_count ?? '—'}</td>
              <td style={cellStyle}>{formatMl(tx.dose_per_syringe_ml)}</td>
              <td style={cellStyle}>{formatMl(tx.waste_ml)}</td>
              <td style={cellStyle}>{formatMlWithUnit(tx.total_amount)}</td>
              <td style={cellStyle}>{tx.created_by_name ?? '—'}</td>
              <td style={cellStyle}>{tx.signed_by_name ?? '—'}</td>
              <td style={cellStyle}>{formatDate(tx.signed_at)}</td>
              <td style={cellStyle}>{tx.signature_note ?? '—'}</td>
              <td style={cellStyle}>{tx.signature_status ?? (tx.signed_at ? 'Signed' : 'Awaiting Signature')}</td>
              <td style={{ ...cellStyle, maxWidth: 320 }}>{tx.notes ?? '—'}</td>
              {canDelete && (
                <td style={cellStyle}>
                  <button
                    type="button"
                    onClick={() => handleDelete(tx.dispense_id)}
                    disabled={deletingId === tx.dispense_id}
                    style={{ ...deleteButtonStyle, opacity: deletingId === tx.dispense_id ? 0.6 : 1 }}
                  >
                    {deletingId === tx.dispense_id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canDelete && error && (
        <div style={{ padding: '0.75rem 1rem', color: '#b91c1c', background: 'rgba(248, 113, 113, 0.12)', borderTop: '1px solid rgba(248, 113, 113, 0.3)' }}>
          {error}
        </div>
      )}
    </div>
  );
}


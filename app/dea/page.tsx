export const dynamic = 'force-dynamic';

import type { CSSProperties } from 'react';
import { fetchRecentDeaLog } from '@/lib/deaQueries';
import { requireUser } from '@/lib/auth';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default async function DeaPage() {
  await requireUser('write');
  const rows = await fetchRecentDeaLog();
  let totalDispensed = 0;
  let last30Dispensed = 0;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const byDrug = new Map<
    string,
    {
      quantity: number;
      units: string;
    }
  >();

  for (const row of rows) {
    if (typeof row.quantity_dispensed === 'number') {
      totalDispensed += row.quantity_dispensed;
      if (row.transaction_time) {
        const time = new Date(row.transaction_time);
        if (!Number.isNaN(time.getTime()) && time >= thirtyDaysAgo) {
          last30Dispensed += row.quantity_dispensed;
        }
      }

      if (row.dea_drug_name) {
        const entry = byDrug.get(row.dea_drug_name) ?? { quantity: 0, units: row.units ?? 'mL' };
        entry.quantity += row.quantity_dispensed;
        if (!entry.units && row.units) {
          entry.units = row.units;
        }
        byDrug.set(row.dea_drug_name, entry);
      }
    }
  }

  const drugTotals = Array.from(byDrug.entries()).sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 4);
  const mostRecent = rows[0] ?? null;

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>DEA Controlled Substance Log</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
        Showing the most recent 200 dispenses. Use the export button to download a CSV for regulators.
      </p>

      <form action={`${basePath}/api/export/dea`} method="post" style={{ marginBottom: '1rem' }}>
        <button
          type="submit"
          style={{
            padding: '0.55rem 1.1rem',
            borderRadius: '0.5rem',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            background: '#38bdf8',
            color: '#0f172a',
            fontWeight: 600
          }}
        >
          Export CSV
        </button>
      </form>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}
      >
        <div style={summaryCardStyle}>
          <h3 style={summaryTitleStyle}>Total Dispensed (log window)</h3>
          <p style={summaryMetricStyle}>{totalDispensed.toFixed(1)} mL</p>
          <span style={summaryHintStyle}>Across {rows.length} dispense events</span>
        </div>
        <div style={summaryCardStyle}>
          <h3 style={summaryTitleStyle}>Last 30 Days</h3>
          <p style={summaryMetricStyle}>{last30Dispensed.toFixed(1)} mL</p>
          <span style={summaryHintStyle}>Rolling volume through today</span>
        </div>
        <div style={summaryCardStyle}>
          <h3 style={summaryTitleStyle}>Most Recent Dispense</h3>
          {mostRecent ? (
            <>
              <p style={summaryMetricStyle}>{mostRecent.dea_drug_name ?? '—'}</p>
              <span style={summaryHintStyle}>
                {formatDate(mostRecent.transaction_time)}
                {mostRecent.quantity_dispensed
                  ? ` · ${mostRecent.quantity_dispensed.toFixed(1)} ${mostRecent.units ?? 'mL'}`
                  : ''}
              </span>
              <span style={summaryHintStyle}>{mostRecent.patient_name ?? '—'}</span>
            </>
          ) : (
            <span style={summaryHintStyle}>No dispense records available.</span>
          )}
        </div>
        <div style={summaryCardStyle}>
          <h3 style={summaryTitleStyle}>Top Controlled Drugs</h3>
          {drugTotals.length === 0 ? (
            <span style={summaryHintStyle}>No dispense data yet.</span>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#475569', fontWeight: 600, lineHeight: 1.4 }}>
              {drugTotals.map(([name, metrics]) => (
                <li key={name} style={{ marginBottom: '0.35rem' }}>
                  {name}{' '}
                  <span style={{ color: '#64748b', fontWeight: 500 }}>
                    {metrics.quantity.toFixed(1)} {metrics.units}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.22)', backgroundColor: '#ffffff', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.94rem' }}>
          <thead>
            <tr>
              {['Date', 'Prescriber', 'Patient', 'Drug', 'Quantity', 'Schedule', 'Lot #', 'Expires', 'Notes'].map((header) => (
                <th key={header} style={deaHeaderStyle}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.transaction_time}-${index}`}>
                <td style={deaCellStyle}>{formatDate(row.transaction_time)}</td>
                <td style={deaCellStyle}>{row.prescriber ?? '—'}</td>
                <td style={deaCellStyle}>
                  <div style={{ fontWeight: 600 }}>{row.patient_name ?? '—'}</div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
                    {[row.phone_primary, row.address_line1, row.city, row.state, row.postal_code].filter(Boolean).join(', ')}
                  </div>
                </td>
                <td style={deaCellStyle}>
                  <div>{row.dea_drug_name ?? '—'}</div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{row.dea_drug_code ?? ''}</div>
                </td>
                <td style={deaCellStyle}>
                  {typeof row.quantity_dispensed === 'number'
                    ? `${row.quantity_dispensed.toFixed(1)} ${row.units ?? 'mL'}`
                    : '—'}
                </td>
                <td style={deaCellStyle}>{row.dea_schedule ?? '—'}</td>
                <td style={deaCellStyle}>{row.lot_number ?? '—'}</td>
                <td style={deaCellStyle}>{formatDate(row.expiration_date)}</td>
                <td style={deaCellStyle}>{row.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const summaryCardStyle: CSSProperties = {
  padding: '1rem 1.2rem',
  borderRadius: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem'
};

const summaryTitleStyle: CSSProperties = {
  fontSize: '0.85rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
  margin: 0
};

const summaryMetricStyle: CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 700,
  color: '#0f172a',
  margin: 0
};

const summaryHintStyle: CSSProperties = {
  fontSize: '0.9rem',
  color: '#64748b'
};

const deaHeaderStyle: CSSProperties = {
  padding: '0.65rem 0.85rem',
  textAlign: 'left',
  color: '#475569',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  backgroundColor: '#f1f5f9'
};

const deaCellStyle: CSSProperties = {
  padding: '0.65rem 0.85rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
  backgroundColor: '#ffffff',
  color: '#0f172a'
};

function formatDate(value: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

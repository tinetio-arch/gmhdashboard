'use client';

import { useState, useEffect, useCallback } from 'react';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface AuditRow {
  patient_id: string;
  full_name: string;
  healthie_client_id: string | null;
  status_key: string;
  payment_method_key: string | null;
  clinic: string;
  regimen: string | null;
  has_testosterone_dispense: boolean;
  has_recurring_payment: boolean;
  recurring_amount: string | null;
  next_payment_date: string | null;
  has_card_on_file: boolean;
  card_info: string | null;
}

type PaymentFilter = 'all' | 'healthie' | 'jane' | 'quickbooks' | 'pro_bono' | 'none';
type PackageFilter = 'all' | 'has_package' | 'no_package';

export default function FinanceAuditTable() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [packageFilter, setPackageFilter] = useState<PackageFilter>('all');
  const [clinicFilter, setClinicFilter] = useState('all');
  const [trtOnly, setTrtOnly] = useState(false);

  const fetchData = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh
        ? `${basePath}/api/finance-audit?refresh=true`
        : `${basePath}/api/finance-audit`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.data || []);
      setCached(!!json.cached);
      setFetchedAt(json.fetched_at || json.cached_at || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived data
  const clinics = Array.from(new Set(rows.map(r => r.clinic).filter(Boolean))).sort();

  const filtered = rows.filter(r => {
    if (search && !r.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (paymentFilter !== 'all') {
      if (paymentFilter === 'none') {
        if (r.payment_method_key) return false;
      } else if (r.payment_method_key !== paymentFilter) {
        return false;
      }
    }
    if (packageFilter === 'has_package' && !r.has_recurring_payment) return false;
    if (packageFilter === 'no_package' && r.has_recurring_payment) return false;
    if (clinicFilter !== 'all' && r.clinic !== clinicFilter) return false;
    if (trtOnly && !r.has_testosterone_dispense) return false;
    return true;
  });

  // Summary counts
  const totalHealthie = rows.filter(r => r.payment_method_key === 'healthie').length;
  const totalJane = rows.filter(r => r.payment_method_key === 'jane').length;
  const totalQB = rows.filter(r => r.payment_method_key === 'quickbooks').length;
  const totalProBono = rows.filter(r => r.payment_method_key === 'pro_bono').length;
  const totalNoPayment = rows.filter(r => !r.payment_method_key).length;
  const healthieNoPackage = rows.filter(r => r.payment_method_key === 'healthie' && !r.has_recurring_payment).length;
  const noCardCount = rows.filter(r => !r.has_card_on_file).length;

  function getRowStyle(row: AuditRow): React.CSSProperties {
    // Red: Healthie payment but no package
    if (row.payment_method_key === 'healthie' && !row.has_recurring_payment) {
      return { backgroundColor: '#fef2f2' };
    }
    // Yellow: no card on file (any payment type)
    if (!row.has_card_on_file && row.payment_method_key === 'healthie') {
      return { backgroundColor: '#fffbeb' };
    }
    // Hold status
    if (row.status_key === 'hold_payment_research') {
      return { backgroundColor: '#fef3c7' };
    }
    return {};
  }

  function formatPaymentType(key: string | null): string {
    if (!key) return '—';
    const labels: Record<string, string> = {
      healthie: 'Healthie',
      jane: 'Jane',
      quickbooks: 'QuickBooks',
      pro_bono: 'Pro Bono',
      jane_quickbooks: 'Jane+QB',
    };
    return labels[key] || key;
  }

  function formatStatus(key: string): string {
    const labels: Record<string, string> = {
      active: 'Active',
      active_pending: 'Active (Pending)',
      hold_payment_research: 'Hold - Payment Research',
    };
    return labels[key] || key;
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
        Loading finance audit data from Healthie... This may take 30-60 seconds on first load.
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: '#dc2626', background: '#fef2f2', borderRadius: '0.5rem' }}>
        Error: {error}
        <button onClick={() => fetchData()} style={{ marginLeft: '1rem', padding: '0.25rem 0.75rem', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <SummaryCard label="Total Active" value={rows.length} />
        <SummaryCard label="Healthie" value={totalHealthie} />
        <SummaryCard label="Jane" value={totalJane} />
        <SummaryCard label="QuickBooks" value={totalQB} />
        <SummaryCard label="Pro Bono" value={totalProBono} />
        <SummaryCard label="No Payment Type" value={totalNoPayment} color={totalNoPayment > 0 ? '#dc2626' : undefined} />
        <SummaryCard label="Healthie No Package" value={healthieNoPackage} color={healthieNoPackage > 0 ? '#dc2626' : undefined} />
        <SummaryCard label="No Card (Healthie)" value={noCardCount} color={noCardCount > 0 ? '#b45309' : undefined} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            minWidth: '200px',
          }}
        />

        <select
          value={paymentFilter}
          onChange={e => setPaymentFilter(e.target.value as PaymentFilter)}
          style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        >
          <option value="all">All Payment Types</option>
          <option value="healthie">Healthie</option>
          <option value="jane">Jane</option>
          <option value="quickbooks">QuickBooks</option>
          <option value="pro_bono">Pro Bono</option>
          <option value="none">No Payment Type</option>
        </select>

        <select
          value={packageFilter}
          onChange={e => setPackageFilter(e.target.value as PackageFilter)}
          style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        >
          <option value="all">All Package Status</option>
          <option value="has_package">Has Package</option>
          <option value="no_package">No Package</option>
        </select>

        <select
          value={clinicFilter}
          onChange={e => setClinicFilter(e.target.value)}
          style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        >
          <option value="all">All Clinics</option>
          {clinics.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.875rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={trtOnly} onChange={e => setTrtOnly(e.target.checked)} />
          TRT Dispense Only
        </label>

        <button
          onClick={() => fetchData(true)}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Refresh from Healthie
        </button>

        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {cached ? 'Cached' : 'Fresh'} — {fetchedAt ? new Date(fetchedAt).toLocaleString() : ''}
        </span>
      </div>

      {/* Results count */}
      <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
        Showing {filtered.length} of {rows.length} patients
      </p>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Payment Type</Th>
              <Th>Clinic</Th>
              <Th>Has Package</Th>
              <Th>Amount</Th>
              <Th>Next Payment</Th>
              <Th>Card on File</Th>
              <Th>TRT Dispense</Th>
              <Th>Regimen</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.patient_id} style={{ borderBottom: '1px solid #e2e8f0', ...getRowStyle(row) }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{row.full_name}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <StatusBadge status={row.status_key} label={formatStatus(row.status_key)} />
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{formatPaymentType(row.payment_method_key)}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{row.clinic || '—'}</td>
                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  {row.has_recurring_payment ? (
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>Yes</span>
                  ) : (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>No</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  {row.recurring_amount ? `$${row.recurring_amount}` : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{row.next_payment_date || '—'}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  {row.has_card_on_file ? (
                    <span style={{ color: '#16a34a' }}>{row.card_info}</span>
                  ) : (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>No Card</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  {row.has_testosterone_dispense ? 'Yes' : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.regimen || '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No patients match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <article style={{
      padding: '1rem 1.25rem',
      borderRadius: '0.75rem',
      minWidth: '140px',
      background: '#ffffff',
      border: '1px solid rgba(148,163,184,0.22)',
      boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
    }}>
      <h3 style={{ margin: '0 0 0.3rem', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </h3>
      <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: color || '#0f172a' }}>
        {value}
      </p>
    </article>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: '0.6rem 0.75rem',
      textAlign: 'left',
      fontWeight: 600,
      color: '#475569',
      fontSize: '0.75rem',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    active: { bg: '#dcfce7', text: '#166534' },
    active_pending: { bg: '#dbeafe', text: '#1e40af' },
    hold_payment_research: { bg: '#fef3c7', text: '#92400e' },
  };
  const c = colors[status] || { bg: '#f1f5f9', text: '#475569' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.5rem',
      borderRadius: '9999px',
      fontSize: '0.7rem',
      fontWeight: 600,
      background: c.bg,
      color: c.text,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

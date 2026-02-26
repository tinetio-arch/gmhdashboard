'use client';
import { formatDateUTC, formatDateTimeUTC } from '@/lib/dateUtils';

import { Fragment, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { DispenseHistoryEvent, ProviderSignatureRow, ProviderSignatureSummary } from '@/lib/inventoryQueries';
import type { UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem'
};

const cardStyle: CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '0.85rem',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  padding: '1.4rem',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)'
};

const tableWrapperStyle: CSSProperties = {
  overflowX: 'auto'
};

const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 960,
  borderCollapse: 'separate',
  borderSpacing: 0
};

const headerCellStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: '0.75rem',
  color: '#475569',
  backgroundColor: '#f1f5f9',
  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
  position: 'sticky',
  top: 0,
  zIndex: 1
};

const rowCellStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  verticalAlign: 'top'
};

const linkButtonStyle: CSSProperties = {
  color: '#0369a1',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  fontWeight: 600
};

const actionButtonStyle: CSSProperties = {
  padding: '0.55rem 1rem',
  borderRadius: '0.6rem',
  fontWeight: 600,
  border: '1px solid rgba(59, 130, 246, 0.35)',
  background: 'rgba(59, 130, 246, 0.12)',
  color: '#1d4ed8',
  cursor: 'pointer'
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.25rem 0.6rem',
  borderRadius: '999px',
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.05em'
};

const statusPalette: Record<string, { bg: string; color: string }> = {
  awaiting_signature: { bg: 'rgba(250, 204, 21, 0.18)', color: '#854d0e' },
  signed: { bg: 'rgba(74, 222, 128, 0.18)', color: '#166534' },
  default: { bg: 'rgba(148, 163, 184, 0.16)', color: '#334155' }
};

const modalOverlay: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50
};

const modalCard: CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '1rem',
  maxWidth: 640,
  width: '90%',
  boxShadow: '0 24px 54px rgba(15, 23, 42, 0.18)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  padding: '1.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem'
};

const ATTESTATION_TEXT = `I attest that I have reviewed the dispense details shown and authorize the release of the medication as recorded. I understand that my electronic signature is legally binding and that this confirmation will be stored in the DEA compliance log.`;

type Props = {
  queue: ProviderSignatureRow[];
  summary: ProviderSignatureSummary;
  currentUserRole: UserRole;
  currentUserCanSign: boolean;
};

export default function ProviderSignatureClient({
  queue,
  summary,
  currentUserRole,
  currentUserCanSign
}: Props) {
  const router = useRouter();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [historyCache, setHistoryCache] = useState<Record<string, DispenseHistoryEvent[]>>({});
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [signModalRow, setSignModalRow] = useState<ProviderSignatureRow | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  const isAdmin = currentUserRole === 'admin';
  const canSign = isAdmin || currentUserCanSign;

  function formatVolume(value: string | null): string {
    if (value === null || value === undefined) {
      return '—';
    }
    const numeric = Number.parseFloat(value);
    if (Number.isNaN(numeric)) {
      return value;
    }
    return `${numeric.toFixed(2)} mL`;
  }

  async function refresh() {
    setAlert(null);
    router.refresh();
  }

  async function loadHistory(dispenseId: string) {
    if (historyCache[dispenseId]) {
      setExpandedHistoryId((prev) => (prev === dispenseId ? null : dispenseId));
      return;
    }
    try {
      setHistoryLoadingId(dispenseId);
      const response = await fetch(withBasePath(`/api/dispenses/${dispenseId}/history`));
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      let payload;
      if (contentType && contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        // If not JSON, read as text to see what we got
        const text = await response.text();
        console.error('[Frontend] Non-JSON response:', text.substring(0, 200));
        throw new Error(`Server returned an error. Please try again or contact support if the problem persists.`);
      }
      
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to load history.');
      }
      setHistoryCache((prev) => ({ ...prev, [dispenseId]: payload.history ?? [] }));
      setExpandedHistoryId(dispenseId);
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function handleConfirmSignature(note: string) {
    if (!signModalRow) return;
    const dispenseId = signModalRow.dispense_id;
    setSigningId(dispenseId);
    setAlert(null);
    try {
      const response = await fetch(withBasePath(`/api/dispenses/${dispenseId}/sign`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null })
      });
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      let payload;
      if (contentType && contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        // If not JSON, read as text to see what we got
        const text = await response.text();
        console.error('[Frontend] Non-JSON response:', text.substring(0, 200));
        throw new Error(`Server returned an error. Please try again or contact support if the problem persists.`);
      }
      
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to sign this dispense.');
      }
      setAlert({ type: 'success', message: 'Dispense signed and archived.' });
      setSignModalRow(null);
      await refresh();
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setSigningId(null);
    }
  }

  function renderStatusBadge(statusRaw: string | null) {
    const key = (statusRaw ?? 'awaiting_signature').toLowerCase();
    const palette = statusPalette[key] ?? statusPalette.default;
    return (
      <span style={{ ...badgeStyle, backgroundColor: palette.bg, color: palette.color }}>
        {key.replace('_', ' ')}
      </span>
    );
  }

  return (
    <div style={containerStyle}>
      <section style={cardStyle}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#0f172a' }}>Provider Attestation Queue</h1>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
              Review and sign testosterone dispenses. Your signature is stored alongside the DEA ledger.
            </p>
          </div>
      </header>
        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '1.4rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', padding: '1rem', borderRadius: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid rgba(148, 163, 184, 0.2)' }}>
            <span style={{ fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', fontWeight: 600 }}>
              Pending Signatures
            </span>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0f172a' }}>{summary.pending_count}</div>
          </div>
          <div style={{ flex: '1 1 220px', padding: '1rem', borderRadius: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid rgba(148, 163, 184, 0.2)' }}>
            <span style={{ fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', fontWeight: 600 }}>
              Last Signature
            </span>
            <div style={{ fontSize: '1rem', color: '#0f172a', marginTop: '0.25rem' }}>
              {summary.most_recent_signed_at ? formatDateTimeUTC(summary.most_recent_signed_at) : '—'}
            </div>
          </div>
        </div>
        {alert && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              borderRadius: '0.6rem',
              backgroundColor: alert.type === 'success' ? 'rgba(74, 222, 128, 0.18)' : 'rgba(248, 113, 113, 0.18)',
              border: alert.type === 'success' ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(248, 113, 113, 0.4)',
              color: alert.type === 'success' ? '#047857' : '#b91c1c',
              fontWeight: 600
            }}
          >
            {alert.message}
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, overflow: 'hidden' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#0f172a' }}>Attestation Required</h2>
          <span style={{ color: '#64748b' }}>{queue.length} dispenses awaiting signature</span>
        </header>
        <div style={tableWrapperStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {[
                  'Dispense Date',
                  'Patient',
                  'Total (mL)',
                  'Notes',
                  'Recorded By',
                  'Status',
                  'History',
                  canSign ? 'Actions' : null
                ]
                  .filter(Boolean)
                  .map((header) => (
                    <th key={String(header)} style={headerCellStyle}>
                      {header}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={canSign ? 8 : 7} style={{ ...rowCellStyle, textAlign: 'center', padding: '2rem' }}>
                    All caught up! Nothing requires signature.
                  </td>
                </tr>
              ) : (
                queue.map((row) => {
                  const statusBadge = renderStatusBadge(row.signature_status);
                  return (
                    <Fragment key={row.dispense_id}>
                      <tr>
                        <td style={rowCellStyle}>{row.dispense_date ? formatDateUTC(row.dispense_date) : '—'}</td>
                        <td style={rowCellStyle}>
                          <div style={{ fontWeight: 600 }}>{row.patient_name ?? '—'}</div>
                          <div style={{ color: '#475569', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                            Vial {row.vial_external_id ?? '—'} · {row.transaction_type ?? 'Dispense'}
                          </div>
                        </td>
                        <td style={rowCellStyle}>{formatVolume(row.total_amount ?? null)}</td>
                        <td style={rowCellStyle}>{row.notes ?? '—'}</td>
                        <td style={rowCellStyle}>
                          <div style={{ fontWeight: 600 }}>{row.created_by_name ?? '—'}</div>
                          <div style={{ color: '#475569', fontSize: '0.85rem' }}>{row.created_by_role ?? '—'}</div>
                        </td>
                        <td style={rowCellStyle}>{statusBadge}</td>
                        <td style={rowCellStyle}>
                          <button
                            type="button"
                            onClick={() => loadHistory(row.dispense_id)}
                            style={linkButtonStyle}
                            disabled={historyLoadingId === row.dispense_id}
                          >
                            {expandedHistoryId === row.dispense_id ? 'Hide history' : historyLoadingId === row.dispense_id ? 'Loading…' : 'View history'}
                          </button>
                        </td>
                        {canSign && (
                          <td style={{ ...rowCellStyle, display: 'flex', gap: '0.6rem' }}>
                            <button
                              type="button"
                              onClick={() => setSignModalRow(row)}
                              style={{ ...actionButtonStyle, opacity: signingId === row.dispense_id ? 0.6 : 1 }}
                              disabled={signingId === row.dispense_id}
                            >
                              {signingId === row.dispense_id ? 'Signing…' : 'Review & Sign'}
                            </button>
                          </td>
                        )}
                      </tr>
                      {expandedHistoryId === row.dispense_id && (
                        <tr>
                          <td colSpan={canSign ? 8 : 7} style={{ ...rowCellStyle, backgroundColor: '#f8fafc' }}>
                            <HistoryTimeline events={historyCache[row.dispense_id] ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {signModalRow && (
        <SignModal
          row={signModalRow}
          onClose={() => setSignModalRow(null)}
          onConfirm={handleConfirmSignature}
          signing={signingId === signModalRow.dispense_id}
        />
      )}
    </div>
  );
}

function HistoryTimeline({ events }: { events: DispenseHistoryEvent[] }) {
  if (!events.length) {
    return <div style={{ color: '#64748b' }}>No recorded events yet.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {events.map((event) => (
        <li key={event.event_id} style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ minWidth: 160, fontWeight: 600, color: '#475569' }}>
            {formatDateTimeUTC(event.created_at)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>{event.event_type.replace('_', ' ')}</div>
            <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.25rem' }}>
              {event.actor_display_name ?? 'System'} {event.actor_role ? `(${event.actor_role})` : ''}
            </div>
            {event.event_payload && (
              <pre
                style={{
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  padding: '0.65rem',
                  borderRadius: '0.6rem',
                  marginTop: '0.5rem',
                  fontSize: '0.8rem',
                  overflowX: 'auto'
                }}
              >
                {JSON.stringify(event.event_payload, null, 2)}
              </pre>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SignModal({
  row,
  onClose,
  onConfirm,
  signing
}: {
  row: ProviderSignatureRow;
  onClose: () => void;
  onConfirm: (note: string) => void;
  signing: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <div style={modalOverlay}>
      <div style={modalCard}>
        <header>
          <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Review & Sign Dispense</h3>
          <p style={{ marginTop: '0.35rem', color: '#64748b' }}>
            Patient <strong>{row.patient_name ?? '—'}</strong> · Vial {row.vial_external_id ?? '—'}
          </p>
        </header>
        <div style={{ padding: '0.75rem', borderRadius: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid rgba(148, 163, 184, 0.18)' }}>
          <p style={{ margin: 0, color: '#0f172a', lineHeight: 1.5 }}>{ATTESTATION_TEXT}</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: '#475569' }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
            Optional note to log with signature
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            style={{
              padding: '0.65rem 0.75rem',
              borderRadius: '0.65rem',
              border: '1px solid rgba(148, 163, 184, 0.32)',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              resize: 'vertical'
            }}
            placeholder="Add any clarifying detail for audit trail (optional)."
          />
        </label>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button type="button" onClick={onClose} style={{ ...actionButtonStyle, background: 'rgba(148, 163, 184, 0.18)', border: '1px solid rgba(148, 163, 184, 0.18)', color: '#475569' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note)}
            style={{ ...actionButtonStyle, background: '#2563eb', color: '#ffffff', border: '1px solid #2563eb' }}
            disabled={signing}
          >
            {signing ? 'Capturing signature…' : 'Sign & Archive'}
          </button>
        </footer>
      </div>
    </div>
  );
}

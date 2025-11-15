'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { AuditRecord, AuditSummary } from '@/lib/auditQueries';
import { withBasePath } from '@/lib/basePath';

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem'
};

const cardStyle: CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '0.9rem',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  padding: '1.5rem',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)'
};

type Props = {
  history: AuditRecord[];
  summary: AuditSummary;
};

export default function AuditClient({ history, summary }: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState<string>('');

  const weeksOutstanding = summary.weeks_since;
  const overdue = weeksOutstanding >= 1;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');
    try {
      const response = await fetch(withBasePath('/api/audits'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to record audit.');
      }
      setStatus('success');
      setMessage('Weekly audit logged.');
      setNotes('');
      router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage((error as Error).message);
    }
  }

  return (
    <div style={containerStyle}>
      <section style={cardStyle}>
        <header>
          <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#0f172a' }}>Weekly Inventory Audit</h1>
          <p style={{ margin: '0.4rem 0 0', color: '#64748b' }}>
            Document your controlled substance inventory review. The most recent audit anchors DEA and state compliance tracking.
          </p>
        </header>
        <div
          style={{
            marginTop: '1.25rem',
            padding: '0.8rem 1rem',
            borderRadius: '0.75rem',
            backgroundColor: overdue ? 'rgba(248, 113, 113, 0.16)' : 'rgba(59, 130, 246, 0.12)',
            border: overdue ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid rgba(59, 130, 246, 0.25)',
            color: overdue ? '#b91c1c' : '#1d4ed8',
            fontWeight: 600
          }}
        >
          {summary.last_audit_week
            ? `Last audit: week of ${new Date(summary.last_audit_week).toLocaleDateString()} · ${overdue ? `${weeksOutstanding} week(s) overdue` : 'On schedule'}`
            : 'No audits logged yet. Please complete one now.'}
        </div>
        <form onSubmit={handleSubmit} style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', color: '#475569' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Notes (inventory counts, discrepancies, follow-up tasks)
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              style={{
                padding: '0.8rem 0.9rem',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                backgroundColor: '#ffffff',
                color: '#0f172a'
              }}
              placeholder="Document vial counts by formulation, discrepancies, and corrective actions."
            />
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              style={{
                padding: '0.6rem 1.1rem',
                borderRadius: '0.65rem',
                border: '1px solid #2563eb',
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Log This Week'}
            </button>
          </div>
          {status !== 'idle' && message && (
            <div
              style={{
                padding: '0.7rem 0.9rem',
                borderRadius: '0.6rem',
                backgroundColor: status === 'error' ? 'rgba(248, 113, 113, 0.16)' : 'rgba(74, 222, 128, 0.18)',
                border: status === 'error' ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid rgba(52, 211, 153, 0.35)',
                color: status === 'error' ? '#b91c1c' : '#047857',
                fontWeight: 600
              }}
            >
              {message}
            </div>
          )}
        </form>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Audit Log</h2>
        <p style={{ margin: '0.35rem 0 1.2rem', color: '#64748b' }}>
          Completed reviews are retained for DEA audits. Each entry captures who performed the audit, when it was logged, and supporting notes.
        </p>
        {history.length === 0 ? (
          <div style={{ color: '#64748b' }}>No audits recorded yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {history.map((audit) => (
              <li
                key={audit.audit_id}
                style={{
                  padding: '1rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  backgroundColor: '#f8fafc'
                }}
              >
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  Week of {new Date(audit.audit_week).toLocaleDateString()}
                </div>
                <div style={{ color: '#475569', marginTop: '0.25rem' }}>
                  Logged {new Date(audit.created_at).toLocaleString()} · {audit.performed_by_name ?? '—'}
                </div>
                {audit.audit_notes && (
                  <p style={{ marginTop: '0.6rem', color: '#0f172a', whiteSpace: 'pre-wrap' }}>{audit.audit_notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


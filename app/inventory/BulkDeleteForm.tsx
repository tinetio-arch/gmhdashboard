'use client';

import { useState } from 'react';
import { withBasePath } from '@/lib/basePath';

type Props = {
  onCompleted?: () => void;
};

type Status =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

export default function BulkDeleteForm({ onCompleted }: Props) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = value
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setStatus({ type: 'error', message: 'Provide at least one vial ID.' });
      return;
    }

    if (!window.confirm(`Delete ${ids.length} vial(s) and related logs? This cannot be undone.`)) {
      return;
    }

    setStatus({ type: 'loading' });
    try {
      const response = await fetch(withBasePath('/api/inventory/vials/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vialIds: ids })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Bulk delete failed.');
      }

      const failed = Array.isArray(payload?.results)
        ? payload.results.filter((entry: { success: boolean }) => !entry.success)
        : [];
      if (failed.length) {
        setStatus({
          type: 'error',
          message: `${failed.length} of ${ids.length} vial(s) could not be deleted.`
        });
      } else {
        setStatus({ type: 'success', message: `Deleted ${ids.length} vial(s) successfully.` });
        setValue('');
        onCompleted?.();
      }
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  return (
    <section
      style={{
        backgroundColor: '#fff7ed',
        border: '1px solid rgba(251, 146, 60, 0.4)',
        borderRadius: '0.85rem',
        padding: '1.5rem',
        boxShadow: '0 16px 36px rgba(249, 115, 22, 0.18)'
      }}
    >
      <header style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#9a3412' }}>Bulk Delete Vials</h3>
        <p style={{ margin: '0.35rem 0 0', color: '#9a3412', fontSize: '0.95rem' }}>
          Administrator-only action. Removes vials, associated dispenses, and DEA log entries. This cannot be undone.
        </p>
      </header>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: '#9a3412', fontWeight: 600 }}>
          Vial IDs (one per line or separated by commas)
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={{
              minHeight: '120px',
              padding: '0.75rem 1rem',
              borderRadius: '0.65rem',
              border: '1px solid rgba(249, 115, 22, 0.4)',
              backgroundColor: '#fff',
              fontSize: '0.95rem',
              color: '#7c2d12'
            }}
            placeholder="V0001&#10;V0002&#10;V0003"
            required
          />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={status.type === 'loading'}
            style={{
              padding: '0.65rem 1.4rem',
              borderRadius: '0.6rem',
              border: 'none',
              background: status.type === 'loading' ? 'rgba(248, 113, 113, 0.45)' : '#dc2626',
              color: '#fff',
              fontWeight: 700,
              cursor: status.type === 'loading' ? 'wait' : 'pointer'
            }}
          >
            {status.type === 'loading' ? 'Deleting…' : 'Delete Vials'}
          </button>
        </div>
      </form>
      {status.type === 'error' && (
        <p style={{ marginTop: '0.75rem', color: '#b91c1c', fontWeight: 600 }}>{status.message}</p>
      )}
      {status.type === 'success' && (
        <p style={{ marginTop: '0.75rem', color: '#047857', fontWeight: 600 }}>{status.message}</p>
      )}
    </section>
  );
}


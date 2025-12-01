'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import { withBasePath } from '@/lib/basePath';

type ActionState =
  | { status: 'idle'; message: '' }
  | { status: 'pending'; message: 'Reprocessing ClinicSync memberships…' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

function parseLimit(value: string): number | undefined {
  const parsed = Number(value.replace(/\D+/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export default function ClinicSyncAdminActions() {
  const [limitInput, setLimitInput] = useState('');
  const [skipWithoutPatient, setSkipWithoutPatient] = useState(true);
  const [actionState, setActionState] = useState<ActionState>({ status: 'idle', message: '' });
  const [isPending, startTransition] = useTransition();

  const hasCustomLimit = useMemo(() => limitInput.trim().length > 0, [limitInput]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setActionState({ status: 'pending', message: 'Reprocessing ClinicSync memberships…' });
      try {
        const limit = parseLimit(limitInput);
        const payload: Record<string, unknown> = {
          syncJanePaymentPatients: true,
          skipWithoutPatient,
        };

        if (limit !== undefined) {
          payload.limit = limit;
        }

        const response = await fetch(withBasePath('/api/admin/clinicsync/reprocess'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody?.details || 'Request failed');
        }

        const data = (await response.json()) as {
          processed: number;
          skipped: number;
          limit?: number;
        };

        setActionState({
          status: 'success',
          message: `Processed ${data.processed} patients${data.skipped ? `, skipped ${data.skipped}` : ''}.`,
        });
      } catch (error) {
        setActionState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unexpected error',
        });
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'grid',
        gap: '0.75rem',
        color: '#0f172a',
      }}
    >
      <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
        <strong>Jane Membership Sync</strong>
        <div style={{ marginTop: '0.25rem' }}>
          Reprocess ClinicSync memberships for every patient whose payment method is set to Jane. This will re-run the
          membership logic, update balances, and resolve linked payment issues automatically.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
          Optional limit (leave blank to process everyone)
        </label>
        <input
          value={limitInput}
          onChange={(event) => setLimitInput(event.target.value.replace(/[^\d]/g, ''))}
          placeholder="e.g. 50"
          inputMode="numeric"
          pattern="[0-9]*"
          style={{
            padding: '0.65rem',
            borderRadius: '0.5rem',
            border: '1px solid #cbd5f5',
            fontSize: '0.85rem',
          }}
          autoComplete="off"
        />
        {hasCustomLimit && (
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Will reprocess the most recently updated memberships first.
          </div>
        )}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8rem',
          color: '#334155',
        }}
      >
        <input
          type="checkbox"
          checked={skipWithoutPatient}
          onChange={(event) => setSkipWithoutPatient(event.target.checked)}
        />
        Skip ClinicSync records that are not mapped to a patient
      </label>

      <button
        type="submit"
        disabled={isPending}
        style={{
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: 'none',
          background: '#0ea5e9',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: '0.9rem',
          cursor: isPending ? 'wait' : 'pointer',
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? 'Reprocessing…' : 'Reprocess Jane Membership Patients'}
      </button>

      {actionState.status !== 'idle' && (
        <div
          style={{
            fontSize: '0.8rem',
            color:
              actionState.status === 'success'
                ? '#047857'
                : actionState.status === 'error'
                ? '#b91c1c'
                : '#0f172a',
            fontWeight: actionState.status === 'pending' ? 600 : 500,
          }}
        >
          {actionState.message}
        </div>
      )}
    </form>
  );
}



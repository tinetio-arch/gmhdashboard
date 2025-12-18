'use client';

import { useState } from 'react';
import { withBasePath } from '@/lib/basePath';

export default function GHLAdminActions() {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSyncAll() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAll: true }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync patients to GHL');
      }

      setMessage({
        type: 'success',
        text: data.message || 'Sync started successfully. This may take a few minutes.',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to sync patients to GHL',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncPending() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncPending: true }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync pending patients to GHL');
      }

      setMessage({
        type: 'success',
        text: data.message || 'Sync started successfully. This may take a few minutes.',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to sync pending patients to GHL',
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
        Manual Sync Actions
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleSyncPending}
          disabled={syncing}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            border: '1px solid #3b82f6',
            background: syncing ? '#94a3b8' : '#3b82f6',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: syncing ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {syncing ? 'Syncing...' : 'Sync Pending Patients'}
        </button>
        <button
          type="button"
          onClick={handleSyncAll}
          disabled={syncing}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            border: '1px solid #10b981',
            background: syncing ? '#94a3b8' : '#10b981',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: syncing ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {syncing ? 'Syncing...' : 'Sync All Patients'}
        </button>
      </div>
      {message && (
        <div
          style={{
            padding: '0.75rem',
            borderRadius: '0.5rem',
            backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${message.type === 'success' ? '#10b981' : '#ef4444'}`,
            color: message.type === 'success' ? '#059669' : '#dc2626',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}






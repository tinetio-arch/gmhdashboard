'use client';

import { useEffect, useState } from 'react';
import { withBasePath } from '@/lib/basePath';

type GHLSyncStatus = {
  ghlContactId: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  syncError: string | null;
  tags: string[];
  ghlLocationId?: string;
};

type GHLSyncHistoryEntry = {
  syncId: string;
  syncType: string;
  ghlContactId: string | null;
  syncPayload: any;
  syncResult: any;
  errorMessage: string | null;
  createdAt: string;
  createdBy: string | null;
};

type GHLSyncData = {
  syncStatus: GHLSyncStatus;
  history: GHLSyncHistoryEntry[];
};

type Props = {
  patientId: string;
};

export default function GHLSyncStatus({ patientId }: Props) {
  const [data, setData] = useState<GHLSyncData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSyncData() {
      try {
        const response = await fetch(withBasePath(`/api/patients/${patientId}/ghl-sync`));
        if (!response.ok) {
          throw new Error('Failed to fetch GHL sync data');
        }
        const result = await response.json();
        if (result.success) {
          setData(result);
        } else {
          setError(result.error || 'Unknown error');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchSyncData();
  }, [patientId]);

  if (loading) {
    return (
      <div
        style={{
          borderRadius: '0.9rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>
          GoHighLevel Sync Status
        </h2>
        <p style={{ marginTop: '0.5rem', color: '#64748b' }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          borderRadius: '0.9rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>
          GoHighLevel Sync Status
        </h2>
        <p style={{ marginTop: '0.5rem', color: '#dc2626' }}>Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { syncStatus, history } = data;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'synced':
        return { bg: '#d1fae5', text: '#065f46', border: '#10b981' };
      case 'syncing':
        return { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' };
      case 'error':
        return { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' };
      case 'pending':
        return { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' };
      default:
        return { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' };
    }
  };

  const statusColors = getStatusColor(syncStatus.syncStatus);

  // Get GHL profile URL (if we have contact ID and location ID)
  // Format: https://app.gohighlevel.com/v2/location/{locationId}/contacts/detail/{contactId}
  const ghlLocationId = syncStatus.ghlLocationId || '';
  const ghlProfileUrl = syncStatus.ghlContactId && ghlLocationId
    ? `https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${syncStatus.ghlContactId}`
    : null;

  return (
    <div
      style={{
        borderRadius: '0.9rem',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        backgroundColor: '#ffffff',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>
          GoHighLevel Sync Status
        </h2>
        {ghlProfileUrl && (
          <a
            href={ghlProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              borderRadius: '0.5rem',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            View in GHL →
          </a>
        )}
      </div>

      {/* Sync Status Overview */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            borderRadius: '0.75rem',
            border: `1px solid ${statusColors.border}`,
            padding: '1rem',
            backgroundColor: statusColors.bg,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Sync Status
          </p>
          <p
            style={{
              margin: '0.35rem 0 0',
              fontSize: '1.35rem',
              fontWeight: 600,
              color: statusColors.text,
              textTransform: 'capitalize',
            }}
          >
            {syncStatus.syncStatus}
          </p>
        </div>

        <div
          style={{
            borderRadius: '0.75rem',
            border: '1px solid rgba(148,163,184,0.2)',
            padding: '1rem',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Last Synced
          </p>
          <p
            style={{
              margin: '0.35rem 0 0',
              fontSize: '1.35rem',
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            {syncStatus.lastSyncedAt
              ? new Date(syncStatus.lastSyncedAt).toLocaleString()
              : 'Never'}
          </p>
        </div>

        <div
          style={{
            borderRadius: '0.75rem',
            border: '1px solid rgba(148,163,184,0.2)',
            padding: '1rem',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            GHL Contact ID
          </p>
          <p
            style={{
              margin: '0.35rem 0 0',
              fontSize: '1rem',
              fontWeight: 600,
              color: '#0f172a',
              fontFamily: 'monospace',
            }}
          >
            {syncStatus.ghlContactId || 'Not linked'}
          </p>
        </div>

        <div
          style={{
            borderRadius: '0.75rem',
            border: '1px solid rgba(148,163,184,0.2)',
            padding: '1rem',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Tags ({syncStatus.tags.length})
          </p>
          <div
            style={{
              margin: '0.35rem 0 0',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            {syncStatus.tags.length > 0 ? (
              syncStatus.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#e0e7ff',
                    color: '#4338ca',
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {tag}
                </span>
              ))
            ) : (
              <span style={{ color: '#64748b', fontSize: '0.875rem' }}>No tags</span>
            )}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {syncStatus.syncError && (
        <div
          style={{
            borderRadius: '0.5rem',
            border: '1px solid #fca5a5',
            backgroundColor: '#fee2e2',
            padding: '1rem',
          }}
        >
          <p style={{ margin: 0, color: '#991b1b', fontWeight: 600 }}>Sync Error:</p>
          <p style={{ margin: '0.5rem 0 0', color: '#991b1b' }}>{syncStatus.syncError}</p>
        </div>
      )}

      {/* Sync History */}
      {history.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#0f172a' }}>
            Sync History
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'separate',
                borderSpacing: 0,
                minWidth: 800,
              }}
            >
              <thead>
                <tr>
                  {['Date', 'Type', 'Status', 'Contact ID', 'Details'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '0.65rem 0.9rem',
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        borderBottom: '1px solid rgba(148,163,184,0.3)',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const isSuccess = !entry.errorMessage && entry.syncResult?.success !== false;
                  return (
                    <tr key={entry.syncId}>
                      <td
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderBottom: '1px solid rgba(148,163,184,0.15)',
                        }}
                      >
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderBottom: '1px solid rgba(148,163,184,0.15)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {entry.syncType}
                      </td>
                      <td
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderBottom: '1px solid rgba(148,163,184,0.15)',
                        }}
                      >
                        <span
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            backgroundColor: isSuccess ? '#d1fae5' : '#fee2e2',
                            color: isSuccess ? '#065f46' : '#991b1b',
                          }}
                        >
                          {isSuccess ? 'Success' : 'Error'}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderBottom: '1px solid rgba(148,163,184,0.15)',
                          fontFamily: 'monospace',
                          fontSize: '0.875rem',
                        }}
                      >
                        {entry.ghlContactId || '—'}
                      </td>
                      <td
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderBottom: '1px solid rgba(148,163,184,0.15)',
                          maxWidth: 300,
                        }}
                      >
                        {entry.errorMessage ? (
                          <span style={{ color: '#dc2626', fontSize: '0.875rem' }}>
                            {entry.errorMessage}
                          </span>
                        ) : entry.syncPayload?.tags ? (
                          <span style={{ color: '#475569', fontSize: '0.875rem' }}>
                            Tags: {Array.isArray(entry.syncPayload.tags) 
                              ? entry.syncPayload.tags.join(', ')
                              : 'N/A'}
                          </span>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '0.875rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history.length === 0 && (
        <p style={{ margin: 0, color: '#64748b' }}>No sync history available.</p>
      )}
    </div>
  );
}


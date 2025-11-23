'use client';

import { useState } from 'react';
import { withBasePath } from '@/lib/basePath';
import type { GHLSyncStatus } from '@/lib/patientGHLSync';

type Props = {
  patientId: string;
  syncStatus: GHLSyncStatus | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  ghlContactId: string | null;
  onSync?: () => void;
};

export default function GHLSyncBadge({ 
  patientId, 
  syncStatus, 
  lastSyncedAt, 
  syncError,
  ghlContactId,
  onSync 
}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [localStatus, setLocalStatus] = useState(syncStatus);
  const [localError, setLocalError] = useState(syncError);

  const getStatusColor = () => {
    switch (localStatus) {
      case 'synced':
        return '#22c55e'; // green
      case 'syncing':
        return '#3b82f6'; // blue
      case 'error':
        return '#ef4444'; // red
      case 'pending':
      default:
        return '#9ca3af'; // gray
    }
  };

  const getStatusText = () => {
    switch (localStatus) {
      case 'synced':
        return 'Synced';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Error';
      case 'pending':
      default:
        return 'Not synced';
    }
  };

  const getTooltipText = () => {
    if (localStatus === 'synced' && lastSyncedAt) {
      const syncDate = new Date(lastSyncedAt);
      return `Last synced: ${syncDate.toLocaleString()}`;
    }
    if (localStatus === 'error' && localError) {
      return `Error: ${localError}`;
    }
    if (localStatus === 'syncing') {
      return 'Syncing to GoHighLevel...';
    }
    return 'Click to sync to GoHighLevel';
  };

  const handleSync = async () => {
    if (isLoading || localStatus === 'syncing') return;
    
    setIsLoading(true);
    setLocalStatus('syncing');
    setLocalError(null);

    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId })
      });

      const data = await response.json();
      
      if (data.success) {
        setLocalStatus('synced');
        if (onSync) onSync();
      } else {
        setLocalStatus('error');
        setLocalError(data.error || 'Sync failed');
      }
    } catch (error) {
      setLocalStatus('error');
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleSync}
        disabled={isLoading}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer hover:opacity-80 disabled:opacity-50"
        style={{ 
          backgroundColor: `${getStatusColor()}20`,
          color: getStatusColor(),
          border: `1px solid ${getStatusColor()}40`
        }}
        title={getTooltipText()}
      >
        {localStatus === 'syncing' ? (
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
            <circle 
              className="opacity-25" 
              cx="12" 
              cy="12" 
              r="10" 
              stroke="currentColor" 
              strokeWidth="4"
              fill="none"
            />
            <path 
              className="opacity-75" 
              fill="currentColor" 
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
            />
          </svg>
        )}
        <span>{getStatusText()}</span>
      </button>
      
      {ghlContactId && localStatus === 'synced' && (
        <a
          href={`https://app.gohighlevel.com/contacts/${ghlContactId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800"
          title="View in GoHighLevel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" 
            />
          </svg>
        </a>
      )}
    </div>
  );
}

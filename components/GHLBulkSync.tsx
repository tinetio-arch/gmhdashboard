'use client';

import { useState } from 'react';
import { withBasePath } from '@/lib/basePath';

type Props = {
  onSyncComplete?: () => void;
};

export default function GHLBulkSync({ onSyncComplete }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const handleSyncAll = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setSyncResults(null);

    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAll: true })
      });

      const data = await response.json();
      
      if (data.success) {
        setSyncResults(data.results);
        if (onSyncComplete) onSyncComplete();
      } else {
        setSyncResults({
          total: 0,
          succeeded: 0,
          failed: 1,
          errors: [data.error || 'Sync failed']
        });
      }
    } catch (error) {
      setSyncResults({
        total: 0,
        succeeded: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">GoHighLevel Sync</h3>
          <p className="text-sm text-gray-600 mt-1">
            Sync patient data with GoHighLevel CRM. This will update contact information and apply tags based on patient status and memberships.
          </p>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
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
              <span>Syncing...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                />
              </svg>
              <span>Sync All Patients</span>
            </>
          )}
        </button>
      </div>

      {syncResults && (
        <div className={`mt-4 p-4 rounded-md ${
          syncResults.failed > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'
        }`}>
          <h4 className="font-medium mb-2">Sync Results:</h4>
          <div className="grid grid-cols-3 gap-4 mb-2">
            <div>
              <span className="text-sm text-gray-600">Total:</span>
              <span className="ml-2 font-semibold">{syncResults.total}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Succeeded:</span>
              <span className="ml-2 font-semibold text-green-600">{syncResults.succeeded}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Failed:</span>
              <span className="ml-2 font-semibold text-red-600">{syncResults.failed}</span>
            </div>
          </div>
          
          {syncResults.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-red-600 hover:text-red-800">
                View errors ({syncResults.errors.length})
              </summary>
              <div className="mt-2 max-h-32 overflow-y-auto">
                {syncResults.errors.map((error, idx) => (
                  <div key={idx} className="text-xs text-red-600 py-1">
                    {error}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        <p>Automatic sync runs hourly. Tags applied include:</p>
        <ul className="mt-1 ml-4 list-disc">
          <li>Patient status (Active, Inactive, Hold, etc.)</li>
          <li>Membership type (Men's Health Service, PrimeCare, etc.)</li>
          <li>Special conditions (Labs Overdue, Has Balance, Verified)</li>
        </ul>
      </div>
    </div>
  );
}

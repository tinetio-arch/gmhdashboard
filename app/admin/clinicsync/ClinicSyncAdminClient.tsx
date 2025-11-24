'use client';

import { useState, useEffect } from 'react';
import { CLINICSYNC_CONFIG } from '@/lib/clinicsyncConfig';

export default function ClinicSyncAdminClient() {
  const [config, setConfig] = useState(CLINICSYNC_CONFIG);
  const [testResult, setTestResult] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSync, setIsLoadingSync] = useState(false);

  const testWebhook = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/ops/api/integrations/clinicsync/webhook', {
        method: 'GET',
      });
      const result = await response.json();
      setTestResult(result);
    } catch (error) {
      setTestResult({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSyncStatus = async () => {
    setIsLoadingSync(true);
    try {
      const response = await fetch('/ops/api/admin/clinicsync/sync-status', {
        method: 'GET',
      });
      const result = await response.json();
      setSyncStatus(result.data);
    } catch (error) {
      setSyncStatus({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsLoadingSync(false);
    }
  };

  // Auto-refresh sync status every 30 seconds
  useEffect(() => {
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} hours ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <div className="space-y-8">
      {/* Sync Status Dashboard */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Sync Status & Activity</h2>
          <button
            onClick={fetchSyncStatus}
            disabled={isLoadingSync}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoadingSync ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {syncStatus && !syncStatus.error ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Current Status */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Current Status</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    syncStatus.summary?.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {syncStatus.current?.sync_status || 'Unknown'}
                  </span>
                  <span className="text-sm text-gray-600">
                    Last sync: {formatLastSync(syncStatus.current?.last_webhook_received)}
                  </span>
                </div>
                
                <div className="text-sm text-gray-600">
                  <div>Today's webhooks: <span className="font-medium">{syncStatus.current?.total_webhooks_received || 0}</span></div>
                  <div>Processed: <span className="font-medium text-green-600">{syncStatus.current?.patients_processed || 0}</span></div>
                  <div>Skipped: <span className="font-medium text-gray-500">{syncStatus.current?.patients_skipped || 0}</span></div>
                  <div>Matched: <span className="font-medium text-blue-600">{syncStatus.current?.patients_matched || 0}</span></div>
                </div>
              </div>
            </div>

            {/* Weekly Summary */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Weekly Summary</h3>
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  <div>Total webhooks: <span className="font-medium">{syncStatus.weekly?.total_webhooks || 0}</span></div>
                  <div>Total processed: <span className="font-medium text-green-600">{syncStatus.weekly?.total_processed || 0}</span></div>
                  <div>Total skipped: <span className="font-medium text-gray-500">{syncStatus.weekly?.total_skipped || 0}</span></div>
                  <div>Processing rate: <span className="font-medium">{syncStatus.weekly?.average_processing_rate || 0}%</span></div>
                  <div>Active days: <span className="font-medium">{syncStatus.weekly?.days_with_activity || 0}/7</span></div>
                </div>
              </div>
            </div>

            {/* Filtering Effectiveness */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Filtering Impact</h3>
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  <div>Filtering effectiveness: <span className="font-medium text-orange-600">{syncStatus.summary?.filtering_effectiveness || 0}%</span></div>
                  <div className="text-xs text-gray-500 mt-1">
                    Percentage of patients skipped due to no membership data
                  </div>
                </div>
                
                {syncStatus.summary?.filtering_effectiveness > 50 && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="text-sm text-green-700">
                      ✅ Filtering is working well! Reducing server load by {syncStatus.summary.filtering_effectiveness}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : syncStatus?.error ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="text-sm text-red-700">Error loading sync status: {syncStatus.error}</div>
          </div>
        ) : (
          <div className="text-center py-4 text-gray-500">Loading sync status...</div>
        )}
      </div>
      {/* Current Configuration Display */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Current Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Webhook Filtering</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Filter Non-Membership Patients:</span>
                <span className={`font-medium ${config.webhook.filterNonMembershipPatients ? 'text-green-600' : 'text-red-600'}`}>
                  {config.webhook.filterNonMembershipPatients ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Filter by Pass Types:</span>
                <span className={`font-medium ${config.webhook.filterByPassTypes ? 'text-green-600' : 'text-red-600'}`}>
                  {config.webhook.filterByPassTypes ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Process Outstanding Balances:</span>
                <span className={`font-medium ${config.webhook.processOutstandingBalances ? 'text-green-600' : 'text-red-600'}`}>
                  {config.webhook.processOutstandingBalances ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Minimum Balance Threshold:</span>
                <span className="font-medium text-gray-900">
                  ${config.webhook.minimumBalanceThreshold.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Logging Settings</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Log Skipped Patients:</span>
                <span className={`font-medium ${config.logging.logSkippedPatients ? 'text-green-600' : 'text-red-600'}`}>
                  {config.logging.logSkippedPatients ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Log Successful Processing:</span>
                <span className={`font-medium ${config.logging.logSuccessfulProcessing ? 'text-green-600' : 'text-red-600'}`}>
                  {config.logging.logSuccessfulProcessing ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Relevant Pass IDs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Relevant Pass IDs</h2>
        <p className="text-gray-600 mb-4">
          These pass IDs indicate membership/package relationships that will be processed:
        </p>
        <div className="flex flex-wrap gap-2">
          {config.webhook.relevantPassIds.map((passId) => (
            <span
              key={passId}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
            >
              Pass ID: {passId}
            </span>
          ))}
        </div>
      </div>

      {/* Membership Keywords */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Membership Keywords</h2>
        <p className="text-gray-600 mb-4">
          Pass names containing these keywords will be processed:
        </p>
        <div className="flex flex-wrap gap-2">
          {config.webhook.membershipKeywords.map((keyword) => (
            <span
              key={keyword}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>

      {/* Webhook Test */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Webhook Status</h2>
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={testWebhook}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Testing...' : 'Test Webhook'}
          </button>
          <span className="text-sm text-gray-600">
            Webhook URL: <code className="bg-gray-100 px-2 py-1 rounded text-xs">
              /ops/api/integrations/clinicsync/webhook
            </code>
          </span>
        </div>

        {testResult && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Test Result:</h3>
            <pre className="text-xs text-gray-700 overflow-x-auto">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Impact Summary */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-yellow-800 mb-4">Impact Summary</h2>
        <div className="text-yellow-700 space-y-2">
          <p>
            <strong>✅ Benefits of filtering:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Reduces server load by skipping patients without membership data</li>
            <li>Eliminates noisy log messages about patients with no membership data</li>
            <li>Focuses processing on patients that actually need membership tracking</li>
            <li>Improves webhook response times</li>
          </ul>
          
          <p className="mt-4">
            <strong>⚠️ Considerations:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Patients without current memberships but with outstanding balances will still be processed</li>
            <li>Manual syncs bypass filtering to ensure complete data coverage</li>
            <li>Configuration can be adjusted by modifying <code>/lib/clinicsyncConfig.ts</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

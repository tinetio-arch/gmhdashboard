'use client';

import { useState, useEffect } from 'react';
import { withBasePath } from '@/lib/basePath';

type SyncStatus = {
  patient_id: string;
  patient_name: string;
  email: string | null;
  phone_primary: string | null;
  ghl_contact_id: string | null;
  ghl_sync_status: string | null;
  ghl_last_synced_at: string | null;
  ghl_sync_error: string | null;
  sync_freshness: string;
};

type TagMapping = {
  mapping_id: string;
  condition_type: string;
  condition_value: string;
  ghl_tag_name: string;
  is_active: boolean;
};

type SyncHistoryEntry = {
  sync_id: string;
  patient_name?: string;
  sync_type: string;
  ghl_contact_id?: string;
  error_message?: string;
  created_at: string;
};

export default function GHLManagementClient() {
  const [activeTab, setActiveTab] = useState<'overview' | 'sync' | 'tags' | 'history'>('overview');
  const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
  const [tagMappings, setTagMappings] = useState<TagMapping[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<any>(null);
  const [stats, setStats] = useState({
    total: 0,
    synced: 0,
    pending: 0,
    errors: 0,
    stale: 0
  });

  // Load initial data
  useEffect(() => {
    loadSyncStatuses();
    loadTagMappings();
    loadSyncHistory();
  }, []);

  const loadSyncStatuses = async () => {
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/status'));
      if (response.ok) {
        const data = await response.json();
        setSyncStatuses(data.statuses || []);
        setStats(data.stats || stats);
      }
    } catch (error) {
      console.error('Failed to load sync statuses:', error);
    }
  };

  const loadTagMappings = async () => {
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/tags'));
      if (response.ok) {
        const data = await response.json();
        setTagMappings(data.mappings || []);
      }
    } catch (error) {
      console.error('Failed to load tag mappings:', error);
    }
  };

  const loadSyncHistory = async () => {
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/history'));
      if (response.ok) {
        const data = await response.json();
        setSyncHistory(data.history || []);
      }
    } catch (error) {
      console.error('Failed to load sync history:', error);
    }
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    setSyncResults(null);

    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAll: true })
      });

      const data = await response.json();
      setSyncResults(data.results);
      await loadSyncStatuses();
      await loadSyncHistory();
    } catch (error) {
      setSyncResults({
        total: 0,
        succeeded: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestSync = async () => {
    // Sync just the first pending patient as a test
    const testPatient = syncStatuses.find(s => s.ghl_sync_status === 'pending' || s.ghl_sync_status === 'error');
    if (!testPatient) {
      alert('No patients available for test sync');
      return;
    }

    setIsSyncing(true);
    try {
      const response = await fetch(withBasePath('/api/admin/ghl/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: testPatient.patient_id })
      });

      const data = await response.json();
      alert(data.success ? 'Test sync successful!' : `Test sync failed: ${data.error}`);
      await loadSyncStatuses();
    } catch (error) {
      alert(`Test sync failed: ${error}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">GoHighLevel Management Center</h1>
        <p className="text-gray-600">
          Manage and monitor your GoHighLevel integration. Link existing contacts, apply tags, and track sync status.
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Total Patients</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-green-50 rounded-lg shadow p-4 border border-green-200">
          <div className="text-sm text-green-700 mb-1">Synced</div>
          <div className="text-2xl font-bold text-green-700">{stats.synced}</div>
        </div>
        <div className="bg-yellow-50 rounded-lg shadow p-4 border border-yellow-200">
          <div className="text-sm text-yellow-700 mb-1">Stale</div>
          <div className="text-2xl font-bold text-yellow-700">{stats.stale}</div>
        </div>
        <div className="bg-gray-50 rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Pending</div>
          <div className="text-2xl font-bold text-gray-700">{stats.pending}</div>
        </div>
        <div className="bg-red-50 rounded-lg shadow p-4 border border-red-200">
          <div className="text-sm text-red-700 mb-1">Errors</div>
          <div className="text-2xl font-bold text-red-700">{stats.errors}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'sync', label: 'Sync Management' },
            { id: 'tags', label: 'Tag Configuration' },
            { id: 'history', label: 'Sync History' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="flex gap-4">
              <button
                onClick={handleTestSync}
                disabled={isSyncing}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 disabled:opacity-50 transition"
              >
                Test Sync (1 Patient)
              </button>
              <button
                onClick={handleSyncAll}
                disabled={isSyncing}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {isSyncing ? 'Syncing...' : 'Sync All Patients'}
              </button>
              <button
                onClick={loadSyncStatuses}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition"
              >
                Refresh Status
              </button>
            </div>
          </div>

          {/* Sync Results */}
          {syncResults && (
            <div className={`rounded-lg shadow p-6 ${
              syncResults.failed > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'
            }`}>
              <h3 className="text-lg font-semibold mb-4">Last Sync Results</h3>
              <div className="grid grid-cols-3 gap-4">
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
              {syncResults.errors && syncResults.errors.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-red-600 hover:text-red-800">
                    View errors ({syncResults.errors.length})
                  </summary>
                  <div className="mt-2 max-h-40 overflow-y-auto">
                    {syncResults.errors.map((error: string, idx: number) => (
                      <div key={idx} className="text-xs text-red-600 py-1">{error}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Information Cards */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-blue-50 rounded-lg shadow p-6 border border-blue-200">
              <h3 className="text-lg font-semibold mb-2 text-blue-900">How It Works</h3>
              <ul className="text-sm text-blue-800 space-y-2">
                <li>• Finds existing contacts in GHL by email or phone</li>
                <li>• Links contacts to patient records</li>
                <li>• Applies tags based on status and membership</li>
                <li>• Updates contact info automatically</li>
                <li>• Does NOT create new contacts</li>
              </ul>
            </div>

            <div className="bg-purple-50 rounded-lg shadow p-6 border border-purple-200">
              <h3 className="text-lg font-semibold mb-2 text-purple-900">Men's Health Tag</h3>
              <p className="text-sm text-purple-800 mb-2">
                These patient types automatically get the <strong>"existing"</strong> tag:
              </p>
              <ul className="text-xs text-purple-700 space-y-1">
                <li>• QBO TCMH $180/Month</li>
                <li>• QBO F&F/FR/Veteran $140/Month</li>
                <li>• Jane TCMH $180/Month</li>
                <li>• Jane F&F/FR/Veteran $140/Month</li>
                <li>• Approved Disc / Pro-Bono PT</li>
                <li>• Men's Health (QBO)</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sync' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Patient Sync Status</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Synced</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {syncStatuses.slice(0, 50).map((status) => (
                  <tr key={status.patient_id}>
                    <td className="px-4 py-3 text-sm">{status.patient_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{status.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{status.phone_primary || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        status.ghl_sync_status === 'synced' ? 'bg-green-100 text-green-800' :
                        status.ghl_sync_status === 'error' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {status.ghl_sync_status || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {status.ghl_last_synced_at ? new Date(status.ghl_last_synced_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 truncate max-w-xs" title={status.ghl_sync_error || ''}>
                      {status.ghl_sync_error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Tag Configuration</h3>
            <p className="text-sm text-gray-600 mt-1">
              Tags are automatically applied based on these conditions
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Condition</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">GHL Tag</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tagMappings.map((mapping) => (
                  <tr key={mapping.mapping_id}>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        {mapping.condition_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-700">{mapping.condition_value}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{mapping.ghl_tag_name}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        mapping.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {mapping.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Sync History</h3>
            <p className="text-sm text-gray-600 mt-1">
              Recent sync operations and their results
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">GHL Contact ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {syncHistory.slice(0, 100).map((entry) => (
                  <tr key={entry.sync_id}>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">{entry.patient_name || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        entry.sync_type === 'create' ? 'bg-green-100 text-green-800' :
                        entry.sync_type === 'update' ? 'bg-blue-100 text-blue-800' :
                        entry.sync_type === 'error' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {entry.sync_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">
                      {entry.ghl_contact_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 truncate max-w-xs" title={entry.error_message || ''}>
                      {entry.error_message || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


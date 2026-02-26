'use client';
import { formatDateUTC, formatDateTimeUTC } from '@/lib/dateUtils';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface RevenuePeriod {
  total: number;
  quickbooks: number;
  healthie: number;
}

interface RevenueMetrics {
  daily: RevenuePeriod;
  weekly: RevenuePeriod;
  monthly: RevenuePeriod;
  paymentIssues: number;
  unmatchedPatients: number;
  totalPatientsOnRecurring: number;
}

interface ClinicSyncMetrics {
  dailyRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  totalMemberships: number;
  activeMemberships: number;
  paymentIssues: number;
  unmatchedMemberships: number;
  mappedMemberships: number;
}

interface PatientMatch {
  patient: {
    patient_id: string;
    full_name: string;
    email: string;
    phone: string;
    payment_method_key: string;
  };
  qbCustomer: {
    Id: string;
    DisplayName: string;
    PrimaryEmailAddr?: { Address: string };
    PrimaryPhone?: { FreeFormNumber: string };
    Balance?: number;
  };
  matchReason: string;
  confidence: 'high' | 'medium' | 'low';
}

interface PaymentIssue {
  issue_id: string;
  patient_id: string;
  patient_name: string;
  issue_type: string;
  amount_owed: number;
  days_overdue: number;
  created_at: string;
}

export default function FinancialsAdminClient() {
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null);
  const [issues, setIssues] = useState<PaymentIssue[]>([]);
  const [patientMatches, setPatientMatches] = useState<{
    potentialMatches: PatientMatch[];
    unmappedQuickBooksPatients: any[];
    unmappedRecurringCustomers: any[];
    totalQbCustomers: number;
    totalDashboardPatients: number;
    totalMappings: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'matching'>('overview');
  const [clinicMetrics, setClinicMetrics] = useState<ClinicSyncMetrics | null>(null);
  const [resolvingIssue, setResolvingIssue] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    loadData();
    checkConnection();
    loadPatientMatches();
  }, []);

  const loadData = async () => {
    try {
      const [metricsResponse, issuesResponse, clinicResponse] = await Promise.all([
        fetch('/ops/api/admin/quickbooks/metrics'),
        fetch('/ops/api/admin/quickbooks/payment-issues'),
        fetch('/ops/api/admin/memberships/metrics')
      ]);

      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        setMetrics(metricsData);
      }

      if (issuesResponse.ok) {
        const issuesData = await issuesResponse.json();
        setIssues(issuesData);
      }

      if (clinicResponse.ok) {
        const clinicData = await clinicResponse.json();
        setClinicMetrics(clinicData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async () => {
    try {
      const response = await fetch('/ops/api/admin/quickbooks/connection-status');
      if (response.ok) {
        const { connected, error } = await response.json();
        setConnected(connected);
        setConnectionError(error);
      }
    } catch (error) {
      console.error('Error checking connection:', error);
      setConnectionError('Failed to check connection status');
    }
  };

  const connectQuickBooks = async () => {
    setConnecting(true);
    try {
      window.location.href = '/ops/api/auth/quickbooks';
    } catch (error) {
      console.error('Error connecting to QuickBooks:', error);
      setConnecting(false);
    }
  };

  const syncData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/ops/api/admin/quickbooks/sync', {
        method: 'POST'
      });

      if (response.ok) {
        await loadData();
        await loadPatientMatches();
      } else {
        console.error('Sync failed');
      }
    } catch (error) {
      console.error('Error syncing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPatientMatches = async () => {
    try {
      const response = await fetch('/ops/api/admin/quickbooks/patient-matching');
      if (response.ok) {
        const data = await response.json();
        setPatientMatches(data);
      }
    } catch (error) {
      console.error('Error loading patient matches:', error);
    }
  };

  const handleResolveIssue = async (issueId: string, patientId: string) => {
    if (!confirm('Are you sure you want to mark this payment issue as resolved?')) {
      return;
    }

    setResolvingIssue(issueId);
    try {
      const response = await fetch('/ops/api/admin/quickbooks/resolve-payment-issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ issueId, patientId }),
      });

      if (response.ok) {
        const result = await response.json();
        // Remove the resolved issue from the list
        setIssues(issues.filter(issue => issue.issue_id !== issueId));
        // Reload data to get updated metrics
        loadData();
        alert(result.message || 'Payment issue resolved successfully');
      } else {
        const error = await response.json();
        alert(`Failed to resolve payment issue: ${error.error}`);
      }
    } catch (error) {
      console.error('Error resolving payment issue:', error);
      alert('Failed to resolve payment issue');
    } finally {
      setResolvingIssue(null);
    }
  };

  const createMapping = async (patientId: string, qbCustomerId: string, matchMethod: string) => {
    try {
      const response = await fetch('/ops/api/admin/quickbooks/patient-matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, qbCustomerId, matchMethod })
      });

      if (response.ok) {
        await loadPatientMatches();
        await loadData();
      }
    } catch (error) {
      console.error('Error creating mapping:', error);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  if (loading && !metrics) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading QuickBooks Dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">QuickBooks Administration</h1>
        <div className="flex gap-4">
          <button
            onClick={connectQuickBooks}
            disabled={connecting}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {connecting ? 'Connecting...' : (connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks')}
          </button>
          {connected && (
            <>
              <button
                onClick={syncData}
                disabled={loading}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Syncing...' : 'Sync Data'}
              </button>
              <button
                onClick={() => router.push('/admin/membership-reconciliation')}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
              >
                Reconcile Memberships
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <nav className="flex space-x-4" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-2 font-medium text-sm rounded-md ${activeTab === 'overview'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('matching')}
            className={`px-3 py-2 font-medium text-sm rounded-md ${activeTab === 'matching'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Patient Matching
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' ? (
        <>
          {/* Connection Status */}
          <div className={`mb-6 p-4 rounded ${connected ? 'bg-green-100 border border-green-400' : 'bg-red-100 border border-red-400'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-2 ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="font-medium">
                  {connected ? 'Connected to QuickBooks' : 'Not Connected to QuickBooks'}
                </span>
              </div>
              {!connected && connectionError && (
                <span className="text-sm text-red-700 font-semibold bg-red-200 px-3 py-1 rounded">
                  Error: {connectionError}
                </span>
              )}
            </div>
          </div>

          {/* Revenue Metrics */}
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Daily Revenue</h3>
                <div className="text-3xl font-bold text-green-600 mb-2">
                  {formatCurrency(metrics.daily.total)}
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <div>QB: {formatCurrency(metrics.daily.quickbooks)}</div>
                  <div>Healthie: {formatCurrency(metrics.daily.healthie)}</div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Weekly Revenue</h3>
                <div className="text-3xl font-bold text-blue-600 mb-2">
                  {formatCurrency(metrics.weekly.total)}
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <div>QB: {formatCurrency(metrics.weekly.quickbooks)}</div>
                  <div>Healthie: {formatCurrency(metrics.weekly.healthie)}</div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Monthly Revenue</h3>
                <div className="text-3xl font-bold text-purple-600 mb-2">
                  {formatCurrency(metrics.monthly.total)}
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <div>QB: {formatCurrency(metrics.monthly.quickbooks)}</div>
                  <div>Healthie: {formatCurrency(metrics.monthly.healthie)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Patient Statistics */}
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Patients on Recurring</h3>
                <div className="text-3xl font-bold text-indigo-600">
                  {metrics.totalPatientsOnRecurring}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Payment Issues</h3>
                <div className="text-3xl font-bold text-red-600">
                  {metrics.paymentIssues}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Unmatched Patients</h3>
                <div className="text-3xl font-bold text-orange-600">
                  {metrics.unmatchedPatients}
                </div>
              </div>
            </div>
          )}

          {(patientMatches || clinicMetrics) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="bg-white p-4 rounded-lg shadow border">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className={`inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  QuickBooks Connected
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {(patientMatches?.totalMappings ?? metrics?.totalPatientsOnRecurring ?? 0).toLocaleString()} patients mapped
                </p>
              </div>
              {clinicMetrics && (
                <div className="bg-white p-4 rounded-lg shadow border">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                    ClinicSync Connected
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatNumber(clinicMetrics.mappedMemberships)} patients mapped
                  </p>
                </div>
              )}
            </div>
          )}

          {clinicMetrics && (
            <div className="mt-10">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-semibold">ClinicSync (Jane)</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Monitor Jane memberships and launch the auto-matching workflow for ClinicSync patients.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        setLoading(true);
                        const response = await fetch('/ops/api/admin/clinicsync/sync', {
                          method: 'POST'
                        });
                        if (response.ok) {
                          const result = await response.json();
                          alert(`ClinicSync sync completed: ${result.message}`);
                          loadData(); // Refresh metrics
                        } else {
                          const error = await response.json();
                          alert(`ClinicSync sync failed: ${error.error}`);
                        }
                      } catch (error) {
                        alert('Failed to sync ClinicSync data');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition disabled:opacity-50"
                    disabled={loading}
                  >
                    {loading ? 'Syncing...' : 'Sync Jane Data'}
                  </button>
                  <button
                    onClick={() => router.push('/admin/membership-audit')}
                    className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition"
                  >
                    Auto-Match ClinicSync Patients
                  </button>
                  <button
                    onClick={() => router.push('/admin/mapping-diagnostics')}
                    className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 transition"
                  >
                    Mapping Diagnostics
                  </button>
                  <button
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const response = await fetch('/ops/api/admin/update-mixed-payments', {
                          method: 'POST'
                        });
                        if (response.ok) {
                          const result = await response.json();
                          alert(`Mixed payment detection completed: ${result.message}`);
                          window.location.reload(); // Refresh to see updated data
                        } else {
                          const error = await response.json();
                          alert(`Mixed payment detection failed: ${error.error}`);
                        }
                      } catch (error) {
                        alert('Failed to detect mixed payments');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-50"
                    disabled={loading}
                  >
                    {loading ? 'Detecting...' : 'Detect Mixed Payments'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Daily Revenue</h3>
                  <div className="text-3xl font-bold text-green-600">
                    {formatCurrency(clinicMetrics.dailyRevenue)}
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Weekly Revenue</h3>
                  <div className="text-3xl font-bold text-blue-600">
                    {formatCurrency(clinicMetrics.weeklyRevenue)}
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Monthly Revenue</h3>
                  <div className="text-3xl font-bold text-purple-600">
                    {formatCurrency(clinicMetrics.monthlyRevenue)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Total Memberships</h3>
                  <div className="text-3xl font-bold text-indigo-600">{formatNumber(clinicMetrics.totalMemberships)}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Active Memberships</h3>
                  <div className="text-3xl font-bold text-green-600">{formatNumber(clinicMetrics.activeMemberships)}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Payment Issues</h3>
                  <div className="text-3xl font-bold text-red-600">{formatNumber(clinicMetrics.paymentIssues)}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border">
                  <h3 className="text-lg font-semibold mb-2">Unmatched Patients</h3>
                  <div className="text-3xl font-bold text-orange-600">{formatNumber(clinicMetrics.unmatchedMemberships)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Payment Issues Table */}
          <div className="bg-white rounded-lg shadow border">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Payment Issues Requiring Attention</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Patient
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Issue Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount Owed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Days Overdue
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {issues.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                        No payment issues found
                      </td>
                    </tr>
                  ) : (
                    issues.map((issue) => (
                      <tr key={issue.issue_id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{issue.patient_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${issue.issue_type === 'failed_payment' ? 'bg-red-100 text-red-800' :
                              issue.issue_type === 'overdue_invoice' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                            }`}>
                            {issue.issue_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-red-600 font-medium">
                          {formatCurrency(issue.amount_owed)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {issue.days_overdue} days
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDateUTC(issue.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => router.push(`/patients/${issue.patient_id}`)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                          >
                            View Patient
                          </button>
                          <button
                            className="text-green-600 hover:text-green-900 disabled:opacity-50"
                            onClick={() => handleResolveIssue(issue.issue_id, issue.patient_id)}
                            disabled={resolvingIssue === issue.issue_id}
                          >
                            {resolvingIssue === issue.issue_id ? 'Resolving...' : 'Mark Resolved'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        // Patient Matching Tab
        <div className="space-y-6">
          {/* Matching Stats */}
          {patientMatches && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Total Mappings</h3>
                <div className="text-3xl font-bold text-blue-600">
                  {patientMatches.totalMappings}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Potential Matches</h3>
                <div className="text-3xl font-bold text-green-600">
                  {patientMatches.potentialMatches.length}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-semibold mb-2">Unmapped QB Patients</h3>
                <div className="text-3xl font-bold text-orange-600">
                  {patientMatches.unmappedQuickBooksPatients.length}
                </div>
              </div>
            </div>
          )}

          {/* Potential Matches */}
          {patientMatches && patientMatches.potentialMatches.length > 0 && (
            <div className="bg-white rounded-lg shadow border">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">Suggested Patient Matches</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Review and confirm these automatic matches between dashboard patients and QuickBooks customers.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Patient
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        QB Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Match Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Confidence
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {patientMatches.potentialMatches.map((match, index) => (
                      <tr key={index}>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{match.patient.full_name}</div>
                          <div className="text-sm text-gray-500">{match.patient.email}</div>
                          <div className="text-sm text-gray-500">{match.patient.phone}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{match.qbCustomer.DisplayName}</div>
                          <div className="text-sm text-gray-500">{match.qbCustomer.PrimaryEmailAddr?.Address}</div>
                          <div className="text-sm text-gray-500">{match.qbCustomer.PrimaryPhone?.FreeFormNumber}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {match.matchReason}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${match.confidence === 'high' ? 'bg-green-100 text-green-800' :
                              match.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                            }`}>
                            {match.confidence}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <button
                            onClick={() => createMapping(match.patient.patient_id, match.qbCustomer.Id, 'auto_' + match.confidence)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                          >
                            Confirm Match
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unmapped Patients */}
          {patientMatches && patientMatches.unmappedQuickBooksPatients.length > 0 && (
            <div className="bg-white rounded-lg shadow border">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">Patients Marked for QuickBooks (No Mapping)</h2>
                <p className="text-sm text-gray-600 mt-1">
                  These patients have QuickBooks payment method but aren't linked to a QBO customer yet.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Patient Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Phone
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {patientMatches.unmappedQuickBooksPatients.map((patient) => (
                      <tr key={patient.patient_id}>
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                          {patient.full_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {patient.email || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {patient.phone || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

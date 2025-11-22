'use client';

import { useState } from 'react';
import Link from 'next/link';
import { withBasePath } from '@/lib/basePath';

type QuickBooksRecurringPatient = {
  qbCustomerId: string;
  customerName: string;
  recurringTemplate: string | null;
  amount: number;
  nextChargeDate: string | null;
  isActive: boolean;
  matchedPatientId: string | null;
  matchedPatientName: string | null;
};

type MissingFromSheet = {
  qbCustomerId: string;
  customerName: string;
  recurringTemplate: string | null;
  amount: number;
  nextChargeDate: string | null;
  reason: 'not_in_sheet' | 'no_jane_membership' | 'payment_method_mismatch';
};

type ReconciliationData = {
  quickbooksConnected: boolean;
  totalRecurringInQB: number;
  totalInPatientSheet: number;
  missingFromSheet: MissingFromSheet[];
  recurringPatients: QuickBooksRecurringPatient[];
};

type Props = {
  data: ReconciliationData;
};

const REASON_LABELS = {
  not_in_sheet: 'Not in Patient Sheet',
  no_jane_membership: 'No Jane Membership Found',
  payment_method_mismatch: 'Payment Method Mismatch'
};

const REASON_COLORS = {
  not_in_sheet: 'bg-red-100 text-red-800',
  no_jane_membership: 'bg-yellow-100 text-yellow-800',
  payment_method_mismatch: 'bg-orange-100 text-orange-800'
};

export default function MembershipReconciliationClient({ data }: Props) {
  const [filter, setFilter] = useState<'all' | 'missing' | 'matched'>('missing');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPatients = data.recurringPatients.filter(patient => {
    // Apply filter
    if (filter === 'missing' && patient.matchedPatientId) return false;
    if (filter === 'matched' && !patient.matchedPatientId) return false;

    // Apply search
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return patient.customerName.toLowerCase().includes(search);
    }

    return true;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };

  if (!data.quickbooksConnected) {
    return (
      <div className="p-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-yellow-900 mb-2">QuickBooks Not Connected</h3>
          <p className="text-yellow-700">
            Please connect QuickBooks to view recurring membership data.
          </p>
          <Link 
            href={withBasePath('/admin/quickbooks')}
            className="inline-block mt-4 bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
          >
            Go to QuickBooks Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Membership Reconciliation</h1>
        <p className="text-gray-600">
          Compare QuickBooks recurring memberships with your patient sheet
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            QuickBooks Recurring
          </h3>
          <p className="mt-2 text-3xl font-bold text-indigo-600">
            {data.totalRecurringInQB}
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Active Patients
          </h3>
          <p className="mt-2 text-3xl font-bold text-green-600">
            {data.totalInPatientSheet}
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Missing from Sheet
          </h3>
          <p className="mt-2 text-3xl font-bold text-red-600">
            {data.missingFromSheet.filter(m => m.reason === 'not_in_sheet').length}
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Data Issues
          </h3>
          <p className="mt-2 text-3xl font-bold text-orange-600">
            {data.missingFromSheet.filter(m => m.reason !== 'not_in_sheet').length}
          </p>
        </div>
      </div>

      {/* Missing Patients Alert */}
      {data.missingFromSheet.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold text-red-900 mb-4">
            Attention Required: {data.missingFromSheet.length} Recurring Patients Need Review
          </h3>
          
          <div className="space-y-3">
            {data.missingFromSheet.map((patient) => (
              <div key={patient.qbCustomerId} className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900">{patient.customerName}</h4>
                    <p className="text-sm text-gray-600">
                      {formatCurrency(patient.amount)} - Next charge: {formatDate(patient.nextChargeDate)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${REASON_COLORS[patient.reason]}`}>
                    {REASON_LABELS[patient.reason]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow border border-gray-200 mb-6">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  filter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({data.recurringPatients.length})
              </button>
              <button
                onClick={() => setFilter('missing')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  filter === 'missing'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Missing ({data.recurringPatients.filter(p => !p.matchedPatientId).length})
              </button>
              <button
                onClick={() => setFilter('matched')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  filter === 'matched'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Matched ({data.recurringPatients.filter(p => p.matchedPatientId).length})
              </button>
            </div>
            
            <input
              type="text"
              placeholder="Search by customer name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  QuickBooks Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recurring Plan
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Charge
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient Sheet Match
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPatients.map((patient) => (
                <tr key={patient.qbCustomerId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {patient.customerName}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {patient.recurringTemplate || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {formatCurrency(patient.amount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(patient.nextChargeDate)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {patient.matchedPatientId ? (
                      <Link
                        href={withBasePath(`/patients/${patient.matchedPatientId}`)}
                        className="text-indigo-600 hover:text-indigo-900 font-medium"
                      >
                        {patient.matchedPatientName}
                      </Link>
                    ) : (
                      <span className="text-red-600 font-medium">Not Found</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {!patient.matchedPatientId && (
                      <button
                        onClick={() => {
                          // TODO: Implement intake form
                          alert('Intake form coming soon');
                        }}
                        className="text-indigo-600 hover:text-indigo-900 font-medium"
                      >
                        Add to Sheet
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredPatients.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No patients found matching your criteria
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

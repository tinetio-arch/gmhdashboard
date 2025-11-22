'use client';

import React, { useState, useEffect } from 'react';
import { withBasePath } from '@/lib/basePath';

interface DiagnosticResult {
  clinicsync_patient_id: string;
  full_name: string;
  membership_plan: string | null;
  missing_fields: string[];
  potential_matches: {
    by_email?: { patient_id: string; full_name: string; confidence: number };
    by_phone?: { patient_id: string; full_name: string; confidence: number };
    by_name_dob?: { patient_id: string; full_name: string; confidence: number };
    by_name_only?: { patient_id: string; full_name: string; confidence: number };
  };
  match_failure_reasons: string[];
  recommendations: string[];
}

interface DiagnosticsSummary {
  total_unmapped: number;
  missing_email: number;
  missing_phone: number;
  missing_dob: number;
  has_potential_matches: number;
  no_matches_found: number;
}

export default function MappingDiagnosticsClient() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'missing_data' | 'potential_matches' | 'no_matches'>('all');

  useEffect(() => {
    loadDiagnostics();
  }, []);

  async function loadDiagnostics() {
    try {
      const response = await fetch(withBasePath('/api/admin/clinicsync/mapping-diagnostics'));
      if (response.ok) {
        const data = await response.json();
        setSummary(data.summary);
        setDiagnostics(data.diagnostics);
      }
    } catch (error) {
      console.error('Failed to load diagnostics:', error);
    } finally {
      setLoading(false);
    }
  }

  function toggleRow(id: string) {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  }

  function getFilteredDiagnostics() {
    switch (filter) {
      case 'missing_data':
        return diagnostics.filter(d => d.missing_fields.length > 0);
      case 'potential_matches':
        return diagnostics.filter(d => Object.keys(d.potential_matches).length > 0);
      case 'no_matches':
        return diagnostics.filter(d => Object.keys(d.potential_matches).length === 0);
      default:
        return diagnostics;
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">Loading diagnostics...</div>
      </div>
    );
  }

  const filteredDiagnostics = getFilteredDiagnostics();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Patient Mapping Diagnostics</h1>
        <p className="mt-2 text-gray-600">Analyze why ClinicSync patients aren't automatically mapping</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-sm text-gray-600">Total Unmapped</div>
            <div className="text-2xl font-bold">{summary.total_unmapped}</div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg shadow border border-red-200">
            <div className="text-sm text-red-600">Missing Email</div>
            <div className="text-2xl font-bold text-red-700">{summary.missing_email}</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg shadow border border-orange-200">
            <div className="text-sm text-orange-600">Missing Phone</div>
            <div className="text-2xl font-bold text-orange-700">{summary.missing_phone}</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg shadow border border-yellow-200">
            <div className="text-sm text-yellow-600">Missing DOB</div>
            <div className="text-2xl font-bold text-yellow-700">{summary.missing_dob}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg shadow border border-green-200">
            <div className="text-sm text-green-600">Has Matches</div>
            <div className="text-2xl font-bold text-green-700">{summary.has_potential_matches}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600">No Matches</div>
            <div className="text-2xl font-bold text-gray-700">{summary.no_matches_found}</div>
          </div>
        </div>
      )}

      {/* Filter Buttons */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          All ({diagnostics.length})
        </button>
        <button
          onClick={() => setFilter('missing_data')}
          className={`px-4 py-2 rounded ${filter === 'missing_data' ? 'bg-red-600 text-white' : 'bg-gray-200'}`}
        >
          Missing Data
        </button>
        <button
          onClick={() => setFilter('potential_matches')}
          className={`px-4 py-2 rounded ${filter === 'potential_matches' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}
        >
          Has Matches
        </button>
        <button
          onClick={() => setFilter('no_matches')}
          className={`px-4 py-2 rounded ${filter === 'no_matches' ? 'bg-gray-600 text-white' : 'bg-gray-200'}`}
        >
          No Matches
        </button>
      </div>

      {/* Diagnostics Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Patient
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Missing Fields
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Potential Matches
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredDiagnostics.map((diag) => {
              const isExpanded = expandedRows.has(diag.clinicsync_patient_id);
              const hasPotentialMatches = Object.keys(diag.potential_matches).length > 0;
              
              return (
                <React.Fragment key={diag.clinicsync_patient_id}>
                  <tr className={hasPotentialMatches ? 'bg-green-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{diag.full_name}</div>
                        <div className="text-sm text-gray-500">{diag.membership_plan}</div>
                        <div className="text-xs text-gray-400">ID: {diag.clinicsync_patient_id}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {diag.missing_fields.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {diag.missing_fields.map((field) => (
                            <span key={field} className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                              {field}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-green-600">All fields present</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {hasPotentialMatches ? (
                        <div className="text-sm">
                          <span className="text-green-600 font-medium">
                            {Object.keys(diag.potential_matches).length} match(es) found
                          </span>
                          <div className="text-xs text-gray-500 mt-1">
                            {Object.entries(diag.potential_matches).map(([method, match]) => (
                              <div key={method}>
                                {method.replace('by_', '').replace('_', ' ')}: {match.confidence * 100}%
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">No matches</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        {hasPotentialMatches ? (
                          <span className="text-green-600">Ready to link</span>
                        ) : diag.missing_fields.length > 0 ? (
                          <span className="text-red-600">Needs data</span>
                        ) : (
                          <span className="text-gray-600">No match found</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => toggleRow(diag.clinicsync_patient_id)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        {isExpanded ? 'Hide Details' : 'Show Details'}
                      </button>
                    </td>
                  </tr>
                  
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50">
                        <div className="space-y-4">
                          {/* Match Failure Reasons */}
                          {diag.match_failure_reasons.length > 0 && (
                            <div>
                              <h4 className="font-medium text-sm mb-2">Why matching failed:</h4>
                              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                {diag.match_failure_reasons.map((reason, idx) => (
                                  <li key={idx}>{reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {/* Potential Matches Details */}
                          {hasPotentialMatches && (
                            <div>
                              <h4 className="font-medium text-sm mb-2">Potential matches:</h4>
                              <div className="space-y-2">
                                {Object.entries(diag.potential_matches).map(([method, match]) => (
                                  <div key={method} className="bg-white p-3 rounded border">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <div className="font-medium text-sm">{match.full_name}</div>
                                        <div className="text-xs text-gray-500">
                                          Matched by: {method.replace('by_', '').replace('_', ' ')}
                                        </div>
                                        <div className="text-xs text-gray-400">
                                          Patient ID: {match.patient_id}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-medium text-green-600">
                                          {match.confidence * 100}% confidence
                                        </div>
                                        <button className="mt-1 text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
                                          Link Patient
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Recommendations */}
                          {diag.recommendations.length > 0 && (
                            <div>
                              <h4 className="font-medium text-sm mb-2">Recommendations:</h4>
                              <ul className="list-disc list-inside text-sm text-blue-600 space-y-1">
                                {diag.recommendations.map((rec, idx) => (
                                  <li key={idx}>{rec}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

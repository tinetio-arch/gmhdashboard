'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PatientHubProps {
  patientStatusBreakdown: any[];
  holdReasonBreakdown: any[];
  paymentMethodBreakdown: any[];
  labStatusBreakdown: any[];
  recentActivity: any[];
  patientsNeedingAttention: any[];
  searchParams: {
    status?: string;
    search?: string;
    hold_type?: string;
    payment_method?: string;
    lab_status?: string;
  };
}

function withBasePath(path: string): string {
  return path;
}

export default function PatientHubClient({
  patientStatusBreakdown,
  holdReasonBreakdown,
  paymentMethodBreakdown,
  labStatusBreakdown,
  recentActivity,
  patientsNeedingAttention,
  searchParams
}: PatientHubProps) {
  const [activeView, setActiveView] = useState<'analytics' | 'attention' | 'filters' | 'bulk-actions'>('analytics');
  const [selectedPatients, setSelectedPatients] = useState<string[]>([]);

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const getStatusColor = (status: string) => {
    if (status?.includes('hold')) return '#ea580c';
    if (status === 'active') return '#059669';
    if (status === 'inactive') return '#64748b';
    return '#0369a1';
  };

  const getStatusBackground = (status: string) => {
    if (status?.includes('hold')) return '#fef3c7';
    if (status === 'active') return '#ecfdf5';
    if (status === 'inactive') return '#f8fafc';
    return '#e0f2fe';
  };

  const getPriorityColor = (reason: string) => {
    switch (reason) {
      case 'critical_hold': return '#dc2626';
      case 'overdue_labs': return '#ea580c';
      case 'labs_due_soon': return '#f59e0b';
      case 'payment_issues': return '#7c3aed';
      default: return '#0369a1';
    }
  };

  const getPriorityLabel = (reason: string) => {
    switch (reason) {
      case 'critical_hold': return '🚨 Critical Hold';
      case 'overdue_labs': return '🧪 Overdue Labs';
      case 'labs_due_soon': return '⏰ Labs Due Soon';
      case 'payment_issues': return '💳 Payment Issues';
      default: return '📋 Needs Attention';
    }
  };

  return (
    <div>
      {/* Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '0.5rem', 
        marginBottom: '2rem',
        borderBottom: '2px solid #e2e8f0',
        paddingBottom: '1rem'
      }}>
        {[
          { key: 'analytics', label: '📊 Patient Analytics', count: patientStatusBreakdown.length },
          { key: 'attention', label: '🎯 Need Attention', count: patientsNeedingAttention.length },
          { key: 'filters', label: '🔍 Advanced Filters', count: 0 },
          { key: 'bulk-actions', label: '⚡ Bulk Actions', count: selectedPatients.length }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key as any)}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: activeView === tab.key 
                ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' 
                : '#ffffff',
              color: activeView === tab.key ? '#ffffff' : '#64748b',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: activeView === tab.key 
                ? '0 4px 12px rgba(5, 150, 105, 0.3)' 
                : '0 2px 4px rgba(0, 0, 0, 0.1)'
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                padding: '0.2rem 0.5rem',
                borderRadius: '999px',
                backgroundColor: activeView === tab.key ? 'rgba(255, 255, 255, 0.2)' : '#ef4444',
                color: '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 700
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Analytics View */}
      {activeView === 'analytics' && (
        <div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
            📊 Patient Analytics & Breakdowns
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gap: '2rem', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            marginBottom: '3rem'
          }}>
            {/* Status Breakdown */}
            <div style={{
              padding: '2rem',
              borderRadius: '1rem',
              background: '#ffffff',
              border: '1px solid rgba(148, 163, 184, 0.22)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
            }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Patient Status Distribution
              </h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {patientStatusBreakdown.map((status: any, index: number) => (
                  <Link
                    key={index}
                    href={withBasePath(`/patients?status=${status.status_key}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      borderRadius: '0.75rem',
                      backgroundColor: getStatusBackground(status.status_key),
                      border: `1px solid ${getStatusColor(status.status_key)}40`,
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                        {status.status_key?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        Avg {status.avg_days_since_update || 0} days since update
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#059669' }}>
                        {status.recent_updates || 0} updated this week
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '2rem', 
                        fontWeight: 700, 
                        color: getStatusColor(status.status_key)
                      }}>
                        {status.count}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>patients</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Hold Reasons Breakdown */}
            <div style={{
              padding: '2rem',
              borderRadius: '1rem',
              background: '#ffffff',
              border: '1px solid rgba(148, 163, 184, 0.22)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
            }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Hold Reasons Analysis
              </h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {holdReasonBreakdown.map((hold: any, index: number) => (
                  <Link
                    key={index}
                    href={withBasePath(`/patients?status=${hold.hold_type}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      borderRadius: '0.75rem',
                      backgroundColor: hold.critical_count > 0 ? '#fee2e2' : '#fef3c7',
                      border: hold.critical_count > 0 ? '1px solid #ef4444' : '1px solid #f59e0b',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                        {hold.hold_type?.replace('hold_', '').replace('_', ' ').toUpperCase() || 'UNKNOWN HOLD'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        Avg {hold.avg_days_on_hold || 0} days on hold
                      </div>
                      {hold.critical_count > 0 && (
                        <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                          🚨 {hold.critical_count} critical (over 7 days)
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '2rem', 
                        fontWeight: 700, 
                        color: hold.critical_count > 0 ? '#dc2626' : '#ea580c'
                      }}>
                        {hold.count}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>patients</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Lab Status Breakdown */}
            <div style={{
              padding: '2rem',
              borderRadius: '1rem',
              background: '#ffffff',
              border: '1px solid rgba(148, 163, 184, 0.22)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
            }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 600, color: '#0f172a' }}>
                Lab Compliance Status
              </h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {labStatusBreakdown.map((lab: any, index: number) => (
                  <Link
                    key={index}
                    href={withBasePath(`/patients?lab_status=${lab.lab_status}`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      borderRadius: '0.75rem',
                      backgroundColor: lab.lab_status === 'overdue' ? '#fee2e2' : 
                                     lab.lab_status === 'due_soon' ? '#fef3c7' : '#ecfdf5',
                      border: lab.lab_status === 'overdue' ? '1px solid #ef4444' : 
                             lab.lab_status === 'due_soon' ? '1px solid #f59e0b' : '1px solid #10b981',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                        {lab.lab_status?.toUpperCase().replace('_', ' ') || 'UNKNOWN'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {lab.avg_days_until_due > 0 
                          ? `Avg ${Math.round(lab.avg_days_until_due)} days until due`
                          : lab.avg_days_until_due < 0 
                            ? `Avg ${Math.abs(Math.round(lab.avg_days_until_due))} days overdue`
                            : 'Due now'
                        }
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '2rem', 
                        fontWeight: 700, 
                        color: lab.lab_status === 'overdue' ? '#dc2626' : 
                               lab.lab_status === 'due_soon' ? '#ea580c' : '#059669'
                      }}>
                        {lab.count}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>patients</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Patients Needing Attention View */}
      {activeView === 'attention' && (
        <div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: '#0f172a', fontWeight: 600 }}>
            🎯 Patients Needing Immediate Attention
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gap: '1rem',
            marginBottom: '2rem'
          }}>
            {patientsNeedingAttention.map((patient: any, index: number) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1.5rem',
                  borderRadius: '1rem',
                  backgroundColor: '#ffffff',
                  border: `2px solid ${getPriorityColor(patient.attention_reason)}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedPatients.includes(patient.patient_id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPatients([...selectedPatients, patient.patient_id]);
                      } else {
                        setSelectedPatients(selectedPatients.filter(id => id !== patient.patient_id));
                      }
                    }}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      {patient.patient_name}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.25rem' }}>
                      Status: {patient.status_key?.replace('_', ' ') || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Last updated {Math.round(patient.days_since_update || 0)} days ago
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ 
                      fontSize: '0.8rem', 
                      fontWeight: 600, 
                      color: getPriorityColor(patient.attention_reason),
                      marginBottom: '0.25rem'
                    }}>
                      {getPriorityLabel(patient.attention_reason)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Priority {patient.priority_order}
                    </div>
                  </div>
                  
                  <Link
                    href={withBasePath(`/patients/${patient.patient_id}`)}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      background: getPriorityColor(patient.attention_reason),
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}
                  >
                    View Patient
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Bulk Actions for Selected */}
          {selectedPatients.length > 0 && (
            <div style={{
              position: 'fixed',
              bottom: '2rem',
              right: '2rem',
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: '#ffffff',
              boxShadow: '0 12px 32px rgba(59, 130, 246, 0.4)',
              zIndex: 1000
            }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                {selectedPatients.length} patients selected
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setActiveView('bulk-actions')}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    background: '#ffffff',
                    color: '#3b82f6',
                    border: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Bulk Actions
                </button>
                <button
                  onClick={() => setSelectedPatients([])}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(255, 255, 255, 0.2)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Other views placeholder */}
      {activeView !== 'analytics' && (
        <div style={{ 
          padding: '3rem', 
          textAlign: 'center',
          backgroundColor: '#f1f5f9',
          borderRadius: '1rem',
          border: '1px solid #cbd5e1'
        }}>
          <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#64748b', marginBottom: '1rem' }}>
            {activeView.charAt(0).toUpperCase() + activeView.slice(1).replace('-', ' ')} Interface
          </h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '1rem' }}>
            Advanced {activeView.replace('-', ' ')} tools will be built here next.
          </p>
          <div style={{ marginTop: '2rem' }}>
            <Link
              href={withBasePath("/patients")}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '0.5rem',
                background: '#3b82f6',
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '0.9rem',
                fontWeight: 600
              }}
            >
              Use Original Patients Page →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

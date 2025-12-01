export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { fetchDashboardMetrics } from '@/lib/metricsQueries';
import PatientHubClient from './PatientHubClient';

function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  title: 'Patient Hub - GMH Dashboard',
  description: 'Advanced patient management with filtering, bulk actions, and analytics',
};

export default async function PatientHubPage({
  searchParams
}: {
  searchParams: { 
    status?: string; 
    search?: string; 
    hold_type?: string;
    payment_method?: string;
    lab_status?: string;
  }
}) {
  const user = await requireUser('write');
  
  // Fetch comprehensive patient data with analytics
  const [
    metrics,
    patientStatusBreakdown,
    holdReasonBreakdown,
    paymentMethodBreakdown,
    labStatusBreakdown,
    recentActivity,
    patientsNeedingAttention
  ] = await Promise.all([
    fetchDashboardMetrics(),
    // Patient status breakdown with trends
    query(`
      SELECT 
        status_key,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - last_modified))/86400), 1) as avg_days_since_update,
        COUNT(CASE WHEN last_modified >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_updates
      FROM patients 
      WHERE status_key IS NOT NULL
      GROUP BY status_key
      ORDER BY count DESC
    `),
    // Hold reason breakdown
    query(`
      SELECT 
        status_key as hold_type,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - last_modified))/86400), 1) as avg_days_on_hold,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (NOW() - last_modified))/86400 > 7 THEN 1 END) as critical_count
      FROM patients 
      WHERE status_key LIKE 'hold%'
      GROUP BY status_key
      ORDER BY count DESC
    `),
    // Payment method breakdown
    query(`
      SELECT 
        method_of_payment,
        COUNT(*) as count,
        COUNT(CASE WHEN status_key = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN status_key LIKE 'hold%' THEN 1 END) as hold_count
      FROM patients 
      WHERE method_of_payment IS NOT NULL
      GROUP BY method_of_payment
      ORDER BY count DESC
    `),
    // Lab status breakdown
    query(`
      SELECT 
        CASE 
          WHEN next_lab_date <= CURRENT_DATE THEN 'overdue'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'current'
          ELSE 'future'
        END as lab_status,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (next_lab_date - CURRENT_DATE))/86400), 1) as avg_days_until_due
      FROM patients 
      WHERE status_key = 'active' AND next_lab_date IS NOT NULL
      GROUP BY 
        CASE 
          WHEN next_lab_date <= CURRENT_DATE THEN 'overdue'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
          WHEN next_lab_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'current'
          ELSE 'future'
        END
      ORDER BY 
        CASE 
          WHEN lab_status = 'overdue' THEN 1
          WHEN lab_status = 'due_soon' THEN 2
          WHEN lab_status = 'current' THEN 3
          ELSE 4
        END
    `),
    // Recent patient activity
    query(`
      SELECT 
        p.patient_id,
        p.full_name as patient_name,
        p.status_key,
        p.last_modified,
        p.last_modified_by,
        'patient_update' as activity_type
      FROM patients p
      WHERE p.last_modified >= NOW() - INTERVAL '24 hours'
      UNION ALL
      SELECT 
        pi.patient_id,
        p.full_name as patient_name,
        'payment_issue' as status_key,
        pi.created_at as last_modified,
        'system' as last_modified_by,
        'payment_issue_created' as activity_type
      FROM payment_issues pi
      LEFT JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY last_modified DESC
      LIMIT 20
    `),
    // Patients needing immediate attention
    query(`
      SELECT 
        p.patient_id,
        p.full_name as patient_name,
        p.status_key,
        p.last_modified,
        EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 as days_since_update,
        CASE 
          WHEN p.status_key LIKE 'hold%' AND EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 > 7 THEN 'critical_hold'
          WHEN p.next_lab_date <= CURRENT_DATE THEN 'overdue_labs'
          WHEN p.next_lab_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'labs_due_soon'
          WHEN EXISTS (SELECT 1 FROM payment_issues pi WHERE pi.patient_id = p.patient_id AND pi.resolved_at IS NULL) THEN 'payment_issues'
          ELSE 'attention_needed'
        END as attention_reason,
        CASE 
          WHEN p.status_key LIKE 'hold%' AND EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 > 7 THEN 1
          WHEN p.next_lab_date <= CURRENT_DATE THEN 2
          WHEN p.next_lab_date <= CURRENT_DATE + INTERVAL '7 days' THEN 3
          WHEN EXISTS (SELECT 1 FROM payment_issues pi WHERE pi.patient_id = p.patient_id AND pi.resolved_at IS NULL) THEN 4
          ELSE 5
        END as priority_order
      FROM patients p
      WHERE 
        (p.status_key LIKE 'hold%' AND EXTRACT(EPOCH FROM (NOW() - p.last_modified))/86400 > 3)
        OR p.next_lab_date <= CURRENT_DATE + INTERVAL '30 days'
        OR EXISTS (SELECT 1 FROM payment_issues pi WHERE pi.patient_id = p.patient_id AND pi.resolved_at IS NULL)
      ORDER BY priority_order, days_since_update DESC
      LIMIT 30
    `)
  ]);

  return (
    <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
              Patient Hub
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
              Advanced patient management with intelligent filtering, bulk actions, and predictive insights.
              Built on your existing patient data with enhanced capabilities.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <Link 
              href="/" 
              style={{ 
                color: '#0ea5e9', 
                textDecoration: 'none', 
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid #0ea5e9'
              }}
            >
              ← Main Dashboard
            </Link>
            <Link 
              href="/patients" 
              style={{ 
                color: '#059669', 
                textDecoration: 'none', 
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid #059669'
              }}
            >
              Original Patients →
            </Link>
          </div>
        </div>

        {/* Quick Stats Bar */}
        <div style={{ 
          display: 'grid', 
          gap: '1rem', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          marginBottom: '2rem'
        }}>
          <div style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
            border: '1px solid #10b981',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#059669', marginBottom: '0.25rem' }}>
              {metrics.activePatients}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#065f46' }}>Active Patients</div>
          </div>
          <div style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
            border: '1px solid #f59e0b',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
              {metrics.holdPatients}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#92400e' }}>On Hold</div>
          </div>
          <div style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)',
            border: '1px solid #ef4444',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
              {patientsNeedingAttention.length}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Need Attention</div>
          </div>
          <div style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
            border: '1px solid #0ea5e9',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
              {metrics.upcomingLabs}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#075985' }}>Labs Due ≤30d</div>
          </div>
        </div>
      </div>

      {/* Pass data to client component */}
      <PatientHubClient 
        patientStatusBreakdown={patientStatusBreakdown}
        holdReasonBreakdown={holdReasonBreakdown}
        paymentMethodBreakdown={paymentMethodBreakdown}
        labStatusBreakdown={labStatusBreakdown}
        recentActivity={recentActivity}
        patientsNeedingAttention={patientsNeedingAttention}
        searchParams={searchParams}
      />
    </section>
  );
}







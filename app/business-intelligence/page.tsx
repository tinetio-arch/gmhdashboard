export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { fetchDashboardMetrics } from '@/lib/metricsQueries';
import { getPaymentFailureStats } from '@/lib/testosteroneInventory';
import BusinessIntelligenceClient from './BusinessIntelligenceClient';

function withBasePath(path: string): string {
  return path;
}

export const metadata: Metadata = {
  title: 'Business Intelligence - GMH Dashboard',
  description: 'Comprehensive business analytics, trends, and predictive insights',
};

export default async function BusinessIntelligencePage() {
  const user = await requireUser('admin');
  
  // Fetch comprehensive business intelligence data
  const [
    metrics,
    paymentFailures,
    revenueAnalysis,
    patientGrowthTrends,
    operationalEfficiency,
    systemPerformance,
    predictiveInsights,
    financialHealth
  ] = await Promise.all([
    fetchDashboardMetrics(),
    getPaymentFailureStats(),
    // Revenue analysis over time
    query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as payment_issues,
        SUM(amount_owed) as total_amount,
        COUNT(DISTINCT patient_id) as unique_patients,
        AVG(amount_owed) as avg_amount_per_issue
      FROM payment_issues 
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `),
    // Patient growth trends
    query(`
      SELECT 
        DATE_TRUNC('month', date_added) as month,
        COUNT(*) as new_patients,
        COUNT(CASE WHEN status_key = 'active' THEN 1 END) as active_new_patients,
        COUNT(CASE WHEN status_key LIKE 'hold%' THEN 1 END) as new_patients_on_hold
      FROM patients 
      WHERE date_added >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date_added)
      ORDER BY month DESC
    `),
    // Operational efficiency metrics
    query(`
      SELECT 
        DATE_TRUNC('week', dispensed_at) as week,
        COUNT(*) as total_dispenses,
        COUNT(DISTINCT patient_id) as unique_patients_dispensed,
        SUM(total_amount_ml) as total_ml_dispensed,
        AVG(total_amount_ml) as avg_ml_per_dispense,
        COUNT(CASE WHEN signed_by IS NOT NULL THEN 1 END) as signed_dispenses,
        ROUND((COUNT(CASE WHEN signed_by IS NOT NULL THEN 1 END)::DECIMAL / COUNT(*)) * 100, 1) as signature_rate
      FROM dispenses 
      WHERE dispensed_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', dispensed_at)
      ORDER BY week DESC
    `),
    // System performance metrics
    query(`
      SELECT 
        DATE_TRUNC('day', sync_date) as day,
        SUM(total_webhooks_received) as total_webhooks,
        SUM(patients_processed) as total_processed,
        SUM(patients_skipped) as total_skipped,
        ROUND(AVG(patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 1) as avg_processing_rate
      FROM clinicsync_sync_tracking 
      WHERE sync_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', sync_date)
      ORDER BY day DESC
    `),
    // Predictive insights
    query(`
      SELECT 
        'contract_renewals_due' as insight_type,
        COUNT(*) as count,
        'Contracts expiring in next 30 days' as description,
        'high' as priority
      FROM patients 
      WHERE contract_end_date <= CURRENT_DATE + INTERVAL '30 days' 
        AND contract_end_date > CURRENT_DATE
        AND status_key = 'active'
      UNION ALL
      SELECT 
        'payment_method_issues' as insight_type,
        COUNT(*) as count,
        'Patients with problematic payment methods' as description,
        'medium' as priority
      FROM patients 
      WHERE method_of_payment IN ('Cash', 'Check', 'Other') 
        AND status_key = 'active'
      UNION ALL
      SELECT 
        'lab_compliance_risk' as insight_type,
        COUNT(*) as count,
        'Active patients without lab dates' as description,
        'medium' as priority
      FROM patients 
      WHERE status_key = 'active' 
        AND (next_lab_date IS NULL OR last_lab_date IS NULL)
    `),
    // Financial health indicators
    query(`
      SELECT 
        'outstanding_balances' as metric,
        SUM(CASE WHEN source = 'jane' THEN amount ELSE 0 END) as jane_amount,
        SUM(CASE WHEN source = 'quickbooks' THEN amount ELSE 0 END) as qb_amount,
        COUNT(CASE WHEN source = 'jane' THEN 1 END) as jane_count,
        COUNT(CASE WHEN source = 'quickbooks' THEN 1 END) as qb_count
      FROM (
        SELECT 
          outstanding_balance::NUMERIC as amount,
          'jane' as source
        FROM jane_packages_import 
        WHERE outstanding_balance::NUMERIC > 0
        UNION ALL
        SELECT 
          amount_owed as amount,
          'quickbooks' as source
        FROM payment_issues 
        WHERE resolved_at IS NULL
      ) combined_outstanding
    `)
  ]);

  return (
    <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
              Business Intelligence
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
              Comprehensive analytics, trends, and predictive insights for data-driven business decisions.
              All metrics are based on your live operational data.
            </p>
          </div>
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
            ← Back to Main Dashboard
          </Link>
        </div>
      </div>

      {/* Pass data to client component */}
      <BusinessIntelligenceClient 
        metrics={metrics}
        paymentFailures={paymentFailures}
        revenueAnalysis={revenueAnalysis}
        patientGrowthTrends={patientGrowthTrends}
        operationalEfficiency={operationalEfficiency}
        systemPerformance={systemPerformance}
        predictiveInsights={predictiveInsights}
        financialHealth={financialHealth}
      />
    </section>
  );
}









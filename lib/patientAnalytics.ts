import { query } from './db';

export type PatientAnalyticsBreakdown = {
  // Overall counts
  totalPatients: number;
  activePatients: number;
  
  // By client category
  primaryCare: number;
  mensHealth: number;
  other: number;
  
  // By client type (detailed)
  byClientType: Array<{
    clientTypeKey: string;
    clientTypeName: string;
    count: number;
    isPrimaryCare: boolean;
  }>;
  
  // By payment method
  byPaymentMethod: Array<{
    paymentMethodKey: string;
    paymentMethodName: string;
    count: number;
  }>;
  
  // Combined breakdown (client type + payment method)
  byClientTypeAndPayment: Array<{
    clientTypeKey: string;
    clientTypeName: string;
    paymentMethodKey: string;
    paymentMethodName: string;
    count: number;
    isPrimaryCare: boolean;
  }>;
  
  // By membership plan (from jane_packages_import)
  byMembershipPlan: Array<{
    planName: string;
    count: number;
    totalOutstanding: number;
  }>;
};

export async function getPatientAnalyticsBreakdown(): Promise<PatientAnalyticsBreakdown> {
  // Get overall counts
  const [overall] = await query<{
    total: string;
    active: string;
  }>(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status_key = 'active') as active
    FROM patients
    WHERE patient_id IS NOT NULL
      AND NOT (
        COALESCE(status_key, '') ILIKE 'inactive%'
        OR COALESCE(status_key, '') ILIKE 'discharg%'
      )
  `);

  // Get breakdown by client type
  const byClientType = await query<{
    client_type_key: string;
    display_name: string;
    is_primary_care: boolean;
    count: string;
  }>(`
    SELECT 
      COALESCE(ct.type_key, 'unknown') as client_type_key,
      COALESCE(ct.display_name, 'Unknown') as display_name,
      COALESCE(ct.is_primary_care, false) as is_primary_care,
      COUNT(*) as count
    FROM patients p
    LEFT JOIN client_type_lookup ct ON ct.type_key = p.client_type_key
    WHERE p.patient_id IS NOT NULL
      AND NOT (
        COALESCE(p.status_key, '') ILIKE 'inactive%'
        OR COALESCE(p.status_key, '') ILIKE 'discharg%'
      )
    GROUP BY ct.type_key, ct.display_name, ct.is_primary_care
    ORDER BY count DESC, ct.display_name
  `);

  // Get breakdown by payment method
  const byPaymentMethod = await query<{
    payment_method_key: string;
    display_name: string;
    count: string;
  }>(`
    SELECT 
      COALESCE(pm.method_key, 'unknown') as payment_method_key,
      COALESCE(pm.display_name, 'Unknown') as display_name,
      COUNT(*) as count
    FROM patients p
    LEFT JOIN payment_method_lookup pm ON pm.method_key = p.payment_method_key
    WHERE p.patient_id IS NOT NULL
      AND NOT (
        COALESCE(p.status_key, '') ILIKE 'inactive%'
        OR COALESCE(p.status_key, '') ILIKE 'discharg%'
      )
    GROUP BY pm.method_key, pm.display_name
    ORDER BY count DESC, pm.display_name
  `);

  // Get combined breakdown (client type + payment method)
  const byClientTypeAndPayment = await query<{
    client_type_key: string;
    client_type_name: string;
    payment_method_key: string;
    payment_method_name: string;
    count: string;
    is_primary_care: boolean;
  }>(`
    SELECT 
      COALESCE(ct.type_key, 'unknown') as client_type_key,
      COALESCE(ct.display_name, 'Unknown') as client_type_name,
      COALESCE(pm.method_key, 'unknown') as payment_method_key,
      COALESCE(pm.display_name, 'Unknown') as payment_method_name,
      COUNT(*) as count,
      COALESCE(ct.is_primary_care, false) as is_primary_care
    FROM patients p
    LEFT JOIN client_type_lookup ct ON ct.type_key = p.client_type_key
    LEFT JOIN payment_method_lookup pm ON pm.method_key = p.payment_method_key
    WHERE p.patient_id IS NOT NULL
      AND NOT (
        COALESCE(p.status_key, '') ILIKE 'inactive%'
        OR COALESCE(p.status_key, '') ILIKE 'discharg%'
      )
    GROUP BY ct.type_key, ct.display_name, ct.is_primary_care, pm.method_key, pm.display_name
    ORDER BY count DESC, ct.display_name, pm.display_name
  `);

  // Get breakdown by membership plan (from jane_packages_import)
  // Handle case where table doesn't exist yet
  let byMembershipPlan: Array<{
    plan_name: string;
    count: string;
    total_outstanding: string;
  }> = [];
  try {
    byMembershipPlan = await query<{
      plan_name: string;
      count: string;
      total_outstanding: string;
    }>(`
      WITH normalized_patients AS (
        SELECT
          patient_id,
          lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g')) AS normalized_name,
          status_key
        FROM patients
        WHERE patient_id IS NOT NULL
          AND NOT (
            COALESCE(status_key, '') ILIKE 'inactive%'
            OR COALESCE(status_key, '') ILIKE 'discharg%'
          )
      )
      SELECT 
        COALESCE(pkg.plan_name, 'Unknown Plan') as plan_name,
        COUNT(DISTINCT pn.patient_id) as count,
        COALESCE(SUM(pkg.outstanding_balance::numeric), 0) as total_outstanding
      FROM jane_packages_import pkg
      INNER JOIN normalized_patients pn ON pn.normalized_name = lower(pkg.norm_name)
      WHERE pn.patient_id IS NOT NULL
        AND COALESCE(pkg.status, '') <> ''
        AND lower(pkg.status) NOT LIKE 'inactive%'
        AND lower(pkg.status) NOT LIKE 'discharg%'
      GROUP BY pkg.plan_name
      ORDER BY count DESC, pkg.plan_name
    `);
  } catch (error: unknown) {
    // Table doesn't exist yet, return empty results
    console.error('Error fetching membership plan breakdown:', error);
    byMembershipPlan = [];
  }

  // Calculate primary care vs men's health vs other
  const primaryCareCount = byClientType
    .filter(row => row.is_primary_care)
    .reduce((sum, row) => sum + parseInt(row.count || '0'), 0);
  
  const mensHealthCount = byClientType
    .filter(row => row.client_type_key === 'mens_health_qbo')
    .reduce((sum, row) => sum + parseInt(row.count || '0'), 0);
  
  const otherCount = byClientType
    .filter(row => !row.is_primary_care && row.client_type_key !== 'mens_health_qbo')
    .reduce((sum, row) => sum + parseInt(row.count || '0'), 0);

  return {
    totalPatients: parseInt(overall?.total || '0'),
    activePatients: parseInt(overall?.active || '0'),
    primaryCare: primaryCareCount,
    mensHealth: mensHealthCount,
    other: otherCount,
    byClientType: byClientType.map(row => ({
      clientTypeKey: row.client_type_key,
      clientTypeName: row.display_name,
      count: parseInt(row.count || '0'),
      isPrimaryCare: row.is_primary_care
    })),
    byPaymentMethod: byPaymentMethod.map(row => ({
      paymentMethodKey: row.payment_method_key,
      paymentMethodName: row.display_name,
      count: parseInt(row.count || '0')
    })),
    byClientTypeAndPayment: byClientTypeAndPayment.map(row => ({
      clientTypeKey: row.client_type_key,
      clientTypeName: row.client_type_name,
      paymentMethodKey: row.payment_method_key,
      paymentMethodName: row.payment_method_name,
      count: parseInt(row.count || '0'),
      isPrimaryCare: row.is_primary_care
    })),
    byMembershipPlan: byMembershipPlan.map(row => ({
      planName: row.plan_name,
      count: parseInt(row.count || '0'),
      totalOutstanding: parseFloat(row.total_outstanding || '0')
    }))
  };
}


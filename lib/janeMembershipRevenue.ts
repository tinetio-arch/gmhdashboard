/**
 * Jane Membership Revenue Queries
 * Calculate monthly recurring revenue (MRR) from memberships
 * 
 * This extracts membership revenue separately from other Jane revenue
 */

import { query } from '@/lib/db';

export type MembershipRevenueSummary = {
  totalMonthlyRevenue: number;
  totalAnnualRevenue: number;
  membershipCounts: Array<{
    membershipType: string;
    membershipKey: string;
    monthlyPrice: number;
    patientCount: number;
    monthlyRevenue: number;
    annualRevenue: number;
  }>;
  byPaymentMethod: Array<{
    paymentMethod: string;
    monthlyRevenue: number;
    patientCount: number;
  }>;
};

export type MonthlyMembershipRevenue = {
  month: string; // YYYY-MM format
  totalRevenue: number;
  patientCount: number;
  breakdown: Array<{
    membershipType: string;
    monthlyRevenue: number;
    patientCount: number;
  }>;
};

/**
 * Membership monthly prices mapping
 * Based on your client_type_lookup table
 */
const MEMBERSHIP_MONTHLY_PRICES: Record<string, number> = {
  'primecare_elite_100_month': 100,
  'primecare_premier_50_month': 50,
  'jane_tcmh_180_month': 180,
  'qbo_tcmh_180_month': 180,
  'jane_f_f_fr_veteran_140_month': 140,
  'qbo_f_f_fr_veteran_140_month': 140,
  'ins_supp_60_month': 60,
  'approved_disc_pro_bono_pt': 0, // Pro-bono, no revenue
  'mixed_primecare_jane_qbo_tcmh': 100, // Assuming PrimeCare Elite rate
  'mens_health_qbo': 180, // Assuming TCMH rate
};

/**
 * Get total monthly membership revenue (MRR) from all active Jane patients
 * This calculates based on membership types in your system
 */
export async function getMembershipMonthlyRevenue(): Promise<MembershipRevenueSummary> {
  // Get all active Jane patients with their membership types
  const patients = await query<{
    patient_id: string;
    full_name: string;
    client_type_key: string | null;
    client_type: string | null;
    payment_method_key: string | null;
    clinicsync_patient_id: string | null;
  }>(
    `SELECT 
       p.patient_id,
       p.full_name,
       p.client_type_key,
       p.client_type,
       p.payment_method_key,
       cm.clinicsync_patient_id
     FROM patients p
     LEFT JOIN patient_clinicsync_mapping cm ON cm.patient_id = p.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
     ORDER BY p.client_type_key`
  );

  // Group by membership type and calculate revenue
  const membershipMap = new Map<string, {
    membershipType: string;
    membershipKey: string;
    monthlyPrice: number;
    patients: Array<{ patientId: string; paymentMethod: string }>;
  }>();

  // Also group by payment method
  const paymentMethodMap = new Map<string, {
    paymentMethod: string;
    patients: Set<string>;
    totalMonthlyRevenue: number;
  }>();

  for (const patient of patients) {
    const membershipKey = patient.client_type_key || 'other';
    const membershipDisplay = patient.client_type || 'Other';
    const paymentMethod = patient.payment_method_key || 'unknown';

    // Get monthly price for this membership
    const monthlyPrice = MEMBERSHIP_MONTHLY_PRICES[membershipKey] || 0;

    // Skip if no monthly price (like pro-bono)
    if (monthlyPrice <= 0) continue;

    // Add to membership map
    if (!membershipMap.has(membershipKey)) {
      membershipMap.set(membershipKey, {
        membershipType: membershipDisplay,
        membershipKey: membershipKey,
        monthlyPrice: monthlyPrice,
        patients: []
      });
    }

    membershipMap.get(membershipKey)!.patients.push({
      patientId: patient.patient_id,
      paymentMethod: paymentMethod
    });

    // Add to payment method map
    if (!paymentMethodMap.has(paymentMethod)) {
      paymentMethodMap.set(paymentMethod, {
        paymentMethod: paymentMethod,
        patients: new Set(),
        totalMonthlyRevenue: 0
      });
    }

    const pmData = paymentMethodMap.get(paymentMethod)!;
    pmData.patients.add(patient.patient_id);
    pmData.totalMonthlyRevenue += monthlyPrice;
  }

  // Build membership counts with revenue
  const membershipCounts = Array.from(membershipMap.entries()).map(([key, data]) => ({
    membershipType: data.membershipType,
    membershipKey: key,
    monthlyPrice: data.monthlyPrice,
    patientCount: data.patients.length,
    monthlyRevenue: data.monthlyPrice * data.patients.length,
    annualRevenue: data.monthlyPrice * data.patients.length * 12
  }));

  // Calculate totals
  const totalMonthlyRevenue = membershipCounts.reduce((sum, m) => sum + m.monthlyRevenue, 0);
  const totalAnnualRevenue = totalMonthlyRevenue * 12;

  // Build payment method breakdown
  const byPaymentMethod = Array.from(paymentMethodMap.entries()).map(([method, data]) => ({
    paymentMethod: method,
    monthlyRevenue: data.totalMonthlyRevenue,
    patientCount: data.patients.size
  }));

  return {
    totalMonthlyRevenue,
    totalAnnualRevenue,
    membershipCounts: membershipCounts.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
    byPaymentMethod: byPaymentMethod.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue)
  };
}

/**
 * Get historical monthly membership revenue
 * Note: This is based on current membership types, not historical changes
 * For true historical tracking, we'd need to track membership changes over time
 */
export async function getMembershipRevenueByMonth(
  months: number = 12
): Promise<MonthlyMembershipRevenue[]> {
  // For now, we'll return current MRR projected backwards
  // In the future, this could track actual historical membership changes
  const summary = await getMembershipMonthlyRevenue();

  const monthlyBreakdown: MonthlyMembershipRevenue[] = [];
  const today = new Date();

  for (let i = 0; i < months; i++) {
    const month = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

    // For historical months, we use current MRR as approximation
    // TODO: Implement actual historical tracking
    monthlyBreakdown.push({
      month: monthKey,
      totalRevenue: summary.totalMonthlyRevenue,
      patientCount: summary.membershipCounts.reduce((sum, m) => sum + m.patientCount, 0),
      breakdown: summary.membershipCounts.map(m => ({
        membershipType: m.membershipType,
        monthlyRevenue: m.monthlyRevenue,
        patientCount: m.patientCount
      }))
    });
  }

  return monthlyBreakdown.reverse(); // Return oldest to newest
}

/**
 * Get membership revenue from ALL webhook patients (not just mapped)
 * This gives a more complete picture including patients not in your system
 */
export async function getMembershipRevenueFromAllWebhooks(): Promise<MembershipRevenueSummary & {
  mappedPatients: number;
  unmappedPatients: number;
}> {
  // Get all unique ClinicSync patient IDs from webhooks
  const allWebhookPatients = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL`
  );

  // Get mapped patients with membership types
  const mappedPatients = await query<{
    clinicsync_patient_id: string;
    patient_id: string;
    client_type_key: string | null;
    client_type: string | null;
    payment_method_key: string | null;
  }>(
    `SELECT 
       cm.clinicsync_patient_id,
       p.patient_id,
       p.client_type_key,
       p.client_type,
       p.payment_method_key
     FROM patient_clinicsync_mapping cm
     INNER JOIN patients p ON p.patient_id = cm.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL`
  );

  const mappedSet = new Set(mappedPatients.map(p => p.clinicsync_patient_id));
  const mappedMap = new Map(mappedPatients.map(p => [p.clinicsync_patient_id, p]));

  // For unmapped patients, we can't determine membership type from your system
  // They would need to be mapped first to calculate accurate MRR
  const unmappedCount = allWebhookPatients.length - mappedSet.size;

  // Calculate revenue from mapped patients only (accurate)
  const membershipMap = new Map<string, {
    membershipType: string;
    membershipKey: string;
    monthlyPrice: number;
    patients: Array<{ patientId: string; paymentMethod: string }>;
  }>();

  const paymentMethodMap = new Map<string, {
    paymentMethod: string;
    patients: Set<string>;
    totalMonthlyRevenue: number;
  }>();

  for (const mapped of mappedPatients) {
    const membershipKey = mapped.client_type_key || 'other';
    const membershipDisplay = mapped.client_type || 'Other';
    const paymentMethod = mapped.payment_method_key || 'unknown';
    const monthlyPrice = MEMBERSHIP_MONTHLY_PRICES[membershipKey] || 0;

    if (monthlyPrice <= 0) continue;

    if (!membershipMap.has(membershipKey)) {
      membershipMap.set(membershipKey, {
        membershipType: membershipDisplay,
        membershipKey: membershipKey,
        monthlyPrice: monthlyPrice,
        patients: []
      });
    }

    membershipMap.get(membershipKey)!.patients.push({
      patientId: mapped.patient_id,
      paymentMethod: paymentMethod
    });

    if (!paymentMethodMap.has(paymentMethod)) {
      paymentMethodMap.set(paymentMethod, {
        paymentMethod: paymentMethod,
        patients: new Set(),
        totalMonthlyRevenue: 0
      });
    }

    const pmData = paymentMethodMap.get(paymentMethod)!;
    pmData.patients.add(mapped.patient_id);
    pmData.totalMonthlyRevenue += monthlyPrice;
  }

  const membershipCounts = Array.from(membershipMap.entries()).map(([key, data]) => ({
    membershipType: data.membershipType,
    membershipKey: key,
    monthlyPrice: data.monthlyPrice,
    patientCount: data.patients.length,
    monthlyRevenue: data.monthlyPrice * data.patients.length,
    annualRevenue: data.monthlyPrice * data.patients.length * 12
  }));

  const totalMonthlyRevenue = membershipCounts.reduce((sum, m) => sum + m.monthlyRevenue, 0);
  const totalAnnualRevenue = totalMonthlyRevenue * 12;

  const byPaymentMethod = Array.from(paymentMethodMap.entries()).map(([method, data]) => ({
    paymentMethod: method,
    monthlyRevenue: data.totalMonthlyRevenue,
    patientCount: data.patients.size
  }));

  return {
    totalMonthlyRevenue,
    totalAnnualRevenue,
    membershipCounts: membershipCounts.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
    byPaymentMethod: byPaymentMethod.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
    mappedPatients: mappedSet.size,
    unmappedPatients: unmappedCount
  };
}


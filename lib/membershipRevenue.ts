/**
 * Membership Revenue Queries
 * Calculate monthly recurring revenue (MRR) from memberships
 * Separates Jane and QuickBooks memberships for accurate tracking
 */

import { query } from '@/lib/db';

export type MembershipRevenueSummary = {
  totalMonthlyRevenue: number;
  totalAnnualRevenue: number;
  primaryCareMemberships: {
    monthlyRevenue: number;
    annualRevenue: number;
    memberCount: number;
    memberships: Array<{
      membershipType: string;
      membershipKey: string;
      monthlyPrice: number;
      patientCount: number;
      monthlyRevenue: number;
      annualRevenue: number;
      isJane: boolean; // Color-code: true = Jane (green), false = QuickBooks (orange)
    }>;
  };
  mensHealthMemberships: {
    monthlyRevenue: number;
    annualRevenue: number;
    memberCount: number;
    memberships: Array<{
      membershipType: string;
      membershipKey: string;
      monthlyPrice: number;
      patientCount: number;
      monthlyRevenue: number;
      annualRevenue: number;
      isJane: boolean; // Color-code: true = Jane (green), false = QuickBooks (orange)
    }>;
  };
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
 * Determine if a membership type is Jane-managed or QuickBooks-managed
 * IMPORTANT: If it says QBO anywhere in the membership key OR display name, it is NOT Jane
 */
function isJaneMembership(membershipKey: string, membershipDisplay: string, paymentMethod: string): boolean {
  // CRITICAL: If membership key OR display name contains "qbo" anywhere (case insensitive), it's QuickBooks (NOT Jane)
  const keyLower = membershipKey.toLowerCase();
  const displayLower = membershipDisplay.toLowerCase();
  
  if (keyLower.includes('qbo') || displayLower.includes('qbo')) {
    return false; // QuickBooks membership
  }
  
  // Explicit Jane memberships (PrimeCare, Jane TCMH, etc.)
  if (keyLower.includes('jane_') || 
      membershipKey === 'primecare_elite_100_month' || 
      membershipKey === 'primecare_premier_50_month' ||
      membershipKey === 'ins_supp_60_month') {
    return true; // Jane membership
  }
  
  // Check payment method - only count as Jane if payment method is 'jane' (not 'qbo', 'quickbooks', or 'jane_quickbooks')
  if (paymentMethod && (paymentMethod.toLowerCase().includes('qbo') || paymentMethod.toLowerCase().includes('quickbooks'))) {
    return false; // QuickBooks payment method
  }
  
  // Default: check if payment method is explicitly 'jane'
  return paymentMethod === 'jane';
}

/**
 * Get total monthly membership revenue (MRR) from ALL active patients
 * Separates Jane and QuickBooks memberships
 */
export async function getMembershipMonthlyRevenue(): Promise<MembershipRevenueSummary> {
  // Get ALL active patients with their membership types, including is_primary_care flag
  const patients = await query<{
    patient_id: string;
    full_name: string;
    client_type_key: string | null;
    client_type: string | null;
    payment_method_key: string | null;
    is_primary_care: boolean | null;
  }>(
    `SELECT 
       p.patient_id,
       p.full_name,
       p.client_type_key,
       ctl.display_name AS client_type,
       p.payment_method_key,
       COALESCE(ctl.is_primary_care, false) AS is_primary_care
     FROM patients p
     LEFT JOIN client_type_lookup ctl ON ctl.type_key = p.client_type_key
     WHERE p.client_type_key IS NOT NULL
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
     ORDER BY ctl.is_primary_care DESC, p.payment_method_key, p.client_type_key`
  );

  // Separate into Primary Care and Men's Health groups
  // Each membership type will track its Jane vs QuickBooks status
  const primaryCareMembershipMap = new Map<string, {
    membershipType: string;
    membershipKey: string;
    monthlyPrice: number;
    janePatients: Array<{ patientId: string }>;
    quickbooksPatients: Array<{ patientId: string }>;
  }>();

  const mensHealthMembershipMap = new Map<string, {
    membershipType: string;
    membershipKey: string;
    monthlyPrice: number;
    janePatients: Array<{ patientId: string }>;
    quickbooksPatients: Array<{ patientId: string }>;
  }>();

  for (const patient of patients) {
    const membershipKey = patient.client_type_key || 'other';
    const membershipDisplay = patient.client_type || 'Other';
    const paymentMethod = patient.payment_method_key || 'unknown';
    const isPrimaryCare = patient.is_primary_care ?? false;

    // Get monthly price for this membership
    const monthlyPrice = MEMBERSHIP_MONTHLY_PRICES[membershipKey] || 0;

    // Skip if no monthly price (like pro-bono)
    if (monthlyPrice <= 0) continue;

    // Determine if this is a Jane or QuickBooks membership
    // IMPORTANT: If it says QBO anywhere, it's NOT Jane
    const isJane = isJaneMembership(membershipKey, membershipDisplay, paymentMethod);

    // Add to appropriate category map (Primary Care or Men's Health)
    const targetMap = isPrimaryCare ? primaryCareMembershipMap : mensHealthMembershipMap;

    if (!targetMap.has(membershipKey)) {
      targetMap.set(membershipKey, {
        membershipType: membershipDisplay,
        membershipKey: membershipKey,
        monthlyPrice: monthlyPrice,
        janePatients: [],
        quickbooksPatients: []
      });
    }

    const membershipData = targetMap.get(membershipKey)!;
    if (isJane) {
      membershipData.janePatients.push({ patientId: patient.patient_id });
    } else {
      membershipData.quickbooksPatients.push({ patientId: patient.patient_id });
    }
  }

  // Build Primary Care memberships with Jane/QuickBooks breakdown
  const primaryCareMemberships = Array.from(primaryCareMembershipMap.entries()).map(([key, data]) => {
    const janeCount = data.janePatients.length;
    const quickbooksCount = data.quickbooksPatients.length;
    const totalCount = janeCount + quickbooksCount;
    
    // Create separate entries for Jane and QuickBooks if both exist
    const entries = [];
    if (janeCount > 0) {
      entries.push({
        membershipType: data.membershipType,
        membershipKey: key,
        monthlyPrice: data.monthlyPrice,
        patientCount: janeCount,
        monthlyRevenue: data.monthlyPrice * janeCount,
        annualRevenue: data.monthlyPrice * janeCount * 12,
        isJane: true
      });
    }
    if (quickbooksCount > 0) {
      entries.push({
        membershipType: data.membershipType,
        membershipKey: key,
        monthlyPrice: data.monthlyPrice,
        patientCount: quickbooksCount,
        monthlyRevenue: data.monthlyPrice * quickbooksCount,
        annualRevenue: data.monthlyPrice * quickbooksCount * 12,
        isJane: false
      });
    }
    
    return entries;
  }).flat().sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);

  // Build Men's Health memberships with Jane/QuickBooks breakdown
  const mensHealthMemberships = Array.from(mensHealthMembershipMap.entries()).map(([key, data]) => {
    const janeCount = data.janePatients.length;
    const quickbooksCount = data.quickbooksPatients.length;
    
    // Create separate entries for Jane and QuickBooks if both exist
    const entries = [];
    if (janeCount > 0) {
      entries.push({
        membershipType: data.membershipType,
        membershipKey: key,
        monthlyPrice: data.monthlyPrice,
        patientCount: janeCount,
        monthlyRevenue: data.monthlyPrice * janeCount,
        annualRevenue: data.monthlyPrice * janeCount * 12,
        isJane: true
      });
    }
    if (quickbooksCount > 0) {
      entries.push({
        membershipType: data.membershipType,
        membershipKey: key,
        monthlyPrice: data.monthlyPrice,
        patientCount: quickbooksCount,
        monthlyRevenue: data.monthlyPrice * quickbooksCount,
        annualRevenue: data.monthlyPrice * quickbooksCount * 12,
        isJane: false
      });
    }
    
    return entries;
  }).flat().sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);

  // Calculate totals
  const primaryCareMonthlyRevenue = primaryCareMemberships.reduce((sum, m) => sum + m.monthlyRevenue, 0);
  const primaryCareAnnualRevenue = primaryCareMonthlyRevenue * 12;
  const primaryCareMemberCount = primaryCareMemberships.reduce((sum, m) => sum + m.patientCount, 0);

  const mensHealthMonthlyRevenue = mensHealthMemberships.reduce((sum, m) => sum + m.monthlyRevenue, 0);
  const mensHealthAnnualRevenue = mensHealthMonthlyRevenue * 12;
  const mensHealthMemberCount = mensHealthMemberships.reduce((sum, m) => sum + m.patientCount, 0);

  const totalMonthlyRevenue = primaryCareMonthlyRevenue + mensHealthMonthlyRevenue;
  const totalAnnualRevenue = totalMonthlyRevenue * 12;

  return {
    totalMonthlyRevenue,
    totalAnnualRevenue,
    primaryCareMemberships: {
      monthlyRevenue: primaryCareMonthlyRevenue,
      annualRevenue: primaryCareAnnualRevenue,
      memberCount: primaryCareMemberCount,
      memberships: primaryCareMemberships
    },
    mensHealthMemberships: {
      monthlyRevenue: mensHealthMonthlyRevenue,
      annualRevenue: mensHealthAnnualRevenue,
      memberCount: mensHealthMemberCount,
      memberships: mensHealthMemberships
    }
  };
}


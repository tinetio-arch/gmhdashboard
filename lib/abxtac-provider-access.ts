/**
 * ABXTac Provider-Visit Access Control
 *
 * Bridges Healthie EHR patient records with ABXTac WooCommerce tier access.
 * Patients who have completed a visit with a NOWOptimal Network provider
 * are eligible for discounted peptide access at their assigned tier.
 *
 * Flow:
 *   1. Patient sees NOWOptimal provider → visit recorded in Healthie
 *   2. This module checks Healthie for completed visits
 *   3. If verified, assigns tier + discount in WooCommerce customer meta
 *   4. WooCommerce Memberships plugin applies discount at checkout
 *
 * Discount structure:
 *   Heal:     40% off (entry tier, drives initial conversion)
 *   Optimize: 30% off (performance tier, rewards commitment)
 *   Thrive:   20% off (premium tier, patients already committed)
 */

import { query } from '@/lib/db';

// ─── TYPES ───────────────────────────────────────────────────────────

export type ABXTacTier = 'heal' | 'optimize' | 'thrive';

export interface ProviderVisitRecord {
  healthiePatientId: string;
  email: string;
  firstName: string;
  lastName: string;
  providerName: string;
  visitDate: string;         // YYYY-MM-DD
  visitType: string;         // e.g., 'initial_consultation', 'follow_up'
  assignedTier: ABXTacTier;
  planOfCare?: string;       // Provider's recommended peptide plan
}

export interface ABXTacCustomerAccess {
  customerId: number;
  email: string;
  healthiePatientId: string | null;
  tier: ABXTacTier;
  providerVerified: boolean;
  providerName: string | null;
  lastVisitDate: string | null;
  discountPercent: number;
  tierAssignedAt: string;
  tierExpiresAt: string;     // Requires re-verification after 12 months
}

export const TIER_DISCOUNTS: Record<ABXTacTier, number> = {
  heal: 40,
  optimize: 30,
  thrive: 20,
};

const TIER_RANK: Record<ABXTacTier, number> = {
  heal: 1,
  optimize: 2,
  thrive: 3,
};

// Tier access duration — patients must see provider within this window to maintain discount
const TIER_VALIDITY_DAYS = 365;

// ─── DATABASE TABLE ──────────────────────────────────────────────────
// This table tracks ABXTac customer tier assignments

export const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS abxtac_customer_access (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    healthie_patient_id VARCHAR(50),
    woo_customer_id INTEGER,
    tier VARCHAR(20) NOT NULL DEFAULT 'heal',
    provider_verified BOOLEAN NOT NULL DEFAULT false,
    provider_name VARCHAR(255),
    last_visit_date DATE,
    plan_of_care TEXT,
    tier_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tier_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_abxtac_access_email ON abxtac_customer_access(email);
  CREATE INDEX IF NOT EXISTS idx_abxtac_access_healthie ON abxtac_customer_access(healthie_patient_id);
  CREATE INDEX IF NOT EXISTS idx_abxtac_access_woo ON abxtac_customer_access(woo_customer_id);
`;

// ─── CORE FUNCTIONS ──────────────────────────────────────────────────

/**
 * Record a provider visit and assign/upgrade tier access.
 * Called when a patient completes a visit with a NOWOptimal provider.
 */
export async function recordProviderVisit(visit: ProviderVisitRecord): Promise<ABXTacCustomerAccess> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TIER_VALIDITY_DAYS);

  // Check for existing access record
  const existing = await query<any>(
    'SELECT * FROM abxtac_customer_access WHERE email = $1',
    [visit.email.toLowerCase()]
  );

  if (existing.rows.length > 0) {
    const current = existing.rows[0];
    const currentRank = TIER_RANK[current.tier as ABXTacTier] || 0;
    const newRank = TIER_RANK[visit.assignedTier] || 0;

    // Only upgrade tier, never downgrade from a provider visit
    const finalTier = newRank > currentRank ? visit.assignedTier : current.tier;

    const result = await query<any>(
      `UPDATE abxtac_customer_access SET
        healthie_patient_id = COALESCE($1, healthie_patient_id),
        tier = $2,
        provider_verified = true,
        provider_name = $3,
        last_visit_date = $4,
        plan_of_care = COALESCE($5, plan_of_care),
        tier_assigned_at = NOW(),
        tier_expires_at = $6,
        updated_at = NOW()
      WHERE email = $7
      RETURNING *`,
      [
        visit.healthiePatientId,
        finalTier,
        visit.providerName,
        visit.visitDate,
        visit.planOfCare,
        expiresAt.toISOString(),
        visit.email.toLowerCase(),
      ]
    );

    return mapRowToAccess(result.rows[0]);
  }

  // Create new access record
  const result = await query<any>(
    `INSERT INTO abxtac_customer_access
      (email, healthie_patient_id, tier, provider_verified, provider_name, last_visit_date, plan_of_care, tier_expires_at)
    VALUES ($1, $2, $3, true, $4, $5, $6, $7)
    RETURNING *`,
    [
      visit.email.toLowerCase(),
      visit.healthiePatientId,
      visit.assignedTier,
      visit.providerName,
      visit.visitDate,
      visit.planOfCare,
      expiresAt.toISOString(),
    ]
  );

  return mapRowToAccess(result.rows[0]);
}

/**
 * Look up a customer's current tier and discount access.
 * Used by WooCommerce webhook to apply discounts at checkout.
 */
export async function getCustomerAccess(email: string): Promise<ABXTacCustomerAccess | null> {
  const result = await query<any>(
    'SELECT * FROM abxtac_customer_access WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) return null;

  const access = mapRowToAccess(result.rows[0]);

  // Check if tier has expired
  if (new Date(access.tierExpiresAt) < new Date()) {
    access.providerVerified = false;
    access.discountPercent = 0;
  }

  return access;
}

/**
 * Link a WooCommerce customer ID to an existing access record.
 * Called when a customer first places an order or creates an account.
 */
export async function linkWooCustomer(email: string, wooCustomerId: number): Promise<void> {
  await query(
    `UPDATE abxtac_customer_access SET woo_customer_id = $1, updated_at = NOW() WHERE email = $2`,
    [wooCustomerId, email.toLowerCase()]
  );
}

/**
 * Check if a customer has valid provider-verified access to a given tier.
 */
export async function hasValidTierAccess(email: string, requiredTier: ABXTacTier): Promise<boolean> {
  const access = await getCustomerAccess(email);
  if (!access || !access.providerVerified) return false;

  // Check expiration
  if (new Date(access.tierExpiresAt) < new Date()) return false;

  // Check tier rank
  return TIER_RANK[access.tier] >= TIER_RANK[requiredTier];
}

/**
 * Get all customers whose tier access is expiring within N days.
 * Used by cron job to trigger re-verification reminders.
 */
export async function getExpiringAccess(withinDays: number = 30): Promise<ABXTacCustomerAccess[]> {
  const result = await query<any>(
    `SELECT * FROM abxtac_customer_access
     WHERE provider_verified = true
       AND tier_expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
     ORDER BY tier_expires_at ASC`,
    [withinDays]
  );

  return result.rows.map(mapRowToAccess);
}

/**
 * Get dashboard summary of ABXTac customer tiers.
 */
export async function getTierSummary(): Promise<{
  heal: number;
  optimize: number;
  thrive: number;
  total: number;
  expired: number;
  expiringNext30Days: number;
}> {
  const result = await query<any>(`
    SELECT
      COUNT(*) FILTER (WHERE tier = 'heal' AND provider_verified AND tier_expires_at > NOW()) as heal,
      COUNT(*) FILTER (WHERE tier = 'optimize' AND provider_verified AND tier_expires_at > NOW()) as optimize,
      COUNT(*) FILTER (WHERE tier = 'thrive' AND provider_verified AND tier_expires_at > NOW()) as thrive,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tier_expires_at <= NOW()) as expired,
      COUNT(*) FILTER (WHERE tier_expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days') as expiring_next_30
    FROM abxtac_customer_access
  `);

  const row = result.rows[0];
  return {
    heal: parseInt(row.heal) || 0,
    optimize: parseInt(row.optimize) || 0,
    thrive: parseInt(row.thrive) || 0,
    total: parseInt(row.total) || 0,
    expired: parseInt(row.expired) || 0,
    expiringNext30Days: parseInt(row.expiring_next_30) || 0,
  };
}

// ─── HEALTHIE INTEGRATION ────────────────────────────────────────────

/**
 * Verify a patient has a completed visit in Healthie by checking their chart notes.
 * This is the bridge between "patient saw a provider" and "patient gets ABXTac discount."
 *
 * Uses existing Healthie client from lib/healthie.ts.
 */
export async function verifyProviderVisitFromHealthie(
  healthieClient: any,
  email: string
): Promise<{ verified: boolean; visit?: Partial<ProviderVisitRecord> }> {
  try {
    // Look up patient in Healthie by email
    const patient = await healthieClient.findClientByEmail(email);
    if (!patient) {
      return { verified: false };
    }

    // Check for chart notes (completed visits generate chart notes)
    const chartNotes = await healthieClient.getDocuments(patient.id);
    const formAnswers = await healthieClient.getFormAnswerGroups(patient.id);

    // A patient with chart notes or completed intake forms has been seen
    const hasVisitEvidence = (chartNotes && chartNotes.length > 0) || (formAnswers && formAnswers.length > 0);

    if (!hasVisitEvidence) {
      return { verified: false };
    }

    return {
      verified: true,
      visit: {
        healthiePatientId: patient.id,
        email: patient.email || email,
        firstName: patient.first_name || '',
        lastName: patient.last_name || '',
        visitDate: new Date().toISOString().split('T')[0],
      },
    };
  } catch (error: any) {
    console.error('[ABXTac] Error verifying provider visit from Healthie:', error.message);
    return { verified: false };
  }
}

// ─── WOOCOMMERCE DISCOUNT APPLICATION ────────────────────────────────

/**
 * Generate WooCommerce coupon code for a customer's tier discount.
 * This is applied automatically at checkout via webhook.
 */
export function generateTierCouponCode(email: string, tier: ABXTacTier): string {
  // Deterministic coupon code per customer+tier so we don't create duplicates
  const base = `NOWOPTIMAL-${tier.toUpperCase()}-${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  // Truncate to 50 chars max (WooCommerce limit)
  return base.substring(0, 50);
}

/**
 * Build the WooCommerce coupon creation payload for a provider-verified customer.
 */
export function buildTierCouponPayload(email: string, tier: ABXTacTier) {
  const discount = TIER_DISCOUNTS[tier];
  const code = generateTierCouponCode(email, tier);

  return {
    code,
    discount_type: 'percent',
    amount: discount.toString(),
    individual_use: true,
    email_restrictions: [email.toLowerCase()],
    usage_limit: 0,        // Unlimited uses
    usage_limit_per_user: 0,
    description: `NOWOptimal Network provider-verified ${tier.toUpperCase()} tier discount (${discount}% off)`,
    meta_data: [
      { key: '_abxtac_tier', value: tier },
      { key: '_abxtac_provider_verified', value: 'yes' },
    ],
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────

function mapRowToAccess(row: any): ABXTacCustomerAccess {
  return {
    customerId: row.woo_customer_id || 0,
    email: row.email,
    healthiePatientId: row.healthie_patient_id,
    tier: row.tier as ABXTacTier,
    providerVerified: row.provider_verified,
    providerName: row.provider_name,
    lastVisitDate: row.last_visit_date,
    discountPercent: row.provider_verified ? TIER_DISCOUNTS[row.tier as ABXTacTier] : 0,
    tierAssignedAt: row.tier_assigned_at,
    tierExpiresAt: row.tier_expires_at,
  };
}

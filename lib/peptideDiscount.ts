/**
 * Peptide Discount — single source of truth for peptide pricing discounts.
 *
 * Per docs/sot-modules/25-patient-classification-and-dashboard.md §8.6.2
 * (Unified Discount Matrix) and §8.6.5 (Discount Application Surface).
 *
 * USED BY:
 *   - app/api/jarvis/peptide-eligibility/route.ts  (display)
 *   - app/api/headless/checkout/route.ts            (re-validation at charge time)
 *   - app/api/ipad/billing/woo-products/route.ts    (iPad cart)
 *
 * RULE: Server always recomputes. Never trust a client-sent discount.
 */

import { query } from '@/lib/db';

export type PeptideTier = 'retail' | 'heal' | 'optimize' | 'thrive' | 'admin';

export type DiscountInfo = {
  tier: PeptideTier;
  /** Fractional discount (0 to 0.5). Multiply retail * (1 - pct). */
  discountPct: number;
  /** Human-readable reason for logging/debugging. */
  reason: string;
};

const ADMIN_EMAILS = new Set([
  'philschafer7@gmail.com',
  'admin@nowoptimal.com',
  'admin@granitemountainhealth.com'
]);

const NOW_BRAND_KEYS = new Set([
  'nowmenshealth',
  'nowprimarycare',
  'nowlongevity'
  // Note: 'abxtac' patients hit the abxtac_customer_access branch below.
]);

/**
 * Authoritative tier rates (peptides).
 *
 * Per §8.6.2 — HEAL 10%, OPTIMIZE 20%, THRIVE 30%.
 * Admin gets at-cost pricing, handled separately by callers that need
 * wholesale + handling-fee math (returning pct here is a fallback).
 */
const PEPTIDE_TIER_RATES: Record<Exclude<PeptideTier, 'retail' | 'admin'>, number> = {
  heal: 0.10,
  optimize: 0.20,
  thrive: 0.30
};

/**
 * Lab discount matrix (for future use — not wired yet as of 2026-04-18).
 * Kept here so it lives with the peptide matrix; a separate resolver will call it.
 */
export const LAB_TIER_RATES: Record<Exclude<PeptideTier, 'retail' | 'admin'>, number> = {
  heal: 0.10,
  optimize: 0.15,
  thrive: 0.25
};

/**
 * Resolve the peptide discount for a patient.
 *
 * Look-up order (first match wins):
 *   1. Admin email → admin (caller computes at-cost separately)
 *   2. ABXTAC tier from abxtac_customer_access (if provider_verified AND not expired)
 *   3. NOW brand courtesy (NowMensHealth.Care / NowPrimary.Care / NowLongevity.Care) → 20%
 *   4. Retail (0%)
 */
export async function getPeptideDiscountForPatient(opts: {
  healthie_client_id: string | null | undefined;
  email: string | null | undefined;
  client_type_key: string | null | undefined;
}): Promise<DiscountInfo> {
  const email = (opts.email || '').trim().toLowerCase();

  // 1. Admin
  if (email && ADMIN_EMAILS.has(email)) {
    return { tier: 'admin', discountPct: 0, reason: 'admin_at_cost' };
  }

  // 2. ABXTAC verified tier
  if (opts.healthie_client_id) {
    try {
      const [access] = await query<{ tier: string; tier_expires_at: string | null; provider_verified: boolean }>(
        `SELECT tier, tier_expires_at::text AS tier_expires_at, provider_verified
         FROM abxtac_customer_access
         WHERE healthie_patient_id = $1
         LIMIT 1`,
        [String(opts.healthie_client_id)]
      );
      if (access?.provider_verified) {
        const expired = access.tier_expires_at ? new Date(access.tier_expires_at) < new Date() : false;
        if (!expired) {
          const tier = access.tier as PeptideTier;
          if (tier === 'heal' || tier === 'optimize' || tier === 'thrive') {
            return { tier, discountPct: PEPTIDE_TIER_RATES[tier], reason: `abxtac_${tier}` };
          }
        }
      }
    } catch {
      /* table may not exist in some envs */
    }
  }

  // 3. NOW brand courtesy — §8.6.2: NowPrimary + NowMensHealth (+ Longevity) = 20% peptides
  const ct = (opts.client_type_key || '').toLowerCase();
  if (NOW_BRAND_KEYS.has(ct)) {
    return { tier: 'optimize', discountPct: 0.20, reason: `${ct}_courtesy_20` };
  }

  // 4. ABXTAC group enrollment (client_type_key = 'abxtac') without abxtac_customer_access row
  //    Fall back to Heal rate (safest default for a subscribed ABXTAC patient lacking tier data).
  if (ct === 'abxtac') {
    return { tier: 'heal', discountPct: 0.10, reason: 'abxtac_group_default_heal' };
  }

  return { tier: 'retail', discountPct: 0, reason: 'retail' };
}

/**
 * Apply discount to a retail price. Never negative. Rounds to cents.
 */
export function applyDiscount(retail: number, discountPct: number): number {
  const discounted = retail * (1 - discountPct);
  return Math.max(0, Math.round(discounted * 100) / 100);
}

/**
 * Bulk price lookup for a set of SKUs from the YPB catalog.
 * Returns null price for unknown SKUs — callers must decide how to reject.
 */
export async function getRetailPricesBySku(skus: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (!skus.length) return map;
  const deduped = Array.from(new Set(skus.map(s => String(s).trim()).filter(Boolean)));
  if (!deduped.length) return map;

  const rows = await query<{ sku: string; price: string | null; wholesale_cost: string | null }>(
    `SELECT sku, price::text AS price, wholesale_cost::text AS wholesale_cost
     FROM ypb_available_products
     WHERE sku = ANY($1::text[])`,
    [deduped]
  );
  for (const r of rows) {
    map.set(r.sku, r.price != null ? Number(r.price) : null);
  }
  // Mark unknown SKUs
  for (const s of deduped) if (!map.has(s)) map.set(s, null);
  return map;
}

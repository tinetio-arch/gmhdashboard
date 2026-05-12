/**
 * Phase 3 — Client-Type Classification Mapping (DRAFT, requires Phil review)
 *
 * Source of truth: `client_type_lookup` table (18 rows).
 * The lookup table does NOT store $ amount or clinic — those are encoded in
 * `display_name` text. This file makes those implicit fields explicit so the
 * classifier can do (clinic, monthly_amount) → type_key lookups.
 *
 * Convention:
 *   - billingSource: qbo | jane | healthie | none
 *     (qbo and jane are sunsetting per project_quickbooks_sunset.md;
 *      healthie is the going-forward platform)
 *   - status: 'current' | 'legacy' | 'unused'
 *   - monthlyAmount: nullable (sick_visit, abxtac, etc. don't have a fixed monthly)
 *   - clinic: 'primary_care' | 'mens_health' | 'longevity' | 'mental_health' | 'abxtac' | 'any'
 */

export type ClientTypeBillingSource = 'qbo' | 'jane' | 'healthie' | 'none';
export type ClientTypeClinic =
  | 'primary_care'
  | 'mens_health'
  | 'longevity'
  | 'mental_health'
  | 'abxtac'
  | 'any';
export type ClientTypeStatus = 'current' | 'legacy' | 'unused';

export type ClientTypeMappingRow = {
  typeKey: string;
  displayName: string;
  monthlyAmountUsd: number | null;
  clinic: ClientTypeClinic;
  billingSource: ClientTypeBillingSource;
  status: ClientTypeStatus;
  notes?: string;
};

/**
 * The 18 lookup values, with $ amount and clinic broken out.
 * Reviewed against actual `client_type_lookup` rows on 2026-04-28.
 *
 * Active patient counts (as of 2026-04-28, source: SELECT GROUP BY in sub-phase 3.0 prep):
 *   nowmenshealth=221, nowlongevity=32, NULL=22, nowprimarycare=19, sick_visit=16,
 *   primecare_premier_50_month=11, approved_disc_pro_bono_pt=9,
 *   ins_supp_60_month=5, primecare_elite_100_month=5,
 *   jane_X / qbo_X = 3 each, abxtac / mens_health_qbo / mixed_X / nowmentalhealth / other = 0
 */
export const CLIENT_TYPE_MAPPING: ClientTypeMappingRow[] = [
  // === CURRENT (Healthie-native, going forward) ===
  {
    typeKey: 'nowmenshealth',
    displayName: 'NowMensHealth.Care',
    monthlyAmountUsd: 180,
    clinic: 'mens_health',
    billingSource: 'healthie',
    status: 'current',
    notes: 'Default $180/mo TRT membership. ABXTac patients also tagged here when their Rx ships through MensHealth.',
  },
  {
    typeKey: 'nowprimarycare',
    displayName: 'NowPrimary.Care',
    monthlyAmountUsd: null, // varies — uses primecare_* tier instead when known
    clinic: 'primary_care',
    billingSource: 'healthie',
    status: 'current',
    notes: 'Generic Primary Care. Prefer primecare_premier_50_month / primecare_elite_100_month / ins_supp_60_month when amount is known.',
  },
  {
    typeKey: 'nowlongevity',
    displayName: 'NOWLongevity.Care',
    monthlyAmountUsd: null, // varies
    clinic: 'longevity',
    billingSource: 'healthie',
    status: 'current',
    notes: 'Pelleting / EvexiPel. Per-visit + occasional package billing.',
  },
  {
    typeKey: 'nowmentalhealth',
    displayName: 'NOWMentalHealth.Care',
    monthlyAmountUsd: null,
    clinic: 'mental_health',
    billingSource: 'healthie',
    status: 'unused',
    notes: 'Defined in lookup but 0 active patients. Skip in classifier output until populated.',
  },
  {
    typeKey: 'abxtac',
    displayName: 'ABXTAC',
    monthlyAmountUsd: null, // 3 tiers: $39/$89/$179 per reference_abxtac_healthie_offerings.md
    clinic: 'abxtac',
    billingSource: 'healthie',
    status: 'unused',
    notes: 'ABXTac has 3 tiers (Heal $39 / Optimize $89 / Thrive $179). 0 patients currently classified here — most ABXTac patients are tagged nowmenshealth (since Rx ships through MH).',
  },

  // === CURRENT (Primary Care tiers — keep these, $ × clinic encoded) ===
  {
    typeKey: 'primecare_premier_50_month',
    displayName: 'PrimeCare Premier $50/Month',
    monthlyAmountUsd: 50,
    clinic: 'primary_care',
    billingSource: 'healthie', // assumed; could be qbo legacy
    status: 'current',
  },
  {
    typeKey: 'ins_supp_60_month',
    displayName: 'Ins. Supp. $60/Month',
    monthlyAmountUsd: 60,
    clinic: 'primary_care',
    billingSource: 'healthie',
    status: 'current',
  },
  {
    typeKey: 'primecare_elite_100_month',
    displayName: 'PrimeCare Elite $100/Month',
    monthlyAmountUsd: 100,
    clinic: 'primary_care',
    billingSource: 'healthie',
    status: 'current',
  },

  // === SPECIAL — flag-driven, not amount-driven ===
  {
    typeKey: 'approved_disc_pro_bono_pt',
    displayName: 'Approved Disc / Pro-Bono PT',
    monthlyAmountUsd: 0,
    clinic: 'any',
    billingSource: 'none',
    status: 'current',
    notes: 'Set by is_pro_bono flag. Wins over all other rules per project_hardening_plan_decisions.md.',
  },
  {
    typeKey: 'sick_visit',
    displayName: 'Sick Visit',
    monthlyAmountUsd: null,
    clinic: 'any',
    billingSource: 'none',
    status: 'current',
    notes: 'No recurring; visit-based only (Stripe direct charges, no Healthie subscription).',
  },
  {
    typeKey: 'other',
    displayName: 'Other',
    monthlyAmountUsd: null,
    clinic: 'any',
    billingSource: 'none',
    status: 'current',
    notes: 'Fallback when no signal at all. Low confidence — should rarely be used.',
  },

  // === LEGACY (QBO & Jane sunsetting per project_quickbooks_sunset.md) ===
  {
    typeKey: 'qbo_tcmh_180_month',
    displayName: 'QBO TCMH $180/Month',
    monthlyAmountUsd: 180,
    clinic: 'mens_health',
    billingSource: 'qbo',
    status: 'legacy',
    notes: 'QBO sunsetting — replace with nowmenshealth as patients migrate to Healthie recurring.',
  },
  {
    typeKey: 'jane_tcmh_180_month',
    displayName: 'Jane TCMH $180/Month',
    monthlyAmountUsd: 180,
    clinic: 'mens_health',
    billingSource: 'jane',
    status: 'legacy',
    notes: 'Jane sunsetting — replace with nowmenshealth as patients migrate.',
  },
  {
    typeKey: 'qbo_f_f_fr_veteran_140_month',
    displayName: 'QBO F&F/FR/Veteran $140/Month',
    monthlyAmountUsd: 140,
    clinic: 'mens_health',
    billingSource: 'qbo',
    status: 'legacy',
  },
  {
    typeKey: 'jane_f_f_fr_veteran_140_month',
    displayName: 'Jane F&F/FR/Veteran $140/Month',
    monthlyAmountUsd: 140,
    clinic: 'mens_health',
    billingSource: 'jane',
    status: 'legacy',
  },
  {
    typeKey: 'mens_health_qbo',
    displayName: "Men's Health (QBO)",
    monthlyAmountUsd: null,
    clinic: 'mens_health',
    billingSource: 'qbo',
    status: 'legacy',
    notes: '0 active patients. Pre-Healthie QBO men\'s health bucket.',
  },

  // === MIXED / EDGE ===
  {
    typeKey: 'mixed_primcare_jane_qbo_tcmh',
    displayName: 'Mixed Primcare (Jane) | QBO TCMH',
    monthlyAmountUsd: null,
    clinic: 'primary_care',
    billingSource: 'jane',
    status: 'legacy',
    notes: 'TYPO duplicate of mixed_primecare_jane_qbo_tcmh — recommend deprecate after migration. 0 active patients.',
  },
  {
    typeKey: 'mixed_primecare_jane_qbo_tcmh',
    displayName: 'Mixed - Primecare (Jane) | QBO TCMH',
    monthlyAmountUsd: null,
    clinic: 'primary_care',
    billingSource: 'jane',
    status: 'legacy',
    notes: 'Patient pays for Primary Care via Jane AND TCMH membership via QBO. 0 active patients.',
  },
];

/**
 * Quick lookup: type_key → mapping row.
 */
export const CLIENT_TYPE_BY_KEY: Record<string, ClientTypeMappingRow> = Object.fromEntries(
  CLIENT_TYPE_MAPPING.map(m => [m.typeKey, m])
);

/**
 * Pick the best `type_key` for a (clinic, monthlyAmountUsd) combo.
 * Returns `null` if no clear match — caller decides fallback.
 *
 * Rules:
 *   - exact $ amount match wins
 *   - clinic must match or be 'any'
 *   - 'current' status preferred over 'legacy' (we want forward-looking values)
 *   - amongst current matches, healthie billingSource preferred
 */
export function pickByAmountAndClinic(
  clinic: ClientTypeClinic,
  monthlyAmountUsd: number | null
): ClientTypeMappingRow | null {
  if (monthlyAmountUsd == null) return null;

  const candidates = CLIENT_TYPE_MAPPING.filter(m =>
    m.monthlyAmountUsd === monthlyAmountUsd &&
    (m.clinic === clinic || m.clinic === 'any') &&
    m.status !== 'unused'
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Tie-break: current > legacy, then healthie > others
  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'current' ? -1 : 1;
    if (a.billingSource !== b.billingSource) return a.billingSource === 'healthie' ? -1 : 1;
    return 0;
  });
  return candidates[0];
}

/**
 * Map our internal clinic strings (patients.clinic) to the canonical ClientTypeClinic.
 * Patients table uses values like "nowmenshealth.care", "nowprimary.care", or NULL.
 */
export function normalizeClinic(raw: string | null | undefined): ClientTypeClinic | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('menshealth')) return 'mens_health';
  if (s.includes('primary')) return 'primary_care';
  if (s.includes('longevity')) return 'longevity';
  if (s.includes('mental')) return 'mental_health';
  if (s.includes('abxtac')) return 'abxtac';
  return null;
}

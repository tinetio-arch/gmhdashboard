export const TESTOSTERONE_VENDORS = [
  'Carrie Boyd - Testosterone Miglyol 812 Oil Injection 200mg/ml (Pre-Filled Syringes) - 30 ML Vials',
  'TopRX (Testosterone Cypionate Cottonseed Oil (200mg/ml) - 10 ML Vials)'
] as const;

export const DEFAULT_TESTOSTERONE_VENDOR = TESTOSTERONE_VENDORS[0];
export const DEFAULT_TESTOSTERONE_PRESCRIBER = 'Dr. Whitten NMD';
export const DEFAULT_TESTOSTERONE_DEA_SCHEDULE = 'Schedule III';
export const DEFAULT_TESTOSTERONE_DEA_CODE = '4000';

export function normalizeTestosteroneVendor(
  candidate: string | null | undefined
): (typeof TESTOSTERONE_VENDORS)[number] | null {
  if (!candidate) {
    return null;
  }
  const value = candidate.trim().toLowerCase();
  if (!value) {
    return null;
  }
  const exactMatch = TESTOSTERONE_VENDORS.find((vendor) => vendor.toLowerCase() === value);
  if (exactMatch) {
    return exactMatch;
  }
  if (value.includes('toprx') || value.includes('cottonseed')) {
    return TESTOSTERONE_VENDORS[1];
  }
  if (value.includes('carrie') || value.includes('miglyol') || value.includes('pre-filled')) {
    return TESTOSTERONE_VENDORS[0];
  }
  return null;
}


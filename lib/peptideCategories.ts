/**
 * Therapeutic Peptide Categories
 *
 * Shared category definitions used by:
 *   - iPad billing/woo-products API
 *   - Headless/products API (patient app)
 *   - iPad ship-to-patient UI (filter tabs)
 *   - Headless/checkout (requiresApproval check)
 *
 * Category slugs must match WooCommerce category slugs on abxtac.com.
 */

export interface TherapeuticCategory {
  slug: string;
  label: string;
  shortLabel: string;   // For compact filter tabs
  color: string;
  requiresApproval: boolean;  // If true, patient-app orders go to pending review
  sortOrder: number;
}

export const THERAPEUTIC_CATEGORIES: TherapeuticCategory[] = [
  { slug: 'healing-tissue-repair', label: 'Healing & Tissue Repair', shortLabel: 'Healing',      color: '#10b981', requiresApproval: false, sortOrder: 1 },
  { slug: 'weight-management',     label: 'Weight Management',       shortLabel: 'Weight Loss',   color: '#f59e0b', requiresApproval: true,  sortOrder: 2 },
  { slug: 'sexual-health',         label: 'Sexual Health',           shortLabel: 'Sexual Health', color: '#ec4899', requiresApproval: false, sortOrder: 3 },
  { slug: 'cognitive-neuro',       label: 'Cognitive & Neuro',       shortLabel: 'Cognitive',     color: '#8b5cf6', requiresApproval: false, sortOrder: 4 },
  { slug: 'anti-aging-longevity',  label: 'Anti-Aging & Longevity',  shortLabel: 'Anti-Aging',    color: '#06b6d4', requiresApproval: false, sortOrder: 5 },
  { slug: 'growth-hormone',        label: 'Growth Hormone',          shortLabel: 'GH',            color: '#3b82f6', requiresApproval: false, sortOrder: 6 },
  { slug: 'sleep-recovery',        label: 'Sleep & Recovery',        shortLabel: 'Sleep',         color: '#6366f1', requiresApproval: false, sortOrder: 7 },
  { slug: 'immune-support',        label: 'Immune Support',          shortLabel: 'Immune',        color: '#14b8a6', requiresApproval: false, sortOrder: 8 },
  { slug: 'body-composition',      label: 'Body Composition',        shortLabel: 'Body Comp',     color: '#f97316', requiresApproval: false, sortOrder: 9 },
  { slug: 'vitamins',              label: 'Vitamins',                shortLabel: 'Vitamins',      color: '#84cc16', requiresApproval: false, sortOrder: 10 },
  { slug: 'supplies',              label: 'Supplies',                shortLabel: 'Supplies',      color: '#a1a1aa', requiresApproval: false, sortOrder: 11 },
];

// BioBox is handled separately (existing system), not a therapeutic category
export const BIOBOX_SLUG = 'biobox-lab-tests';

// Supply Kit SKU — triggers staff task on order
export const SUPPLY_KIT_SKU = 'YPB.290';

/**
 * Resolve a product's therapeutic category from its WooCommerce category slugs.
 * Returns the first matching therapeutic category, or null if none match (e.g. BioBox).
 */
export function resolveTherapeuticCategory(wcCategorySlugs: string[]): TherapeuticCategory | null {
  for (const cat of THERAPEUTIC_CATEGORIES) {
    if (wcCategorySlugs.includes(cat.slug)) {
      return cat;
    }
  }
  return null;
}

/**
 * Check if any items in a cart require staff approval (patient-app orders only).
 */
export function cartRequiresApproval(items: Array<{ therapeutic_category_slug?: string }>): boolean {
  return items.some(item => {
    const cat = THERAPEUTIC_CATEGORIES.find(c => c.slug === item.therapeutic_category_slug);
    return cat?.requiresApproval === true;
  });
}

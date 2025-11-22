import { query } from './db';
import { TESTOSTERONE_VENDORS, normalizeTestosteroneVendor } from './testosterone';

export type TestosteroneInventory = {
  vendor: string;
  activeVials: number;
  totalRemainingMl: number;
  lowInventory: boolean;
};

export async function getTestosteroneInventoryByVendor(): Promise<TestosteroneInventory[]> {
  // Query all active vials
  const vials = await query<{
    external_id: string | null;
    size_ml: string | null;
    remaining_volume_ml: string | null;
    dea_drug_name: string | null;
    notes: string | null;
  }>(`
    SELECT 
      external_id,
      size_ml,
      remaining_volume_ml,
      dea_drug_name,
      notes
    FROM vials
    WHERE status = 'Active'
      AND controlled_substance = true
  `);

  // Group by vendor
  const inventoryByVendor: Record<string, { count: number; totalMl: number }> = {};

  for (const vial of vials) {
    // Try to determine vendor from various fields
    let vendor: string | null = null;
    
    // Check dea_drug_name first
    if (vial.dea_drug_name) {
      vendor = normalizeTestosteroneVendor(vial.dea_drug_name);
    }
    
    // Check notes if no vendor found
    if (!vendor && vial.notes) {
      vendor = normalizeTestosteroneVendor(vial.notes);
    }
    
    // Use size as a fallback to guess vendor
    if (!vendor && vial.size_ml) {
      const sizeMl = parseFloat(vial.size_ml);
      if (!isNaN(sizeMl)) {
        if (sizeMl >= 20) {
          vendor = TESTOSTERONE_VENDORS[0]; // Carrie Boyd - 30ML
        } else if (sizeMl > 0) {
          vendor = TESTOSTERONE_VENDORS[1]; // TopRX - 10ML
        }
      }
    }
    
    // Skip if we couldn't determine vendor
    if (!vendor) continue;
    
    // Initialize vendor entry if needed
    if (!inventoryByVendor[vendor]) {
      inventoryByVendor[vendor] = { count: 0, totalMl: 0 };
    }
    
    // Add to counts
    inventoryByVendor[vendor].count++;
    
    const remainingMl = parseFloat(vial.remaining_volume_ml || '0');
    if (!isNaN(remainingMl)) {
      inventoryByVendor[vendor].totalMl += remainingMl;
    }
  }

  // Convert to array and add all vendors (even with 0 count)
  const results: TestosteroneInventory[] = [];
  
  for (const vendor of TESTOSTERONE_VENDORS) {
    const inventory = inventoryByVendor[vendor] || { count: 0, totalMl: 0 };
    results.push({
      vendor,
      activeVials: inventory.count,
      totalRemainingMl: Math.round(inventory.totalMl * 10) / 10, // Round to 1 decimal
      lowInventory: inventory.count <= 10
    });
  }

  return results;
}

// Get payment failure stats split by Jane and QuickBooks
export type PaymentFailureStats = {
  jane: {
    count: number;
    totalAmount: number;
  };
  quickbooks: {
    count: number;
    totalAmount: number;
  };
};

export async function getPaymentFailureStats(): Promise<PaymentFailureStats> {
  // Get Jane payment failures from clinicsync_memberships
  const janeFailures = await query<{ count: string; total: string }>(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(COALESCE(amount_due, balance_owing, 0)), 0) as total
    FROM clinicsync_memberships cm
    JOIN patients p ON cm.patient_id = p.patient_id
    WHERE cm.is_active = true
      AND (cm.amount_due > 0 OR cm.balance_owing > 0)
      AND p.status_key NOT IN ('inactive', 'discharged')
      AND (p.payment_method_key = 'jane' OR p.payment_method_key IS NULL)
  `);

  // Get QuickBooks payment failures from payment_issues
  const qboFailures = await query<{ count: string; total: string }>(`
    SELECT 
      COUNT(DISTINCT pi.patient_id) as count,
      COALESCE(SUM(pi.amount_owed), 0) as total
    FROM payment_issues pi
    JOIN patients p ON pi.patient_id = p.patient_id
    WHERE pi.resolved_at IS NULL
      AND p.status_key NOT IN ('inactive', 'discharged')
      AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
      AND pi.issue_type IN ('payment_declined', 'payment_failed', 'insufficient_funds')
  `);

  return {
    jane: {
      count: parseInt(janeFailures[0]?.count || '0'),
      totalAmount: parseFloat(janeFailures[0]?.total || '0')
    },
    quickbooks: {
      count: parseInt(qboFailures[0]?.count || '0'),
      totalAmount: parseFloat(qboFailures[0]?.total || '0')
    }
  };
}

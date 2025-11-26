import { query } from './db';
import { TESTOSTERONE_VENDORS, normalizeTestosteroneVendor } from './testosterone';

export type TestosteroneInventory = {
  vendor: string;
  activeVials: number;
  totalRemainingMl: number;
  lowInventory: boolean;
  vialDetails?: {
    externalId: string;
    remainingMl: number;
    isDispensing: boolean;
    deaDrugName: string | null;
  }[];
};

export async function getTestosteroneInventoryByVendor(): Promise<TestosteroneInventory[]> {
  // Query only active vials with remaining volume > 0 (actual usable inventory)
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
      AND remaining_volume_ml IS NOT NULL
      AND remaining_volume_ml::numeric > 0
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

  // Get dispense information to see which vials are actively being used
  const activeDispenses = await query<{ vial_external_id: string }>(`
    SELECT DISTINCT d.vial_external_id
    FROM dispenses d
    JOIN vials v ON v.vial_id = d.vial_id
    WHERE d.dispense_date >= CURRENT_DATE - INTERVAL '30 days'
      AND v.status = 'Active'
      AND v.controlled_substance = true
      AND v.remaining_volume_ml IS NOT NULL
      AND v.remaining_volume_ml::numeric > 0
  `).catch(() => []);

  const dispensingVialIds = new Set(activeDispenses.map(d => d.vial_external_id).filter(Boolean));

  // Group vials by vendor with details
  const vialsByVendor: Record<string, {
    count: number;
    totalMl: number;
    vials: Array<{
      externalId: string;
      remainingMl: number;
      isDispensing: boolean;
      deaDrugName: string | null;
    }>;
  }> = {};

  for (const vial of vials) {
    let vendor: string | null = null;
    
    if (vial.dea_drug_name) {
      vendor = normalizeTestosteroneVendor(vial.dea_drug_name);
    }
    
    if (!vendor && vial.notes) {
      vendor = normalizeTestosteroneVendor(vial.notes);
    }
    
    if (!vendor && vial.size_ml) {
      const sizeMl = parseFloat(vial.size_ml);
      if (!isNaN(sizeMl)) {
        if (sizeMl >= 20) {
          vendor = TESTOSTERONE_VENDORS[0];
        } else if (sizeMl > 0) {
          vendor = TESTOSTERONE_VENDORS[1];
        }
      }
    }
    
    if (!vendor) continue;
    
    if (!vialsByVendor[vendor]) {
      vialsByVendor[vendor] = { count: 0, totalMl: 0, vials: [] };
    }
    
    vialsByVendor[vendor].count++;
    const remainingMl = parseFloat(vial.remaining_volume_ml || '0');
    if (!isNaN(remainingMl)) {
      vialsByVendor[vendor].totalMl += remainingMl;
    }
    
    if (vial.external_id) {
      vialsByVendor[vendor].vials.push({
        externalId: vial.external_id,
        remainingMl: !isNaN(remainingMl) ? remainingMl : 0,
        isDispensing: dispensingVialIds.has(vial.external_id),
        deaDrugName: vial.dea_drug_name
      });
    }
  }

  // Convert to array and add all vendors (even with 0 count)
  const results: TestosteroneInventory[] = [];
  
  for (const vendor of TESTOSTERONE_VENDORS) {
    const inventory = vialsByVendor[vendor] || { count: 0, totalMl: 0, vials: [] };
    results.push({
      vendor,
      activeVials: inventory.count,
      totalRemainingMl: Math.round(inventory.totalMl * 10) / 10, // Round to 1 decimal
      lowInventory: inventory.count <= 10,
      vialDetails: inventory.vials.slice(0, 10) // Limit to top 10 for display
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
  // Get Jane payment failures - ONLY actual payment failures from payment_issues table
  // NOT just outstanding balances (those are normal billing cycles)
  let janeFailures: { count: string; total: string }[] = [];
  try {
    janeFailures = await query<{ count: string; total: string }>(`
      SELECT 
        COUNT(DISTINCT pi.patient_id) as count,
        COALESCE(SUM(pi.amount_owed), 0) as total
      FROM payment_issues pi
      INNER JOIN patients p ON pi.patient_id = p.patient_id
      WHERE p.patient_id IS NOT NULL
        AND pi.resolved_at IS NULL
        AND NOT (
          COALESCE(p.status_key, '') ILIKE 'inactive%'
          OR COALESCE(p.status_key, '') ILIKE 'discharg%'
        )
        AND (p.payment_method_key = 'jane' OR p.payment_method_key = 'jane_quickbooks')
        AND pi.issue_type IN ('payment_declined', 'payment_failed', 'insufficient_funds')
    `);
  } catch (error: unknown) {
    // Table doesn't exist yet, return empty results
    console.error('Error fetching Jane payment failures:', error);
    janeFailures = [{ count: '0', total: '0' }];
  }

  // Get QuickBooks payment failures from payment_issues
  // Only count actual payment failures, not just outstanding balances
  let qboFailures: { count: string; total: string }[] = [];
  try {
    qboFailures = await query<{ count: string; total: string }>(`
      SELECT 
        COUNT(DISTINCT pi.patient_id) as count,
        COALESCE(SUM(pi.amount_owed), 0) as total
      FROM payment_issues pi
      INNER JOIN patients p ON pi.patient_id = p.patient_id
      WHERE p.patient_id IS NOT NULL
        AND pi.resolved_at IS NULL
        AND NOT (
          COALESCE(p.status_key, '') ILIKE 'inactive%'
          OR COALESCE(p.status_key, '') ILIKE 'discharg%'
        )
        AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
        AND pi.issue_type IN ('payment_declined', 'payment_failed', 'insufficient_funds')
    `);
  } catch (error: unknown) {
    // Table doesn't exist yet, return empty results
    console.error('Error fetching QuickBooks payment failures:', error);
    qboFailures = [{ count: '0', total: '0' }];
  }

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

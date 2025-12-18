/**
 * Healthie Package Mapper
 * Maps QuickBooks recurring transactions to Healthie packages
 */

import type { QuickBooksRecurringTransaction } from './quickbooks';
import type { HealthiePackage, CreatePackageInput } from './healthie';
import { query } from './db';

export type PackageMapping = {
  qbRecurringId: string;
  qbCustomerId: string;
  amount: number;
  frequency: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  healthiePackageId?: string;
  healthiePackage?: HealthiePackage;
  nextChargeDate?: Date;
};

export type PackageGroup = {
  amount: number;
  frequency: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  qbRecurringIds: string[];
  qbCustomerIds: string[];
  patientCount: number;
  suggestedPackageName: string;
  suggestedDescription: string;
};

/**
 * Convert QuickBooks interval type to Healthie billing frequency
 */
export function mapQBFrequencyToHealthie(
  intervalType?: string,
  numInterval?: number
): 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' {
  if (!intervalType) {
    return 'monthly'; // Default to monthly
  }

  const normalized = intervalType.toLowerCase();
  const interval = numInterval || 1;

  switch (normalized) {
    case 'daily':
      // Daily is not standard in Healthie, map to weekly
      return 'weekly';
    case 'weekly':
      return interval === 2 ? 'biweekly' : 'weekly';
    case 'monthly':
      return 'monthly';
    case 'yearly':
      return interval === 4 ? 'quarterly' : 'yearly';
    default:
      return 'monthly';
  }
}

/**
 * Analyze QuickBooks recurring transactions and group them by amount/frequency
 */
export function groupRecurringTransactions(
  recurringTransactions: QuickBooksRecurringTransaction[]
): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();

  for (const recurring of recurringTransactions) {
    if (!recurring.Active || !recurring.CustomerRef?.value || !recurring.TotalAmt) {
      continue;
    }

    const amount = recurring.TotalAmt;
    const frequency = mapQBFrequencyToHealthie(
      recurring.ScheduleInfo?.IntervalType,
      recurring.ScheduleInfo?.NumInterval
    );

    // Create a key for grouping (amount + frequency)
    const key = `${amount.toFixed(2)}_${frequency}`;

    if (!groups.has(key)) {
      // Generate package name based on amount and frequency
      const packageName = generatePackageName(amount, frequency);
      const description = generatePackageDescription(amount, frequency, recurring.Name);

      groups.set(key, {
        amount,
        frequency,
        qbRecurringIds: [],
        qbCustomerIds: [],
        patientCount: 0,
        suggestedPackageName: packageName,
        suggestedDescription: description,
      });
    }

    const group = groups.get(key)!;
    group.qbRecurringIds.push(recurring.Id);
    if (recurring.CustomerRef.value && !group.qbCustomerIds.includes(recurring.CustomerRef.value)) {
      group.qbCustomerIds.push(recurring.CustomerRef.value);
      group.patientCount++;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.patientCount - a.patientCount);
}

/**
 * Generate a package name based on amount and frequency
 */
function generatePackageName(amount: number, frequency: string): string {
  const amountStr = `$${amount.toFixed(0)}`;
  const frequencyStr = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  return `${amountStr}/${frequencyStr}`;
}

/**
 * Generate package description
 */
function generatePackageDescription(
  amount: number,
  frequency: string,
  qbName?: string
): string {
  const baseDescription = `Recurring payment of $${amount.toFixed(2)} ${frequency}`;
  if (qbName && qbName !== `${amount}/${frequency}`) {
    return `${baseDescription} - ${qbName}`;
  }
  return baseDescription;
}

/**
 * Create package mapping from QuickBooks recurring transaction
 */
export function createPackageMapping(
  recurring: QuickBooksRecurringTransaction
): PackageMapping {
  const amount = recurring.TotalAmt || 0;
  const frequency = mapQBFrequencyToHealthie(
    recurring.ScheduleInfo?.IntervalType,
    recurring.ScheduleInfo?.NumInterval
  );

  const nextChargeDate = recurring.ScheduleInfo?.NextDueDate
    ? new Date(recurring.ScheduleInfo.NextDueDate)
    : undefined;

  return {
    qbRecurringId: recurring.Id,
    qbCustomerId: recurring.CustomerRef?.value || '',
    amount,
    frequency,
    nextChargeDate,
  };
}

/**
 * Get or create Healthie package for a mapping
 */
export async function getOrCreateHealthiePackage(
  mapping: PackageMapping,
  healthieClient: any
): Promise<string> {
  // Check if package already exists in database
  const existing = await query<{ healthie_package_id: string }>(
    `SELECT healthie_package_id 
     FROM healthie_packages 
     WHERE price = $1 
       AND billing_frequency = $2 
       AND is_active = TRUE
     LIMIT 1`,
    [mapping.amount, mapping.frequency]
  );

  if (existing.length > 0) {
    return existing[0].healthie_package_id;
  }

  // Check if package exists in Healthie by name pattern
  const packageName = generatePackageName(mapping.amount, mapping.frequency);
  const healthiePackages = await healthieClient.getPackages();
  const matchingPackage = healthiePackages.find(
    (p: HealthiePackage) =>
      Math.abs((p.price || 0) - mapping.amount) < 0.01 &&
      p.billing_frequency === mapping.frequency
  );

  if (matchingPackage) {
    // Store in database for future reference
    await query(
      `INSERT INTO healthie_packages (
        healthie_package_id, name, description, price, billing_frequency, is_active
      ) VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (healthie_package_id) DO UPDATE SET is_active = TRUE`,
      [
        matchingPackage.id,
        matchingPackage.name || packageName,
        matchingPackage.description || '',
        mapping.amount,
        mapping.frequency,
      ]
    );
    return matchingPackage.id;
  }

  // Create new package in Healthie
  const packageInput: CreatePackageInput = {
    name: packageName,
    description: generatePackageDescription(mapping.amount, mapping.frequency),
    price: mapping.amount,
    billing_frequency: mapping.frequency,
  };

  const newPackage = await healthieClient.createPackage(packageInput);

  // Store in database
  await query(
    `INSERT INTO healthie_packages (
      healthie_package_id, name, description, price, billing_frequency, is_active
    ) VALUES ($1, $2, $3, $4, $5, TRUE)
    ON CONFLICT (healthie_package_id) DO UPDATE SET is_active = TRUE`,
    [
      newPackage.id,
      newPackage.name,
      newPackage.description || '',
      mapping.amount,
      mapping.frequency,
    ]
  );

  return newPackage.id;
}

/**
 * Get existing package mappings from database
 */
export async function getExistingPackageMappings(): Promise<
  Array<{
    qb_recurring_transaction_id: string;
    qb_customer_id: string;
    healthie_package_id: string;
    amount: number;
    frequency: string;
  }>
> {
  return query(
    `SELECT 
      qb_recurring_transaction_id,
      qb_customer_id,
      healthie_package_id,
      amount,
      frequency
     FROM healthie_package_mapping
     WHERE is_active = TRUE`
  );
}



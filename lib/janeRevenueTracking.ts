/**
 * Historical Jane Revenue Tracking
 * Tracks webhook changes over time to calculate accurate daily payments
 */

import { query } from './db';

export type JaneRevenueSnapshot = {
  snapshotId: string;
  patientId: string;
  clinicsyncPatientId: string;
  snapshotDate: Date;
  totalPaymentAmount: number;
  totalPayments: number;
  totalPurchased: number;
  outstandingBalance: number;
  totalVisits: number;
  webhookTimestamp: Date | null;
};

/**
 * Store a revenue snapshot for a patient
 * This allows us to track changes in revenue over time
 */
export async function storeRevenueSnapshot(
  patientId: string,
  clinicsyncPatientId: string,
  totalPaymentAmount: number,
  totalPayments: number,
  totalPurchased: number,
  outstandingBalance: number,
  totalVisits: number,
  webhookTimestamp?: Date
): Promise<void> {
  await query(
    `INSERT INTO jane_revenue_snapshots 
     (patient_id, clinicsync_patient_id, total_payment_amount, total_payments, 
      total_purchased, outstanding_balance, total_visits, webhook_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (patient_id, snapshot_date, clinicsync_patient_id) 
     DO UPDATE SET
       total_payment_amount = EXCLUDED.total_payment_amount,
       total_payments = EXCLUDED.total_payments,
       total_purchased = EXCLUDED.total_purchased,
       outstanding_balance = EXCLUDED.outstanding_balance,
       total_visits = EXCLUDED.total_visits,
       webhook_timestamp = EXCLUDED.webhook_timestamp`,
    [
      patientId,
      clinicsyncPatientId,
      totalPaymentAmount,
      totalPayments,
      totalPurchased,
      outstandingBalance,
      totalVisits,
      webhookTimestamp || new Date()
    ]
  );
}

/**
 * Get revenue change between two snapshots
 * Returns the difference in payment amount, which represents revenue for that day
 */
export async function getRevenueChange(
  patientId: string,
  clinicsyncPatientId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string;
  revenueChange: number;
  visitsChange: number;
}>> {
  const snapshots = await query<{
    snapshot_date: Date;
    total_payment_amount: number;
    total_visits: number;
  }>(
    `SELECT snapshot_date, total_payment_amount, total_visits
     FROM jane_revenue_snapshots
     WHERE patient_id = $1 AND clinicsync_patient_id = $2
       AND snapshot_date >= $3 AND snapshot_date <= $4
     ORDER BY snapshot_date ASC`,
    [patientId, clinicsyncPatientId, startDate, endDate]
  );

  const changes: Array<{
    date: string;
    revenueChange: number;
    visitsChange: number;
  }> = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const revenueChange = curr.total_payment_amount - prev.total_payment_amount;
    const visitsChange = curr.total_visits - prev.total_visits;

    if (revenueChange > 0) {
      const date = new Date(curr.snapshot_date).toISOString().split('T')[0];
      changes.push({
        date,
        revenueChange,
        visitsChange
      });
    }
  }

  return changes;
}

/**
 * Calculate accurate daily revenue from snapshot changes
 */
export async function getAccurateDailyRevenue(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string;
  revenue: number;
  paymentCount: number;
  patientCount: number;
}>> {
  // Get all Jane patients
  const patients = await query<{
    patient_id: string;
    clinicsync_patient_id: string | null;
  }>(
    `SELECT DISTINCT p.patient_id, cm.clinicsync_patient_id
     FROM patients p
     INNER JOIN patient_clinicsync_mapping cm ON cm.patient_id = p.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL`
  );

  // Aggregate revenue changes by date
  const dailyRevenue = new Map<string, { revenue: number; payments: number; patients: Set<string> }>();

  for (const patient of patients) {
    if (!patient.clinicsync_patient_id) continue;

    const changes = await getRevenueChange(
      patient.patient_id,
      patient.clinicsync_patient_id,
      startDate,
      endDate
    );

    changes.forEach(change => {
      if (!dailyRevenue.has(change.date)) {
        dailyRevenue.set(change.date, { revenue: 0, payments: 0, patients: new Set() });
      }

      const day = dailyRevenue.get(change.date)!;
      day.revenue += change.revenueChange;
      day.payments += change.visitsChange > 0 ? 1 : 0;
      day.patients.add(patient.patient_id);
    });
  }

  // Convert to array and sort
  return Array.from(dailyRevenue.entries())
    .map(([date, data]) => ({
      date,
      revenue: data.revenue,
      paymentCount: data.payments,
      patientCount: data.patients.size
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}






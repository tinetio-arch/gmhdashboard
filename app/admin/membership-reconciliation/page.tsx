export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { createQuickBooksClient } from '@/lib/quickbooks';
import MembershipReconciliationClient from './MembershipReconciliationClient';

type QuickBooksRecurringPatient = {
  qbCustomerId: string;
  customerName: string;
  recurringTemplate: string | null;
  amount: number;
  nextChargeDate: string | null;
  isActive: boolean;
  matchedPatientId: string | null;
  matchedPatientName: string | null;
};

type MissingFromSheet = {
  qbCustomerId: string;
  customerName: string;
  recurringTemplate: string | null;
  amount: number;
  nextChargeDate: string | null;
  reason: 'not_in_sheet' | 'no_jane_membership' | 'payment_method_mismatch';
};

type ReconciliationData = {
  quickbooksConnected: boolean;
  totalRecurringInQB: number;
  totalInPatientSheet: number;
  missingFromSheet: MissingFromSheet[];
  recurringPatients: QuickBooksRecurringPatient[];
};

export default async function MembershipReconciliationPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  // Get QuickBooks recurring customers
  let quickbooksConnected = false;
  const recurringPatients: QuickBooksRecurringPatient[] = [];
  const missingFromSheet: MissingFromSheet[] = [];

  try {
    const qbClient = await createQuickBooksClient();
    if (qbClient) {
      quickbooksConnected = true;
      
      // Get all recurring transactions from QuickBooks
      const recurringTransactions = await qbClient.getRecurringTransactions();
      
      // Filter for active sales receipts (these are the recurring memberships)
      const activeRecurring = recurringTransactions.filter(
        rt => rt.Active && rt.Type === 'SalesReceipt'
      );

      // Get patient mappings and sheet data
      const mappingQuery = await query<{
        qb_customer_id: string;
        qb_customer_name: string;
        patient_id: string | null;
        patient_name: string | null;
        payment_method: string | null;
        has_jane_membership: boolean;
      }>(`
        WITH qb_mappings AS (
          SELECT 
            qm.qb_customer_id,
            qm.qb_customer_name,
            qm.patient_id,
            p.full_name as patient_name,
            p.payment_method_key as payment_method
          FROM patient_qb_mapping qm
          LEFT JOIN patients p ON p.patient_id = qm.patient_id
          WHERE qm.is_active = TRUE
        ),
        jane_memberships AS (
          SELECT DISTINCT patient_id
          FROM clinicsync_memberships
          WHERE is_active = TRUE
        )
        SELECT 
          qm.*,
          CASE WHEN jm.patient_id IS NOT NULL THEN TRUE ELSE FALSE END as has_jane_membership
        FROM qb_mappings qm
        LEFT JOIN jane_memberships jm ON jm.patient_id = qm.patient_id
      `);

      const mappingsByCustomerId = new Map(
        mappingQuery.map(m => [m.qb_customer_id, m])
      );

      // Process each recurring transaction
      for (const rt of activeRecurring) {
        if (!rt.CustomerRef) continue;
        
        const mapping = mappingsByCustomerId.get(rt.CustomerRef.value);
        
        const recurringPatient: QuickBooksRecurringPatient = {
          qbCustomerId: rt.CustomerRef.value,
          customerName: rt.CustomerRef.name ?? 'Unknown',
          recurringTemplate: rt.Name,
          amount: rt.TotalAmt ?? 0,
          nextChargeDate: rt.ScheduleInfo?.NextDueDate ?? null,
          isActive: rt.Active,
          matchedPatientId: mapping?.patient_id ?? null,
          matchedPatientName: mapping?.patient_name ?? null
        };

        recurringPatients.push(recurringPatient);

        // Check if missing from sheet
        if (!mapping?.patient_id) {
          missingFromSheet.push({
            ...recurringPatient,
            reason: 'not_in_sheet'
          });
        } else if ((mapping.payment_method === 'jane' || mapping.payment_method === 'jane_quickbooks') && !mapping.has_jane_membership) {
          missingFromSheet.push({
            ...recurringPatient,
            reason: 'no_jane_membership'
          });
        } else if (mapping.payment_method !== 'quickbooks' && mapping.payment_method !== 'qbo' && mapping.payment_method !== 'jane_quickbooks') {
          missingFromSheet.push({
            ...recurringPatient,
            reason: 'payment_method_mismatch'
          });
        }
      }
    }
  } catch (error) {
    console.error('Error fetching QuickBooks data:', error);
  }

  // Get total patients in sheet
  const [totalPatientsResult] = await query<{ count: string }>(`
    SELECT COUNT(*) as count FROM patients WHERE status_key = 'active'
  `);
  const totalInPatientSheet = parseInt(totalPatientsResult?.count ?? '0');

  const data: ReconciliationData = {
    quickbooksConnected,
    totalRecurringInQB: recurringPatients.length,
    totalInPatientSheet,
    missingFromSheet,
    recurringPatients
  };

  return <MembershipReconciliationClient data={data} />;
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

const QUICKBOOKS_METHOD_FILTER = `
  (
    COALESCE(p.payment_method_key, '') IN ('quickbooks', 'qbo', 'jane_quickbooks')
    OR LOWER(COALESCE(p.payment_method, '')) LIKE '%quickbook%'
  )
`;

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    // Get revenue metrics
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Daily revenue (payments received today)
    const dailyInvoiceRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfToday]);
    const dailyReceiptRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM quickbooks_sales_receipts
      WHERE receipt_date = $1
    `, [startOfToday]);

    // Weekly revenue
    const weeklyInvoiceRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfWeek]);
    const weeklyReceiptRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM quickbooks_sales_receipts
      WHERE receipt_date >= $1 AND receipt_date < $2
    `, [startOfWeek, new Date(startOfWeek.getTime() + 7 * 86400000)]);

    // Monthly revenue
    const monthlyInvoiceRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfMonth]);
    const monthlyReceiptRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM quickbooks_sales_receipts
      WHERE receipt_date >= $1 AND receipt_date < $2
    `, [startOfMonth, new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1)]);

    // Payment issues count
    const paymentIssues = await query<{ count: number }>(`
      SELECT COUNT(*) as count
      FROM payment_issues
      WHERE resolved_at IS NULL
    `);

    // Unmatched patients (patients with QuickBooks payment method but no QBO mapping)
    const unmatchedPatients = await query<{ count: number }>(`
      SELECT COUNT(*) as count
      FROM patients p
      WHERE ${QUICKBOOKS_METHOD_FILTER}
      AND NOT EXISTS (
        SELECT 1 FROM patient_qb_mapping m
        WHERE m.patient_id = p.patient_id AND m.is_active = TRUE
      )
    `);

    // Total patients on recurring (have active QBO mapping)
    const totalPatientsOnRecurring = await query<{ count: number }>(`
      SELECT COUNT(DISTINCT p.patient_id) as count
      FROM patients p
      JOIN patient_qb_mapping m ON m.patient_id = p.patient_id AND m.is_active = TRUE
      WHERE ${QUICKBOOKS_METHOD_FILTER}
    `);

    return NextResponse.json({
      dailyRevenue:
        parseFloat(dailyInvoiceRevenue[0]?.total?.toString() || '0') +
        parseFloat(dailyReceiptRevenue[0]?.total?.toString() || '0'),
      weeklyRevenue:
        parseFloat(weeklyInvoiceRevenue[0]?.total?.toString() || '0') +
        parseFloat(weeklyReceiptRevenue[0]?.total?.toString() || '0'),
      monthlyRevenue:
        parseFloat(monthlyInvoiceRevenue[0]?.total?.toString() || '0') +
        parseFloat(monthlyReceiptRevenue[0]?.total?.toString() || '0'),
      paymentIssues: parseInt(paymentIssues[0]?.count?.toString() || '0'),
      unmatchedPatients: parseInt(unmatchedPatients[0]?.count?.toString() || '0'),
      totalPatientsOnRecurring: parseInt(totalPatientsOnRecurring[0]?.count?.toString() || '0'),
    });
  } catch (error) {
    console.error('Error fetching QuickBooks metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}

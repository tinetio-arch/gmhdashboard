import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    // Get revenue metrics
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Daily revenue (payments received today)
    const dailyRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfToday]);

    // Weekly revenue
    const weeklyRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfWeek]);

    // Monthly revenue
    const monthlyRevenue = await query<{ total: number }>(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM quickbooks_payments
      WHERE qb_sync_date >= $1 AND amount_paid > 0
    `, [startOfMonth]);

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
      WHERE p.payment_method_key = 'quickbooks'
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
      WHERE p.payment_method_key = 'quickbooks'
    `);

    return NextResponse.json({
      dailyRevenue: parseFloat(dailyRevenue[0]?.total?.toString() || '0'),
      weeklyRevenue: parseFloat(weeklyRevenue[0]?.total?.toString() || '0'),
      monthlyRevenue: parseFloat(monthlyRevenue[0]?.total?.toString() || '0'),
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

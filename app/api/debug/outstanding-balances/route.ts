import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser('admin');
    
    const searchParams = request.nextUrl.searchParams;
    const patientId = searchParams.get('id');
    const patientName = searchParams.get('name') || '';
    
    // If no ID or name, return all QuickBooks outstanding balances + patients that should be included
    if (!patientId && !patientName) {
      const allOutstanding = await query<{
        patient_id: string;
        patient_name: string;
        payment_method_key: string;
        status_key: string;
        qb_balance: number;
        sales_receipt_balance: number;
        payment_issue_balance: number;
      }>(
        `WITH sales_receipt_balances AS (
          SELECT
            patient_id,
            SUM(amount) AS total_receipt_balance
          FROM quickbooks_sales_receipts
          WHERE amount > 0
            AND LOWER(COALESCE(status, '')) IN ('unknown', 'declined', 'error', 'failed', 'rejected')
          GROUP BY patient_id
        ),
        payment_issue_totals AS (
          SELECT
            patient_id,
            SUM(amount_owed) AS total_issue_amount
          FROM payment_issues
          WHERE resolved_at IS NULL
            AND amount_owed > 0
            AND issue_type IN (
              'payment_declined', 
              'payment_failed', 
              'insufficient_funds',
              'failed_payment',
              'overdue_invoice',
              'outstanding_balance'
            )
          GROUP BY patient_id
        )
        SELECT
          p.patient_id,
          p.full_name AS patient_name,
          p.payment_method_key,
          p.status_key,
          GREATEST(
            COALESCE(pit.total_issue_amount, 0),
            COALESCE(srb.total_receipt_balance, 0)
          ) AS qb_balance,
          COALESCE(srb.total_receipt_balance, 0) AS sales_receipt_balance,
          COALESCE(pit.total_issue_amount, 0) AS payment_issue_balance
        FROM patients p
        LEFT JOIN payment_issue_totals pit ON p.patient_id = pit.patient_id
        LEFT JOIN sales_receipt_balances srb ON p.patient_id = srb.patient_id
        WHERE p.patient_id IS NOT NULL
          -- Include patients with QuickBooks payment method OR patients with QuickBooks sales receipts/payment issues
          AND (
            p.payment_method_key IN ('qbo', 'quickbooks') 
            OR p.payment_method_key = 'jane_quickbooks'
            OR EXISTS (SELECT 1 FROM quickbooks_sales_receipts WHERE patient_id = p.patient_id)
            OR EXISTS (SELECT 1 FROM payment_issues WHERE patient_id = p.patient_id AND resolved_at IS NULL)
          )
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
          AND (
            COALESCE(pit.total_issue_amount, 0) > 0
            OR COALESCE(srb.total_receipt_balance, 0) > 0
          )
        ORDER BY qb_balance DESC
        LIMIT 50`
      );

      // Also check for Kyle and Zachary specifically to see why they're not included
      const kyleZachary = await query<{
        patient_id: string;
        full_name: string;
        payment_method_key: string | null;
        status_key: string | null;
        has_sales_receipts: boolean;
        has_payment_issues: boolean;
        sales_receipt_count: number;
        payment_issue_count: number;
      }>(
        `SELECT
          p.patient_id,
          p.full_name,
          p.payment_method_key,
          p.status_key,
          EXISTS(SELECT 1 FROM quickbooks_sales_receipts WHERE patient_id = p.patient_id) AS has_sales_receipts,
          EXISTS(SELECT 1 FROM payment_issues WHERE patient_id = p.patient_id AND resolved_at IS NULL) AS has_payment_issues,
          (SELECT COUNT(*) FROM quickbooks_sales_receipts WHERE patient_id = p.patient_id) AS sales_receipt_count,
          (SELECT COUNT(*) FROM payment_issues WHERE patient_id = p.patient_id AND resolved_at IS NULL) AS payment_issue_count
        FROM patients p
        WHERE LOWER(p.full_name) LIKE '%kyle%dreher%'
           OR LOWER(p.full_name) LIKE '%zachary%latham%'
        LIMIT 10`
      );
      
      return NextResponse.json({
        total: allOutstanding.length,
        patients: allOutstanding.map(p => ({
          id: p.patient_id,
          name: p.patient_name,
          payment_method_key: p.payment_method_key,
          status_key: p.status_key,
          qb_balance: p.qb_balance,
          sales_receipt_balance: p.sales_receipt_balance,
          payment_issue_balance: p.payment_issue_balance,
        })),
        kyleZachary: kyleZachary.map(p => ({
          id: p.patient_id,
          name: p.full_name,
          payment_method_key: p.payment_method_key,
          status_key: p.status_key,
          has_sales_receipts: p.has_sales_receipts,
          has_payment_issues: p.has_payment_issues,
          sales_receipt_count: p.sales_receipt_count,
          payment_issue_count: p.payment_issue_count,
          wouldBeIncluded: (
            (['qbo', 'quickbooks', 'jane_quickbooks'].includes(p.payment_method_key || '') || p.payment_method_key === null) &&
            !((p.status_key || '').toLowerCase().startsWith('inactive') || (p.status_key || '').toLowerCase().startsWith('discharg')) &&
            (p.has_sales_receipts || p.has_payment_issues)
          ),
        })),
      });
    }

    // Check patient by ID or name
    let patients;
    if (patientId) {
      patients = await query<{
        patient_id: string;
        full_name: string;
        payment_method_key: string;
        status_key: string;
      }>(
        `SELECT patient_id, full_name, payment_method_key, status_key
         FROM patients
         WHERE patient_id = $1`,
        [patientId]
      );
    } else {
      patients = await query<{
        patient_id: string;
        full_name: string;
        payment_method_key: string;
        status_key: string;
      }>(
        `SELECT patient_id, full_name, payment_method_key, status_key
         FROM patients
         WHERE LOWER(full_name) LIKE LOWER($1)`,
        [`%${patientName}%`]
      );
    }

    if (patients.length === 0) {
      return NextResponse.json({ 
        error: 'Patient not found',
        search: patientId || patientName 
      });
    }

    const patient = patients[0];

    // Check sales receipts
    const salesReceipts = await query<{
      qb_sales_receipt_id: string;
      amount: number;
      status: string;
      receipt_date: string;
    }>(
      `SELECT qb_sales_receipt_id, amount, status, receipt_date
       FROM quickbooks_sales_receipts
       WHERE patient_id = $1
       ORDER BY receipt_date DESC
       LIMIT 10`,
      [patient.patient_id]
    );

    // Check payment issues
    const paymentIssues = await query<{
      issue_id: string;
      issue_type: string;
      amount_owed: number;
      qb_sales_receipt_id: string | null;
      resolved_at: string | null;
    }>(
      `SELECT issue_id, issue_type, amount_owed, qb_sales_receipt_id, resolved_at
       FROM payment_issues
       WHERE patient_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [patient.patient_id]
    );

    // Test the actual query
    const outstandingBalance = await query<{
      patient_id: string;
      patient_name: string;
      qb_balance: number;
    }>(
      `WITH sales_receipt_balances AS (
        SELECT
          patient_id,
          SUM(amount) AS total_receipt_balance
        FROM quickbooks_sales_receipts
        WHERE amount > 0
          AND LOWER(COALESCE(status, '')) IN ('unknown', 'declined', 'error', 'failed', 'rejected')
        GROUP BY patient_id
      ),
      payment_issue_totals AS (
        SELECT
          patient_id,
          SUM(amount_owed) AS total_issue_amount
        FROM payment_issues
        WHERE resolved_at IS NULL
          AND amount_owed > 0
          AND issue_type IN (
            'payment_declined', 
            'payment_failed', 
            'insufficient_funds',
            'failed_payment',
            'overdue_invoice',
            'outstanding_balance'
          )
        GROUP BY patient_id
      ),
      qb_balances AS (
        SELECT
          p.patient_id,
          p.full_name AS patient_name,
          p.status_key AS status,
          GREATEST(
            COALESCE(pit.total_issue_amount, 0),
            COALESCE(srb.total_receipt_balance, 0)
          ) AS qb_balance
        FROM patients p
        LEFT JOIN payment_issue_totals pit ON p.patient_id = pit.patient_id
        LEFT JOIN sales_receipt_balances srb ON p.patient_id = srb.patient_id
        WHERE p.patient_id = $1
          AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
          AND (
            COALESCE(pit.total_issue_amount, 0) > 0
            OR COALESCE(srb.total_receipt_balance, 0) > 0
          )
      )
      SELECT patient_id, patient_name, qb_balance
      FROM qb_balances`,
      [patient.patient_id]
    );

    return NextResponse.json({
      patient: {
        id: patient.patient_id,
        name: patient.full_name,
        payment_method_key: patient.payment_method_key,
        status_key: patient.status_key,
      },
      salesReceipts: salesReceipts.map(sr => ({
        id: sr.qb_sales_receipt_id,
        amount: sr.amount,
        status: sr.status,
        date: sr.receipt_date,
      })),
      paymentIssues: paymentIssues.map(pi => ({
        id: pi.issue_id,
        type: pi.issue_type,
        amount: pi.amount_owed,
        sales_receipt_id: pi.qb_sales_receipt_id,
        resolved: pi.resolved_at !== null,
      })),
      outstandingBalance: outstandingBalance[0] || null,
      queryResult: outstandingBalance.length > 0 ? 'FOUND' : 'NOT FOUND - Check filters',
    });

  } catch (error: any) {
    console.error('[Debug] Outstanding balances error:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}


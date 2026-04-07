import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getPaymentFailureStats } from '@/lib/testosteroneInventory';

type MinimalUser = {
  user_id: string;
  email: string;
};

type OutstandingInvoiceRow = {
  patient_id: string | null;
  qb_invoice_id: string | null;
  balance: number | string | null;
  amount_due: number | string | null;
  days_overdue: number | null;
  payment_status: string | null;
  status_key: string | null;
};

function isInternalRequest(req: NextRequest): boolean {
  const internalAuth = req.headers.get('x-internal-auth');
  return Boolean(internalAuth && internalAuth === process.env.INTERNAL_AUTH_SECRET);
}

async function resolveActingUser(req: NextRequest, internal: boolean): Promise<MinimalUser | null> {
  if (internal) {
    const admins = await query<MinimalUser>(
      `SELECT user_id, email
         FROM users
        WHERE role = 'admin'
          AND is_active = TRUE
        ORDER BY created_at ASC
        LIMIT 1`
    );
    return admins[0] ?? null;
  }

  const user = await requireApiUser(req, 'admin');
  return {
    user_id: user.user_id,
    email: user.email,
  };
}

function determineIssueType(paymentStatus: string | null): 'overdue_invoice' | 'outstanding_balance' {
  const normalized = (paymentStatus ?? '').toLowerCase();
  return normalized === 'overdue' ? 'overdue_invoice' : 'outstanding_balance';
}

function determineSeverity(balance: number, daysOverdue: number): 'critical' | 'warning' | 'info' {
  if (daysOverdue >= 60 || balance >= 500) {
    return 'critical';
  }
  if (daysOverdue >= 30 || balance >= 200) {
    return 'warning';
  }
  return 'info';
}

export async function POST(req: NextRequest) {
  try {
    const internal = isInternalRequest(req);
    const actingUser = await resolveActingUser(req, internal);

    const outstandingInvoices = await query<OutstandingInvoiceRow>(
      `SELECT qp.patient_id,
              qp.qb_invoice_id,
              qp.balance,
              qp.amount_due,
              qp.days_overdue,
              qp.payment_status,
              p.status_key
         FROM quickbooks_payments qp
         JOIN patients p ON p.patient_id = qp.patient_id
        WHERE qp.balance > 0
          AND qp.patient_id IS NOT NULL
          AND qp.qb_invoice_id IS NOT NULL`
    );

    const outstandingByInvoice = new Map<string, OutstandingInvoiceRow>();
    for (const row of outstandingInvoices) {
      if (row.qb_invoice_id) {
        outstandingByInvoice.set(row.qb_invoice_id, row);
      }
    }

    const outstandingInvoiceIds = outstandingInvoices
      .map((row) => row.qb_invoice_id)
      .filter((id): id is string => Boolean(id));

    let createdIssueCount = 0;
    if (outstandingInvoiceIds.length > 0) {
      const existingIssues = await query<{ qb_invoice_id: string }>(
        `SELECT qb_invoice_id
           FROM payment_issues
          WHERE qb_invoice_id = ANY($1::text[])
            AND resolved_at IS NULL`,
        [outstandingInvoiceIds]
      );

      const existingIssueSet = new Set(existingIssues.map((issue) => issue.qb_invoice_id));

      const issuesToInsert = outstandingInvoices.filter(
        (row) => row.qb_invoice_id && !existingIssueSet.has(row.qb_invoice_id)
      );

      if (issuesToInsert.length > 0) {
        const insertValues: string[] = [];
        const params: unknown[] = [];

        issuesToInsert.forEach((row) => {
          if (!row.patient_id || !row.qb_invoice_id) {
            return;
          }
          const balance = Number(row.balance ?? 0);
          const daysOverdue = Number(row.days_overdue ?? 0);
          const issueType = determineIssueType(row.payment_status);
          const severity = determineSeverity(balance, daysOverdue);
          const previousStatus = row.status_key ?? null;

          params.push(
            row.patient_id,
            issueType,
            severity,
            balance,
            Number.isFinite(daysOverdue) ? daysOverdue : null,
            row.qb_invoice_id,
            previousStatus
          );

          const paramIndex = params.length - 6;
          insertValues.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, TRUE)`
          );

          createdIssueCount += 1;
        });

        if (insertValues.length > 0) {
          await query(
            `INSERT INTO payment_issues (
              patient_id,
              issue_type,
              issue_severity,
              amount_owed,
              days_overdue,
              qb_invoice_id,
              previous_status_key,
              auto_updated
            ) VALUES ${insertValues.join(', ')} ON CONFLICT DO NOTHING`,
            params
          );
        }
      }
    }

    // FIX(2026-04-06): QuickBooks is being phased out. QB data should NOT change patient status.
    // Previously this block would put patients on hold_payment_research based on QB outstanding
    // invoices — disabled because Healthie is now the source of truth for payment status.
    // QB can still track financial records (payment_issues table) for reporting purposes.
    const holdsByPatient = new Map<string, string | null>();

    const resolvedIssues = await query<{ issue_id: string }>(
      `UPDATE payment_issues pi
          SET resolved_at = NOW(),
              resolved_by = CASE WHEN $1::uuid IS NOT NULL THEN $1::uuid ELSE resolved_by END,
              resolution_notes = COALESCE(resolution_notes, 'QuickBooks payment check - invoice paid'),
              auto_updated = TRUE
        WHERE pi.qb_invoice_id IS NOT NULL
          AND pi.resolved_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM quickbooks_payments qp
             WHERE qp.qb_invoice_id = pi.qb_invoice_id
               AND qp.balance > 0
          )
        RETURNING pi.issue_id`,
      [actingUser?.user_id ?? null]
    );

    // FIX(2026-04-06): Auto-resolve payment issues for patients who are already active.
    // Many issues come from Healthie (no qb_invoice_id) and were never auto-resolved.
    const activeResolvedIssues = await query<{ issue_id: string }>(
      `UPDATE payment_issues pi
          SET resolved_at = NOW(),
              resolved_by = CASE WHEN $1::uuid IS NOT NULL THEN $1::uuid ELSE resolved_by END,
              resolution_notes = 'Auto-resolved — patient is active (payment succeeded)',
              auto_updated = TRUE
        WHERE pi.resolved_at IS NULL
          AND EXISTS (
            SELECT 1 FROM patients p
             WHERE p.patient_id = pi.patient_id
               AND p.status_key = 'active'
          )
        RETURNING pi.issue_id`,
      [actingUser?.user_id ?? null]
    );

    if (activeResolvedIssues.length > 0) {
      console.log(`[QuickBooks] Auto-resolved ${activeResolvedIssues.length} payment issues for active patients`);
    }

    const stats = await getPaymentFailureStats();

    return NextResponse.json({
      success: true,
      summary: {
        outstandingInvoices: outstandingInvoices.length,
        issuesCreated: createdIssueCount,
        issuesResolved: resolvedIssues.length + activeResolvedIssues.length,
        issuesResolvedByQB: resolvedIssues.length,
        issuesResolvedByActiveStatus: activeResolvedIssues.length,
        patientsPlacedOnHold: holdsByPatient.size,
      },
      stats,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[QuickBooks] Payment failure check error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check QuickBooks payment failures',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}



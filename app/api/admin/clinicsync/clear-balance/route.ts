import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');
    const { patientId, membershipId } = await req.json();

    if (!patientId || !membershipId) {
      return NextResponse.json({ error: 'Both patientId and membershipId are required' }, { status: 400 });
    }

    // Clear the balance on the membership
    await query(
      `UPDATE clinicsync_memberships 
       SET amount_due = 0,
           balance_owing = 0,
           raw_payload = jsonb_set(
             jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{amount_due}', '0'::jsonb, true),
             '{balance_owing}',
             '0'::jsonb,
             true
           ),
           updated_at = NOW()
       WHERE patient_id = $1 
         AND clinicsync_patient_id = $2`,
      [patientId, membershipId]
    );

    // Also clear the balance in jane_packages_import if it exists
    const [patientInfo] = await query<{ full_name: string }>(
      `SELECT full_name FROM patients WHERE patient_id = $1`,
      [patientId]
    );

    if (patientInfo) {
      await query(
        `UPDATE jane_packages_import 
         SET outstanding_balance = 0
         WHERE LOWER(patient_name) = LOWER($1) 
            OR LOWER(patient_name) = LOWER($2)`,
        [patientInfo.full_name, `Mrs. ${patientInfo.full_name}`]
      );
    }

    // Check if there are any payment issues for this patient
    const [paymentIssue] = await query<{ issue_id: string }>(
      `SELECT issue_id 
       FROM payment_issues 
       WHERE patient_id = $1 
         AND resolved_at IS NULL
       LIMIT 1`,
      [patientId]
    );

    // If there's a payment issue, resolve it
    if (paymentIssue) {
      await query(
        `UPDATE payment_issues 
         SET resolved_at = NOW(), 
             resolved_by = $1,
             resolution_notes = 'ClinicSync balance cleared - charge cleared in Jane'
         WHERE patient_id = $2 
           AND resolved_at IS NULL`,
        [user.user_id, patientId]
      );
    }

    // Check patient's current status
    const [patient] = await query<{ status_key: string }>(
      `SELECT status_key FROM patients WHERE patient_id = $1`,
      [patientId]
    );

    // Update patient status to active if they were on hold for payment
    if (patient && patient.status_key === 'hold_payment_research') {
      await query(
        `UPDATE patients 
         SET status_key = 'active',
             last_modified = NOW(),
             last_modified_by = $1
         WHERE patient_id = $2`,
        [user.email, patientId]
      );

      // Log the status change (best-effort)
      try {
        await query(
          `INSERT INTO patient_status_activity_log 
           (patient_id, previous_status, new_status, changed_by_user_id, change_reason, created_at)
           VALUES ($1, 'hold_payment_research', 'active', $2, 'ClinicSync balance cleared - charge cleared in Jane', NOW())`,
          [patientId, user.user_id]
        );
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== '42P01') {
          throw error;
        }
        console.warn(
          '[ClinicSync] patient_status_activity_log table missing when logging balance clear; continuing without audit entry.'
        );
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Balance cleared successfully',
      statusUpdated: patient?.status_key === 'hold_payment_research'
    });
  } catch (error) {
    console.error('Error clearing balance:', error);
    return NextResponse.json(
      { error: 'Failed to clear balance' },
      { status: 500 }
    );
  }
}

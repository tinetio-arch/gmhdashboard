import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');
    const { issueId, patientId, updatePatientStatus, resolutionNote } = await req.json();

    if (!issueId && !patientId) {
      return NextResponse.json({ error: 'Either issueId or patientId is required' }, { status: 400 });
    }

    // If issueId is provided, resolve that specific issue
    if (issueId) {
      // First get the patient_id from the issue
      const [issue] = await query<{ patient_id: string }>(
        `SELECT patient_id FROM payment_issues WHERE issue_id = $1`,
        [issueId]
      );

      if (!issue) {
        return NextResponse.json({ error: 'Payment issue not found' }, { status: 404 });
      }

      // Update the payment issue
      await query(
        `UPDATE payment_issues 
         SET resolved_at = NOW(), 
             resolved_by = $1,
             resolution_notes = $2
         WHERE issue_id = $3`,
        [user.user_id, resolutionNote || 'Manually resolved by admin', issueId]
      );

      // If requested, update patient status to active
      if (updatePatientStatus) {
        const [patient] = await query<{ status_key: string }>(
          `SELECT status_key FROM patients WHERE patient_id = $1`,
          [issue.patient_id]
        );

        if (patient && patient.status_key === 'hold_payment_research') {
          await query(
            `UPDATE patients 
             SET status_key = 'active',
                 last_modified = NOW(),
                 last_modified_by = $1
             WHERE patient_id = $2`,
            [user.email, issue.patient_id]
          );

          // Log the status change
          await query(
            `INSERT INTO patient_status_activity_log 
             (patient_id, previous_status, new_status, changed_by_user_id, change_reason, created_at)
             VALUES ($1, 'hold_payment_research', 'active', $2, $3, NOW())`,
            [issue.patient_id, user.user_id, resolutionNote || 'Payment issue resolved - charge cleared in financial system']
          );
        }
      }
      
      return NextResponse.json({ 
        success: true, 
        message: 'Payment issue resolved',
        resolvedCount: 1,
        statusUpdated: updatePatientStatus || false
      });
    }

    // If patientId is provided, resolve all unresolved issues for that patient
    if (patientId) {
      const result = await query(
        `UPDATE payment_issues 
         SET resolved_at = NOW(), 
             resolved_by = $1,
             resolution_notes = 'Manually resolved by admin - all patient issues cleared'
         WHERE patient_id = $2 AND resolved_at IS NULL`,
        [user.user_id, patientId]
      );
      
      // Also update patient status if they're on hold for payment research
      await query(
        `UPDATE patients 
         SET status_key = 'active',
             last_modified = NOW(),
             last_modified_by = $1
         WHERE patient_id = $2 
         AND status_key = 'hold_payment_research'`,
        [user.email, patientId]
      );

      // Log the status change
      await query(
        `INSERT INTO patient_status_activity_log 
         (patient_id, old_status, new_status, changed_by, changed_at, change_reason)
         VALUES ($1, 'hold_payment_research', 'active', $2, NOW(), 'Payment issues manually resolved')`,
        [patientId, user.email]
      );
      
      return NextResponse.json({ 
        success: true, 
        message: 'All payment issues resolved for patient',
        patientId 
      });
    }
  } catch (error) {
    console.error('Error resolving payment issue:', error);
    return NextResponse.json(
      { error: 'Failed to resolve payment issue' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { transitionStatus } from '@/lib/status-transitions';

export const dynamic = 'force-dynamic';

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
        const [patient] = await query<{ status_key: string; issue_type: string }>(
          `SELECT p.status_key, pi.issue_type 
           FROM patients p
           JOIN payment_issues pi ON pi.patient_id = p.patient_id
           WHERE p.patient_id = $1 AND pi.issue_id = $2`,
          [issue.patient_id, issueId]
        );

        if (patient) {
          const isContractIssue = patient.issue_type === 'contract_expired';
          const isPaymentIssue = patient.issue_type === 'payment_declined' || patient.issue_type === 'membership_delinquent';
          const shouldUpdateStatus = 
            (isContractIssue && patient.status_key === 'hold_contract_renewal') ||
            (isPaymentIssue && patient.status_key === 'hold_payment_research');

          if (shouldUpdateStatus) {
            const previousStatus = patient.status_key;
            const changeReason = resolutionNote || (
              isContractIssue
                ? 'Contract expiration issue resolved - new contract active'
                : 'Payment issue resolved - charge cleared in financial system'
            );

            const t = await transitionStatus({
              patientId: issue.patient_id,
              toStatus: 'active',
              source: 'admin_api',
              actor: user.email || 'system',
              reason: changeReason,
              metadata: { fn: 'resolve-payment-issue', issueId, issueType: patient.issue_type },
            });
            if (t.applied) {
              await query(`UPDATE patients SET updated_at = NOW() WHERE patient_id = $1::uuid`, [issue.patient_id]);

              try {
                await query(
                  `INSERT INTO patient_status_activity_log
                   (patient_id, previous_status, new_status, changed_by_user_id, change_source, change_reason, created_at)
                   VALUES ($1, $2, 'active', $3, 'admin_resolve_payment', $4, NOW())`,
                  [issue.patient_id, previousStatus, user.user_id, changeReason]
                );
              } catch (logError: any) {
                console.error('[Resolve Payment Issue] Failed to write audit log', logError);
              }
            }
          }
        }
      }
      
      // Get the issue type for the response message
      const [issueType] = await query<{ issue_type: string }>(
        `SELECT issue_type FROM payment_issues WHERE issue_id = $1`,
        [issueId]
      );
      
      const isContractIssue = issueType?.issue_type === 'contract_expired';
      const successMessage = isContractIssue 
        ? 'Contract expiration issue resolved' 
        : 'Payment issue resolved';
      
      return NextResponse.json({ 
        success: true, 
        message: successMessage,
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
      
      // FIX(2026-04-06): Capture actual previous status before updating
      const currentPatient = await query<{ status_key: string }>(
        `SELECT status_key FROM patients WHERE patient_id = $1 AND status_key IN ('hold_payment_research', 'hold_contract_renewal')`,
        [patientId]
      );

      if (currentPatient.length > 0) {
        const previousStatus = currentPatient[0].status_key;

        const t = await transitionStatus({
          patientId,
          toStatus: 'active',
          source: 'admin_api',
          actor: user.email || 'system',
          reason: 'Payment issues manually resolved',
          metadata: { fn: 'resolve-payment-issue-bulk', previousStatus },
        });

        if (t.applied) {
          await query(`UPDATE patients SET updated_at = NOW() WHERE patient_id = $1::uuid`, [patientId]);

          try {
            await query(
              `INSERT INTO patient_status_activity_log
               (patient_id, previous_status, new_status, changed_by_user_id, change_source, change_reason, created_at)
               VALUES ($1, $2, 'active', $3, 'admin_resolve_payment', 'Payment issues manually resolved', NOW())`,
              [patientId, previousStatus, user.user_id]
            );
          } catch (logError: any) {
            console.error('[Resolve Payment Issue] Failed to write audit log', logError);
          }
        }
      }
      
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

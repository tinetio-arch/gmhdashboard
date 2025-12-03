import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { createQuickBooksClient } from '@/lib/quickbooks';

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    const { qbCustomerId, patientId, matchMethod } = await req.json();

    if (!qbCustomerId || !patientId) {
      return NextResponse.json(
        { error: 'QuickBooks Customer ID and Patient ID are required' },
        { status: 400 }
      );
    }

    // Get customer details for the mapping
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      return NextResponse.json(
        { error: 'QuickBooks not connected' },
        { status: 400 }
      );
    }

    const customer = await qbClient.getCustomer(qbCustomerId);

    // Deactivate any existing mappings for this customer or patient
    await query(`
      UPDATE patient_qb_mapping 
      SET is_active = FALSE, updated_at = NOW()
      WHERE (qb_customer_id = $1 OR patient_id = $2) AND is_active = TRUE
    `, [qbCustomerId, patientId]);

    // Create the new mapping
    await query(`
      INSERT INTO patient_qb_mapping (
        patient_id, qb_customer_id, qb_customer_email, qb_customer_name, match_method, is_active
      ) VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (patient_id, qb_customer_id) DO UPDATE SET
        qb_customer_email = EXCLUDED.qb_customer_email,
        qb_customer_name = EXCLUDED.qb_customer_name,
        match_method = EXCLUDED.match_method,
        is_active = TRUE,
        updated_at = NOW()
    `, [
      patientId,
      qbCustomerId,
      customer.PrimaryEmailAddr?.Address || null,
      customer.DisplayName,
      matchMethod || 'manual'
    ]);

    // Update patient payment method if not already QuickBooks
    await query(`
      UPDATE patients SET
        payment_method_key = CASE 
          WHEN payment_method_key = 'jane' THEN 'jane_quickbooks'
          WHEN payment_method_key IS NULL THEN 'quickbooks'
          ELSE payment_method_key
        END,
        qbo_customer_email = COALESCE(qbo_customer_email, $1),
        updated_at = NOW()
      WHERE patient_id = $2
    `, [customer.PrimaryEmailAddr?.Address || null, patientId]);

    // Track resolution
    await query(`
      INSERT INTO membership_audit_resolutions (
        normalized_name, resolution_type, resolved_at, resolved_by, resolution_notes
      ) VALUES (
        (SELECT lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g')) FROM patients WHERE patient_id = $1),
        'quickbooks_mapped',
        NOW(),
        $2,
        $3
      )
      ON CONFLICT DO NOTHING
    `, [patientId, user.email, `Mapped to QuickBooks customer: ${customer.DisplayName}`]);

    return NextResponse.json({ success: true, message: 'Patient mapped successfully' });
  } catch (error) {
    console.error('Error mapping QuickBooks patient:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to map patient' },
      { status: 500 }
    );
  }
}







/**
 * iPad — Create Pending Peptide Consent for Patient
 *
 * When staff orders peptides on iPad, this stores the cart items
 * as a pending consent. The patient's mobile app picks it up and
 * shows the ConsentFormScreen with the specific peptides ordered.
 * Once signed, the PDF goes to their Healthie Documents.
 *
 * POST /api/ipad/billing/send-consent
 * Body: { patient_id: string, items: Array<{ sku, name, price, quantity }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolvePatientId, resolveHealthieId } from '@/lib/ipad-patient-resolver';

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { patient_id: rawPatientId, items } = body;

    if (!rawPatientId) {
      return NextResponse.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Resolve patient
    const patientId = await resolvePatientId(rawPatientId);
    if (!patientId) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const healthieId = await resolveHealthieId(rawPatientId);

    // Cancel any existing pending consents for this patient (only one active at a time)
    await query(
      `UPDATE pending_peptide_consents SET status = 'cancelled' WHERE patient_id = $1 AND status = 'pending'`,
      [patientId]
    );

    // Get cart items from the ship cart if not passed directly
    let consentItems = items;
    if (!consentItems || consentItems.length === 0) {
      // Fall back to the patient's billing cart
      const cartItems = await query<{ product_name: string; sku: string; price: number; quantity: number }>(
        `SELECT product_name, sku, price, quantity FROM patient_billing_cart WHERE patient_id = $1`,
        [patientId]
      );
      consentItems = cartItems.map(c => ({
        name: c.product_name,
        sku: c.sku || '',
        price: Number(c.price),
        quantity: c.quantity
      }));
    }

    if (!consentItems || consentItems.length === 0) {
      return NextResponse.json({
        error: 'No items to create consent for. Add items to cart first.',
      }, { status: 400 });
    }

    // Create pending consent
    const [consent] = await query<{ id: number }>(
      `INSERT INTO pending_peptide_consents (patient_id, healthie_id, items, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [patientId, healthieId || null, JSON.stringify(consentItems), (user as any).email || 'staff']
    );

    console.log(`[Send Consent] Created pending consent #${consent.id} for patient ${patientId} with ${consentItems.length} items`);

    return NextResponse.json({
      success: true,
      consent_id: consent.id,
      items_count: consentItems.length,
      message: `Consent request created with ${consentItems.length} peptide(s). Patient will see it in their app.`,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Send Consent] Error:', error.message);
    return NextResponse.json({
      error: error.message || 'Failed to create consent request',
    }, { status: 500 });
  }
}

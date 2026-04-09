/**
 * Headless — Pending Peptide Consent for Mobile App
 *
 * GET  /api/headless/pending-consent?healthie_id=xxx
 *   Returns the pending consent (if any) with cart items for the patient.
 *   Mobile app uses this to show the ConsentFormScreen.
 *
 * POST /api/headless/pending-consent
 *   Marks a consent as signed after patient completes it in the app.
 *   Body: { healthie_id, consent_id, document_id }
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// FIX(2026-04-09): Added x-jarvis-secret auth — endpoint was previously unauthenticated,
// exposing patient consent data to anyone with a healthie_id
function checkAuth(request: NextRequest): boolean {
  const secret = request.headers.get('x-jarvis-secret');
  return secret === process.env.JARVIS_SHARED_SECRET;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const healthieId = request.nextUrl.searchParams.get('healthie_id');
  if (!healthieId) {
    return NextResponse.json({ error: 'healthie_id required' }, { status: 400 });
  }

  try {
    // Find pending consent by healthie_id OR by patient_id lookup
    const consents = await query<{
      id: number;
      items: any;
      created_at: string;
      created_by: string;
    }>(`
      SELECT pc.id, pc.items, pc.created_at, pc.created_by
      FROM pending_peptide_consents pc
      WHERE pc.status = 'pending'
        AND (pc.healthie_id = $1
             OR pc.patient_id = (SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1))
      ORDER BY pc.created_at DESC
      LIMIT 1
    `, [healthieId]);

    if (consents.length === 0) {
      return NextResponse.json({ pending: false });
    }

    const consent = consents[0];
    return NextResponse.json({
      pending: true,
      consent_id: consent.id,
      items: consent.items,
      created_at: consent.created_at,
      created_by: consent.created_by,
    });
  } catch (error: any) {
    console.error('[pending-consent GET] Error:', error.message);
    return NextResponse.json({ error: 'Failed to check pending consent' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { healthie_id, consent_id, document_id } = body;

    if (!consent_id) {
      return NextResponse.json({ error: 'consent_id required' }, { status: 400 });
    }

    // Mark consent as signed
    const updated = await query<{ id: number }>(
      `UPDATE pending_peptide_consents
       SET status = 'signed', signed_at = NOW(), document_id = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING id`,
      [document_id || null, consent_id]
    );

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Consent not found or already signed' }, { status: 404 });
    }

    console.log(`[pending-consent POST] Consent #${consent_id} signed by healthie_id ${healthie_id}`);

    return NextResponse.json({
      success: true,
      message: 'Consent signed successfully',
    });
  } catch (error: any) {
    console.error('[pending-consent POST] Error:', error.message);
    return NextResponse.json({ error: 'Failed to update consent' }, { status: 500 });
  }
}

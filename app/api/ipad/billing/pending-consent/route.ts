/**
 * GET /api/ipad/billing/pending-consent?patient_id=xxx
 *
 * Returns the most recent pending or signed consent for a patient,
 * including the cart items. Used by the ship-to-patient modal to
 * auto-populate the ship cart from consent items so staff don't
 * have to re-add products manually after sending a consent form.
 *
 * FIX(2026-04-22): Created to close the gap where consent sends
 * cleared the in-memory ship cart, forcing staff to re-add items.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const rawPatientId = request.nextUrl.searchParams.get('patient_id');
    if (!rawPatientId) {
      return NextResponse.json({ error: 'patient_id required' }, { status: 400 });
    }

    const patientId = await resolvePatientId(rawPatientId) || rawPatientId;

    // Find the most recent pending or signed consent for this patient
    const consents = await query<{
      id: number;
      items: any;
      status: string;
      created_at: string;
      created_by: string;
      signed_at: string | null;
    }>(`
      SELECT id, items, status, created_at, created_by, signed_at
      FROM pending_peptide_consents
      WHERE patient_id = $1 AND status IN ('pending', 'signed')
      ORDER BY created_at DESC
      LIMIT 1
    `, [patientId]);

    if (consents.length === 0) {
      return NextResponse.json({ has_consent: false });
    }

    const consent = consents[0];
    const items = typeof consent.items === 'string' ? JSON.parse(consent.items) : consent.items;

    return NextResponse.json({
      has_consent: true,
      consent_id: consent.id,
      consent_status: consent.status,
      items,
      created_at: consent.created_at,
      created_by: consent.created_by,
      signed_at: consent.signed_at,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[pending-consent GET] Error:', error.message);
    return NextResponse.json({ error: 'Failed to check consent' }, { status: 500 });
  }
}

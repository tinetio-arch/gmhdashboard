/**
 * POST /api/patients/[id]/stack/[stackId]/log
 *   Record one peptide injection event. Drives the amount_remaining /
 *   next_due math for item_type='peptide' (lib/patientStack.computePeptideItem).
 *   TRT items reject — they have their own engine via dispenses + staged_doses.
 *
 *   Mobile-app surface (the Stack agent owns the screen; this endpoint is
 *   the writer it calls).
 *
 *   Body:
 *     dose_amount  number (required) — in the parent stack's dose_unit
 *     dose_unit    string (optional) — defaults to stack.dose_unit
 *     volume_ml    number (optional)
 *     site         string (optional)
 *     note         string (optional)
 *     logged_via   'patient_app' | 'ipad' | 'provider' | 'retro_import'  (default patient_app)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { fetchStackItem } from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

interface LogBody {
  dose_amount: number;
  dose_unit?: string | null;
  volume_ml?: number | null;
  site?: string | null;
  note?: string | null;
  injected_at?: string | null;        // ISO; defaults to NOW()
  logged_via?: 'patient_app' | 'ipad' | 'provider' | 'retro_import';
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; stackId: string } }
) {
  try {
    await requireApiUser(request, 'write');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    const { id: patientId, stackId } = params;
    const body = (await request.json()) as LogBody;

    if (!body.dose_amount || body.dose_amount <= 0) {
      return NextResponse.json({ error: 'dose_amount must be positive' }, { status: 400 });
    }

    const existing = await fetchStackItem(stackId);
    if (!existing) {
      return NextResponse.json({ error: 'stack item not found' }, { status: 404 });
    }
    if (existing.patient_id !== patientId) {
      return NextResponse.json({ error: 'stack item does not belong to this patient' }, { status: 403 });
    }
    if (existing.item_type !== 'peptide') {
      return NextResponse.json(
        { error: 'TRT injections are tracked in dispenses + staged_doses, not via this endpoint' },
        { status: 400 }
      );
    }

    const unit = body.dose_unit ?? existing.dose_unit ?? 'mg';

    const rows = await query<{ log_id: string }>(
      `INSERT INTO peptide_injection_log (
         stack_id, patient_id, injected_at, dose_amount, dose_unit, volume_ml, site, note, logged_via
       ) VALUES (
         $1::uuid, $2::uuid, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, $9
       )
       RETURNING log_id`,
      [
        stackId,
        patientId,
        body.injected_at ?? null,
        body.dose_amount,
        unit,
        body.volume_ml ?? null,
        body.site ?? null,
        body.note ?? null,
        body.logged_via ?? 'patient_app'
      ]
    );

    const refreshed = await fetchStackItem(stackId);
    return NextResponse.json({
      success: true,
      log_id: rows[0].log_id,
      item: refreshed
    });
  } catch (error) {
    console.error('[API stack log POST] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

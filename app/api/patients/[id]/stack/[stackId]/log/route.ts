/**
 * POST /api/patients/[id]/stack/[stackId]/log
 *   Record one injection event. Two paths:
 *
 *   - PEPTIDE items (item_type='peptide') → peptide_injection_log,
 *     drives amount_remaining / next_due (lib/patientStack.computePeptideItem).
 *
 *   - TRT items (item_type='testosterone', stackId = "virtual-trt:<patient_id>")
 *     → trt_injection_log. Staff dispenses the prefilled syringes; patients
 *     inject at home and log the actual injection in the NowOptimal app so
 *     the TRT card shows accurate next-due math instead of just assuming
 *     they take it on schedule. NMH-only by construction — non-NMH patients
 *     never get a virtual-trt stack item synthesized in the first place
 *     (lib/patientStack.synthesizeTrtStackItem gates on isMensHealthPatient).
 *     Added 2026-05-28 per Phil.
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

const VIRTUAL_TRT_PREFIX = 'virtual-trt:';

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

    // ── TRT self-log path ────────────────────────────────────────────────
    // Virtual stack IDs are synthesized client-side per-patient and aren't
    // in patient_peptide_stack, so fetchStackItem would 404. The id format
    // is "virtual-trt:<patient_id>" — verify it matches the URL patient_id
    // (no cross-patient writes) and then write to trt_injection_log.
    if (stackId.startsWith(VIRTUAL_TRT_PREFIX)) {
      const trtPatient = stackId.slice(VIRTUAL_TRT_PREFIX.length);
      if (trtPatient !== patientId) {
        return NextResponse.json(
          { error: 'virtual-trt stack id does not belong to this patient' },
          { status: 403 }
        );
      }
      const trtRows = await query<{ log_id: string }>(
        `INSERT INTO trt_injection_log (
           patient_id, injected_at, dose_ml, syringes_used, site, note, logged_via
         ) VALUES (
           $1::uuid, COALESCE($2::timestamptz, NOW()), $3, 1, $4, $5, $6
         )
         RETURNING log_id`,
        [
          patientId,
          body.injected_at ?? null,
          body.dose_amount,
          body.site ?? null,
          body.note ?? null,
          body.logged_via ?? 'patient_app',
        ]
      );
      return NextResponse.json({
        success: true,
        log_id: trtRows[0].log_id,
        item_type: 'testosterone',
      });
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
        { error: 'this stack item is not loggable via this endpoint' },
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

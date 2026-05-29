/**
 * POST /api/headless/stack/log
 *   Headless wrapper around POST /api/patients/[id]/stack/[stackId]/log —
 *   accepts a Healthie user id (the only id the mobile app holds), maps
 *   it to the internal patient_id UUID, and writes a peptide injection
 *   log entry OR a TRT self-log entry (virtual-trt:* stack IDs).
 *
 * Auth: x-jarvis-secret.
 *
 * Request body:
 *   userId       (required) — Healthie client id (string of digits).
 *   stackId      (required) — Stack item UUID (real or virtual-trt:<patient_id>).
 *   doseAmount   (required) — positive number.
 *   doseUnit     (optional)
 *   site         (optional)
 *   notes        (optional)
 *   injectedAt   (optional ISO timestamp; defaults to NOW())
 *
 * Built 2026-05-28 to unblock TRT self-logging on the patient app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { fetchStackItem } from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

const VIRTUAL_TRT_PREFIX = 'virtual-trt:';

async function resolvePatientId(userId: string): Promise<string | null> {
  if (/^\d+$/.test(userId)) {
    const rows = await query<{ patient_id: string }>(
      `SELECT patient_id::text AS patient_id
         FROM healthie_clients
        WHERE healthie_client_id = $1 AND is_active = true
        LIMIT 1`,
      [userId]
    );
    if (rows[0]?.patient_id) return rows[0].patient_id;
    const direct = await query<{ patient_id: string }>(
      `SELECT patient_id::text AS patient_id
         FROM patients
        WHERE healthie_client_id = $1
        LIMIT 1`,
      [userId]
    );
    return direct[0]?.patient_id ?? null;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return userId;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-jarvis-secret');
  if (secret !== process.env.JARVIS_SHARED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const userId = String(body?.userId || '').trim();
    const stackId = String(body?.stackId || '').trim();
    const doseAmount = Number(body?.doseAmount);
    if (!userId || !stackId) {
      return NextResponse.json({ error: 'userId and stackId required' }, { status: 400 });
    }
    if (!isFinite(doseAmount) || doseAmount <= 0) {
      return NextResponse.json({ error: 'doseAmount must be positive' }, { status: 400 });
    }
    const patientId = await resolvePatientId(userId);
    if (!patientId) {
      return NextResponse.json({ error: 'patient not found' }, { status: 404 });
    }

    // TRT virtual-stack id path — same logic as POST /api/patients/[id]/stack/[stackId]/log.
    if (stackId.startsWith(VIRTUAL_TRT_PREFIX)) {
      const trtPatient = stackId.slice(VIRTUAL_TRT_PREFIX.length);
      if (trtPatient !== patientId) {
        return NextResponse.json(
          { error: 'virtual-trt stack id does not belong to this user' },
          { status: 403 }
        );
      }
      const trtRows = await query<{ log_id: string }>(
        `INSERT INTO trt_injection_log (
           patient_id, injected_at, dose_ml, syringes_used, site, note, logged_via
         ) VALUES (
           $1::uuid, COALESCE($2::timestamptz, NOW()), $3, 1, $4, $5, 'patient_app'
         )
         RETURNING log_id`,
        [
          patientId,
          body?.injectedAt ?? null,
          doseAmount,
          body?.site ?? null,
          body?.notes ?? null,
        ]
      );
      return NextResponse.json({
        success: true,
        log_id: trtRows[0]?.log_id,
        item_type: 'testosterone',
      });
    }

    // Peptide path — look up the stack item, validate ownership, write log.
    const existing = await fetchStackItem(stackId);
    if (!existing) {
      return NextResponse.json({ error: 'stack item not found' }, { status: 404 });
    }
    if (existing.patient_id !== patientId) {
      return NextResponse.json({ error: 'stack item does not belong to this user' }, { status: 403 });
    }
    if (existing.item_type !== 'peptide') {
      return NextResponse.json({ error: 'this stack item is not loggable via this endpoint' }, { status: 400 });
    }
    const unit = body?.doseUnit ?? existing.dose_unit ?? 'mg';
    const rows = await query<{ log_id: string }>(
      `INSERT INTO peptide_injection_log (
         stack_id, patient_id, injected_at, dose_amount, dose_unit, volume_ml, site, note, logged_via
       ) VALUES (
         $1::uuid, $2::uuid, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, 'patient_app'
       )
       RETURNING log_id`,
      [
        stackId,
        patientId,
        body?.injectedAt ?? null,
        doseAmount,
        unit,
        body?.volumeMl ?? null,
        body?.site ?? null,
        body?.notes ?? null,
      ]
    );
    const refreshed = await fetchStackItem(stackId);
    return NextResponse.json({
      success: true,
      log_id: rows[0]?.log_id,
      item: refreshed,
    });
  } catch (err: any) {
    console.error('[headless/stack/log] Error:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

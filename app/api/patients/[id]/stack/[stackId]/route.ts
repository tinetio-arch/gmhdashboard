/**
 * PATCH  /api/patients/[id]/stack/[stackId]
 *   Provider dose-adjust. Partial update of dose/schedule/status/supply with
 *   audit append. Only fields present in the body are touched.
 *   For TRT items, cadence_days changes propagate to patients.dose_frequency_days
 *   so lib/trtEligibility (computeDispenseEligibility) reflects the change.
 *
 * DELETE /api/patients/[id]/stack/[stackId]
 *   Soft-delete: sets status='discontinued', appends audit. Row is preserved
 *   for history. Hard-delete is not exposed.
 *
 * Auth: requireApiUser('write')
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildHistoryEntry, fetchStackItem, type StackStatus } from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

interface AdjustBody {
  recommended_dose?: number | null;
  dose_unit?: string | null;
  frequency_code?: string | null;
  inject_days?: string[] | null;
  cadence_days?: number | null;
  anchor_date?: string | null;
  status?: StackStatus;
  vial_size_ml?: number | null;
  syringes_dispensed?: number | null;
  display_name?: string;
  fda_ack_at?: string | null;             // patient acks disclaimer (ISO ts or NOW marker '__now__')
  note?: string | null;
}

const ALLOWED_KEYS: (keyof AdjustBody)[] = [
  'recommended_dose',
  'dose_unit',
  'frequency_code',
  'inject_days',
  'cadence_days',
  'anchor_date',
  'status',
  'vial_size_ml',
  'syringes_dispensed',
  'display_name',
  'fda_ack_at'
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; stackId: string } }
) {
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    const { id: patientId, stackId } = params;
    const body = (await request.json()) as AdjustBody;

    // Load existing row for prev snapshot + ownership check.
    const existing = await fetchStackItem(stackId);
    if (!existing) {
      return NextResponse.json({ error: 'stack item not found' }, { status: 404 });
    }
    if (existing.patient_id !== patientId) {
      return NextResponse.json({ error: 'stack item does not belong to this patient' }, { status: 403 });
    }

    // Build dynamic UPDATE. Same pattern as peptides/specialty orders/supplies.
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    for (const key of ALLOWED_KEYS) {
      if (!(key in body)) continue;
      const v = body[key];

      if (key === 'inject_days') {
        updates.push(`inject_days = $${i++}::jsonb`);
        values.push(v ? JSON.stringify(v) : null);
        prev.inject_days = existing.inject_days;
        next.inject_days = v ?? null;
        continue;
      }
      if (key === 'anchor_date') {
        updates.push(`anchor_date = $${i++}::date`);
        values.push(v ?? null);
        prev.anchor_date = existing.anchor_date;
        next.anchor_date = v ?? null;
        continue;
      }
      if (key === 'fda_ack_at') {
        // Allow caller to ack with literal '__now__' or pass a timestamp.
        const ts = v === '__now__' ? new Date().toISOString() : v;
        updates.push(`fda_ack_at = $${i++}::timestamptz`);
        values.push(ts);
        prev.fda_ack_at = existing.fda_ack_at;
        next.fda_ack_at = ts;
        continue;
      }

      updates.push(`${key} = $${i++}`);
      values.push(v);
      prev[key] = (existing as any)[key];
      next[key] = v;
    }

    if (updates.length === 0 && !body.note) {
      return NextResponse.json({ error: 'no updatable fields in body' }, { status: 400 });
    }

    // Always append an audit entry — even a no-field PATCH with just a note
    // is a legitimate provider annotation.
    const isStatusChange = 'status' in body && body.status !== existing.status;
    const action: 'set' | 'adjust' | 'pause' | 'resume' | 'discontinue' =
      isStatusChange && body.status === 'paused' ? 'pause' :
      isStatusChange && body.status === 'active' ? 'resume' :
      isStatusChange && body.status === 'discontinued' ? 'discontinue' :
      'adjust';

    const entry = buildHistoryEntry({
      action,
      by: user.user_id,
      by_name: user.display_name || user.email,
      prev: Object.keys(prev).length ? prev : null,
      next: Object.keys(next).length ? next : null,
      note: body.note ?? null
    });

    updates.push(`dose_history = dose_history || jsonb_build_array($${i++}::jsonb)`);
    values.push(JSON.stringify(entry));
    updates.push(`recommended_by = $${i++}::uuid`);
    values.push(user.user_id);
    updates.push(`recommended_at = NOW()`);

    values.push(stackId);
    const sql = `UPDATE patient_peptide_stack SET ${updates.join(', ')} WHERE stack_id = $${i}::uuid`;
    await query(sql, values);

    // TRT-only side-effect: cadence change propagates to patients.dose_frequency_days
    // so trtEligibility picks it up immediately.
    if (
      existing.item_type === 'testosterone' &&
      typeof body.cadence_days === 'number' &&
      body.cadence_days > 0
    ) {
      await query(
        `UPDATE patients SET dose_frequency_days = $1, updated_at = NOW() WHERE patient_id = $2::uuid`,
        [body.cadence_days, patientId]
      );
    }

    const refreshed = await fetchStackItem(stackId);
    return NextResponse.json({ success: true, item: refreshed });
  } catch (error) {
    console.error('[API stack PATCH] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; stackId: string } }
) {
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    const { id: patientId, stackId } = params;
    const existing = await fetchStackItem(stackId);
    if (!existing) {
      return NextResponse.json({ error: 'stack item not found' }, { status: 404 });
    }
    if (existing.patient_id !== patientId) {
      return NextResponse.json({ error: 'stack item does not belong to this patient' }, { status: 403 });
    }

    const entry = buildHistoryEntry({
      action: 'discontinue',
      by: user.user_id,
      by_name: user.display_name || user.email,
      prev: { status: existing.status },
      next: { status: 'discontinued' },
      note: 'soft-delete via DELETE endpoint'
    });

    await query(
      `UPDATE patient_peptide_stack
          SET status = 'discontinued',
              dose_history = dose_history || jsonb_build_array($1::jsonb)
        WHERE stack_id = $2::uuid`,
      [JSON.stringify(entry), stackId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API stack DELETE] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET  /api/patients/[id]/stack
 *   Returns every Stack item for the patient with computed amount_remaining,
 *   next_due_date, schedule, reminder settings. For TRT items the computed
 *   block embeds the full lib/trtEligibility envelope. Also returns the
 *   canonical FDA disclaimer (STACK_FDA_DISCLAIMER) so the patient app
 *   renders the server-provided wording verbatim.
 *
 * POST /api/patients/[id]/stack
 *   Provider dose-set / create stack item. Writes recommended_dose +
 *   schedule + status + supply metadata and appends a dose_history entry.
 *   For item_type='testosterone', also syncs patients.dose_frequency_days
 *   so the existing lib/trtEligibility engine picks up the new cadence
 *   (this is the "tie to staged-doses" — the engine reads dose_frequency_days
 *   and dispenses.syringe_count to compute the next eligibility/stage date).
 *
 * Auth: requireApiUser('read' | 'write')
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  fetchPatientStack,
  buildHistoryEntry,
  STACK_FDA_DISCLAIMER,
  type StackItemType,
  type StackStatus
} from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(request, 'read');
    const patientId = params.id;
    if (!patientId) {
      return NextResponse.json({ error: 'Missing patient id' }, { status: 400 });
    }
    const items = await fetchPatientStack(patientId);
    return NextResponse.json({
      patient_id: patientId,
      items,
      fda_disclaimer: STACK_FDA_DISCLAIMER
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[API stack GET] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — provider dose-set / create
// ---------------------------------------------------------------------------

interface DoseSetBody {
  item_type: StackItemType;
  product_ref?: string | null;       // peptide_products.product_id (peptides)
  product_sku: string;
  display_name: string;
  recommended_dose?: number | null;
  dose_unit?: string | null;
  frequency_code?: string | null;
  inject_days?: string[] | null;
  cadence_days?: number | null;
  anchor_date?: string | null;
  status?: StackStatus;
  vial_size_ml?: number | null;
  syringes_dispensed?: number | null;
  reminder_enabled?: boolean;
  reminder_time?: string | null;
  reminder_method?: 'push' | 'sms' | 'email';
  source_order_id?: string | null;
  note?: string | null;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
    const patientId = params.id;
    const body = (await request.json()) as DoseSetBody;

    if (!body.item_type || !body.product_sku || !body.display_name) {
      return NextResponse.json(
        { error: 'item_type, product_sku, and display_name are required' },
        { status: 400 }
      );
    }
    if (!['peptide', 'testosterone'].includes(body.item_type)) {
      return NextResponse.json({ error: 'invalid item_type' }, { status: 400 });
    }

    // Resolve healthie_id for caching on the stack row (used by patient app).
    const [patient] = await query<{ healthie_client_id: string | null }>(
      `SELECT healthie_client_id FROM patients WHERE patient_id = $1::uuid LIMIT 1`,
      [patientId]
    );
    if (!patient) {
      return NextResponse.json({ error: 'patient not found' }, { status: 404 });
    }

    // Default vial_size_ml to 10 for TRT when caller omits it (spec).
    const vialSizeMl =
      body.vial_size_ml != null
        ? Number(body.vial_size_ml)
        : body.item_type === 'testosterone'
          ? 10
          : 10;

    const historyEntry = buildHistoryEntry({
      action: 'set',
      by: user.user_id,
      by_name: user.display_name || user.email,
      prev: null,
      next: {
        recommended_dose: body.recommended_dose ?? null,
        dose_unit: body.dose_unit ?? null,
        frequency_code: body.frequency_code ?? null,
        cadence_days: body.cadence_days ?? null,
        inject_days: body.inject_days ?? null,
        anchor_date: body.anchor_date ?? null,
        status: body.status ?? 'active'
      },
      note: body.note ?? null
    });

    // UPSERT on (patient_id, item_type, product_sku). If the row already
    // exists, treat this POST as a re-set: append to dose_history with the
    // old snapshot as prev, overwrite the dose/schedule/supply fields.
    // Caller can also use PATCH on /[stackId] for a more surgical adjust.
    const sql = `
      INSERT INTO patient_peptide_stack (
        patient_id, healthie_id, item_type, product_ref, product_sku, display_name,
        recommended_dose, dose_unit, frequency_code, inject_days, cadence_days, anchor_date,
        status, vial_size_ml, syringes_dispensed,
        reminder_enabled, reminder_time, reminder_method,
        recommended_by, recommended_at, dose_history, source_order_id
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::jsonb, $11, $12::date,
        $13, $14, $15,
        $16, $17::time, $18,
        $19::uuid, NOW(), jsonb_build_array($20::jsonb), $21
      )
      ON CONFLICT (patient_id, item_type, product_sku) DO UPDATE SET
        display_name        = EXCLUDED.display_name,
        product_ref         = EXCLUDED.product_ref,
        recommended_dose    = EXCLUDED.recommended_dose,
        dose_unit           = EXCLUDED.dose_unit,
        frequency_code      = EXCLUDED.frequency_code,
        inject_days         = EXCLUDED.inject_days,
        cadence_days        = EXCLUDED.cadence_days,
        anchor_date         = EXCLUDED.anchor_date,
        status              = EXCLUDED.status,
        vial_size_ml        = EXCLUDED.vial_size_ml,
        syringes_dispensed  = EXCLUDED.syringes_dispensed,
        reminder_enabled    = EXCLUDED.reminder_enabled,
        reminder_time       = EXCLUDED.reminder_time,
        reminder_method     = EXCLUDED.reminder_method,
        recommended_by      = EXCLUDED.recommended_by,
        recommended_at      = NOW(),
        dose_history        = patient_peptide_stack.dose_history || jsonb_build_array($20::jsonb),
        source_order_id     = EXCLUDED.source_order_id
      RETURNING stack_id
    `;

    const values = [
      patientId,                                                       // 1
      patient.healthie_client_id,                                      // 2
      body.item_type,                                                  // 3
      body.product_ref ?? null,                                        // 4
      body.product_sku,                                                // 5
      body.display_name,                                               // 6
      body.recommended_dose ?? null,                                   // 7
      body.dose_unit ?? null,                                          // 8
      body.frequency_code ?? null,                                     // 9
      body.inject_days ? JSON.stringify(body.inject_days) : null,      // 10
      body.cadence_days ?? null,                                       // 11
      body.anchor_date ?? null,                                        // 12
      body.status ?? 'active',                                         // 13
      vialSizeMl,                                                      // 14
      body.syringes_dispensed ?? 0,                                    // 15
      body.reminder_enabled ?? false,                                  // 16
      body.reminder_time ?? null,                                      // 17
      body.reminder_method ?? 'push',                                  // 18
      user.user_id,                                                    // 19
      JSON.stringify(historyEntry),                                    // 20
      body.source_order_id ?? null                                     // 21
    ];

    const result = await query<{ stack_id: string }>(sql, values);

    // For TRT: keep patients.dose_frequency_days in sync with the new
    // cadence so the existing trtEligibility engine reflects the change
    // immediately. This is the "tie to staged-doses" hook — the engine
    // reads dose_frequency_days × syringe_count from the last dispense.
    if (body.item_type === 'testosterone' && body.cadence_days && body.cadence_days > 0) {
      await query(
        `UPDATE patients SET dose_frequency_days = $1, updated_at = NOW() WHERE patient_id = $2::uuid`,
        [body.cadence_days, patientId]
      );
    }

    return NextResponse.json({ success: true, stack_id: result[0].stack_id });
  } catch (error) {
    console.error('[API stack POST] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * stackAutoAdd — auto-create a patient_peptide_stack row when a peptide is
 * purchased. Uses the handbook-default columns on peptide_products
 * (default_dose, default_dose_unit, default_frequency_code, default_vial_size_ml).
 *
 * Designed to be called from:
 *   - app/api/headless/checkout (patient-app peptide purchase)
 *   - app/api/ipad/billing/* (iPad-driven peptide sale)
 *   - app/api/peptide-orders/approve (pending → approved)
 *
 * Behavior:
 *   - Upsert on (patient_id, item_type='peptide', product_sku). If the row
 *     already exists active/paused, leaves it alone (don't stomp provider
 *     adjustments). If it exists discontinued, reactivates it as 'active'.
 *   - Seeds with the "lowest typical" handbook dose stored on the product.
 *     If no handbook defaults are present, creates the row in status='pending'
 *     so the provider knows to set a dose.
 *   - Stamps source_order_id with the caller-provided reference.
 *
 * Returns the resulting stack_id and whether a row was inserted vs reused.
 */

import { query } from './db';
import { buildHistoryEntry } from './patientStack';

export interface AutoAddInput {
  patient_id: string;                // UUID
  product_ref: string;               // peptide_products.product_id
  source_order_id?: string | null;   // any external id we want to pin
  // Provider/system that triggered the add. NULL => system auto-add (no user).
  triggered_by_user_id?: string | null;
  triggered_by_name?: string | null;
}

export interface AutoAddResult {
  stack_id: string;
  created: boolean;        // true = new row, false = reused existing
  reactivated: boolean;    // true = was discontinued, now active
  used_defaults: boolean;  // true = handbook defaults were applied
  status: 'active' | 'pending' | 'paused' | 'discontinued';
}

interface ProductRow {
  product_id: string;
  name: string;
  sku: string | null;
  default_dose: string | null;
  default_dose_unit: string | null;
  default_frequency_code: string | null;
  default_vial_size_ml: string | null;
}

export async function autoAddPeptideToStack(input: AutoAddInput): Promise<AutoAddResult> {
  const [product] = await query<ProductRow>(
    `SELECT product_id, name, sku,
            default_dose, default_dose_unit,
            default_frequency_code, default_vial_size_ml
       FROM peptide_products
      WHERE product_id = $1::uuid LIMIT 1`,
    [input.product_ref]
  );
  if (!product) {
    throw new Error(`peptide product not found: ${input.product_ref}`);
  }

  // product_sku falls back to product_id when no SKU is set on the catalog row.
  const productSku = product.sku || product.product_id;
  const hasDefaults = product.default_dose !== null && product.default_dose_unit !== null;
  const seededStatus = hasDefaults ? 'active' : 'pending';

  // Cache healthie id for the patient app.
  const [pt] = await query<{ healthie_client_id: string | null }>(
    `SELECT healthie_client_id FROM patients WHERE patient_id = $1::uuid LIMIT 1`,
    [input.patient_id]
  );

  const cadenceDays = frequencyToCadenceDays(product.default_frequency_code);

  // Look for an existing row first so we can decide whether to insert,
  // skip, or reactivate.
  const [existing] = await query<{ stack_id: string; status: string }>(
    `SELECT stack_id, status FROM patient_peptide_stack
      WHERE patient_id = $1::uuid AND item_type = 'peptide' AND product_sku = $2
      LIMIT 1`,
    [input.patient_id, productSku]
  );

  if (existing) {
    // Active/pending/paused: leave dose/schedule alone. Just bump source_order_id.
    if (existing.status !== 'discontinued') {
      if (input.source_order_id) {
        await query(
          `UPDATE patient_peptide_stack SET source_order_id = $1 WHERE stack_id = $2::uuid`,
          [input.source_order_id, existing.stack_id]
        );
      }
      return {
        stack_id: existing.stack_id,
        created: false,
        reactivated: false,
        used_defaults: false,
        status: existing.status as AutoAddResult['status']
      };
    }

    // Discontinued: reactivate at handbook defaults, append audit.
    const entry = buildHistoryEntry({
      action: 'resume',
      by: input.triggered_by_user_id ?? null,
      by_name: input.triggered_by_name ?? 'auto-add-on-purchase',
      prev: { status: 'discontinued' },
      next: { status: seededStatus, recommended_dose: product.default_dose, dose_unit: product.default_dose_unit },
      note: input.source_order_id ? `reactivated by order ${input.source_order_id}` : 'reactivated by purchase'
    });

    await query(
      `UPDATE patient_peptide_stack
          SET status = $1,
              recommended_dose = COALESCE($2::numeric, recommended_dose),
              dose_unit = COALESCE($3, dose_unit),
              frequency_code = COALESCE($4, frequency_code),
              cadence_days = COALESCE($5::numeric, cadence_days),
              vial_size_ml = COALESCE($6::numeric, vial_size_ml),
              source_order_id = $7,
              dose_history = dose_history || jsonb_build_array($8::jsonb)
        WHERE stack_id = $9::uuid`,
      [
        seededStatus,
        product.default_dose,
        product.default_dose_unit,
        product.default_frequency_code,
        cadenceDays,
        product.default_vial_size_ml,
        input.source_order_id ?? null,
        JSON.stringify(entry),
        existing.stack_id
      ]
    );

    return {
      stack_id: existing.stack_id,
      created: false,
      reactivated: true,
      used_defaults: hasDefaults,
      status: seededStatus
    };
  }

  // Brand-new insert.
  const entry = buildHistoryEntry({
    action: 'set',
    by: input.triggered_by_user_id ?? null,
    by_name: input.triggered_by_name ?? 'auto-add-on-purchase',
    prev: null,
    next: {
      recommended_dose: product.default_dose,
      dose_unit: product.default_dose_unit,
      frequency_code: product.default_frequency_code,
      cadence_days: cadenceDays,
      status: seededStatus
    },
    note: input.source_order_id
      ? `seeded from purchase ${input.source_order_id} at handbook default`
      : 'seeded from purchase at handbook default'
  });

  const inserted = await query<{ stack_id: string }>(
    `INSERT INTO patient_peptide_stack (
       patient_id, healthie_id, item_type, product_ref, product_sku, display_name,
       recommended_dose, dose_unit, frequency_code, cadence_days,
       status, vial_size_ml,
       recommended_at, dose_history, source_order_id
     ) VALUES (
       $1::uuid, $2, 'peptide', $3::uuid, $4, $5,
       $6, $7, $8, $9,
       $10, COALESCE($11::numeric, 10),
       NOW(), jsonb_build_array($12::jsonb), $13
     )
     RETURNING stack_id`,
    [
      input.patient_id,                                  // 1
      pt?.healthie_client_id ?? null,                    // 2
      product.product_id,                                // 3
      productSku,                                        // 4
      product.name,                                      // 5
      product.default_dose,                              // 6
      product.default_dose_unit,                         // 7
      product.default_frequency_code,                    // 8
      cadenceDays,                                       // 9
      seededStatus,                                      // 10
      product.default_vial_size_ml,                      // 11
      JSON.stringify(entry),                             // 12
      input.source_order_id ?? null                      // 13
    ]
  );

  return {
    stack_id: inserted[0].stack_id,
    created: true,
    reactivated: false,
    used_defaults: hasDefaults,
    status: seededStatus
  };
}

/**
 * Map handbook frequency codes to numeric cadence days. Unknown codes
 * return null (the stack row stores frequency_code as-is and lets the
 * provider set cadence_days explicitly if the code is non-standard).
 */
export function frequencyToCadenceDays(code: string | null): number | null {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  if (c === 'daily' || c === 'qd') return 1;
  if (c === 'q2d' || c === 'every_other_day' || c === 'eod') return 2;
  if (c === 'q3d') return 3;
  if (c === 'q4d') return 4;
  if (c === 'q5d') return 5;
  if (c === 'q6d') return 6;
  if (c === 'weekly' || c === 'q7d' || c === 'qw') return 7;
  if (c === '2x_week' || c === 'biw' || c === 'twice_weekly') return 3.5;
  if (c === '3x_week' || c === 'tiw') return 2.33;
  if (c === 'monthly' || c === 'q30d') return 30;
  // Allow callers to encode a literal number-of-days as e.g. 'q14d'.
  const m = /^q(\d+(?:\.\d+)?)d$/.exec(c);
  if (m) return Number(m[1]);
  return null;
}

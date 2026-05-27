/**
 * POST /api/patients/[id]/stack/auto-add
 *   Manual / test trigger for the auto-add-on-purchase hook. Production
 *   callers should import autoAddPeptideToStack from lib/stackAutoAdd
 *   directly from inside their purchase / approval handlers — this route
 *   exists so QA and ops can seed a stack row without simulating a full
 *   checkout, and so the iPad/staff side can drop a "starter recommendation"
 *   onto a patient's chart.
 *
 *   Body:
 *     product_ref      string  (required) — peptide_products.product_id (UUID)
 *     source_order_id  string  (optional)
 *
 *   Returns the autoAddPeptideToStack result envelope.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { autoAddPeptideToStack } from '@/lib/stackAutoAdd';

export const dynamic = 'force-dynamic';

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
    const body = await request.json();
    if (!body.product_ref) {
      return NextResponse.json({ error: 'product_ref is required' }, { status: 400 });
    }
    const result = await autoAddPeptideToStack({
      patient_id: params.id,
      product_ref: body.product_ref,
      source_order_id: body.source_order_id ?? null,
      triggered_by_user_id: user.user_id,
      triggered_by_name: user.display_name || user.email
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API stack auto-add POST] Failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

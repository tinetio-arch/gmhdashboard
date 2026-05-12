/**
 * GET /api/headless/dispense-eligibility?healthieId=12345
 *
 * Returns TRT refill eligibility for a patient. Powers:
 *   - Men's Health mobile app banner (§8.7.6)
 *   - iPad/mobile staff patient-detail eligibility badge (💉)
 *
 * Auth: x-jarvis-secret header
 *
 * Response shape:
 *   { applicable, state, lastDispenseDate, nextEligibleDate, graceStartDate,
 *     daysUntilEligible, daysUntilGrace, syringeCount, doseMl, cadenceDays,
 *     cadenceSource, reason }
 *
 * See docs/sot-modules/25-patient-classification-and-dashboard.md §8.7.6.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { computeDispenseEligibility } from '@/lib/trtEligibility';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-jarvis-secret');
  if (secret !== process.env.JARVIS_SHARED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const healthieId = request.nextUrl.searchParams.get('healthieId');
  if (!healthieId) {
    return NextResponse.json({ error: 'Missing healthieId' }, { status: 400 });
  }

  try {
    // Resolve healthie_client_id → local patient_id (UUID)
    const [patient] = await query<{ patient_id: string }>(
      `SELECT patient_id::text AS patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
      [healthieId]
    );

    if (!patient) {
      return NextResponse.json({
        applicable: false,
        state: 'n/a',
        reason: 'patient_not_found'
      });
    }

    const result = await computeDispenseEligibility(patient.patient_id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Dispense Eligibility] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

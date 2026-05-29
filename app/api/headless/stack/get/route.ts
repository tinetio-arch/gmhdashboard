/**
 * POST /api/headless/stack/get
 *   Headless wrapper around fetchPatientStack — accepts a Healthie user id
 *   (the only id the mobile app holds) and maps it to the internal
 *   patient_id UUID before calling the unified stack engine.
 *
 * Auth: x-jarvis-secret (same pattern as /api/headless/push-tokens/*).
 *
 * Request body: { userId: string }
 *   userId = Healthie client id (string of digits, e.g. "12123979").
 *
 * Response: {
 *   patient_id: string,
 *   items: StackItemComputed[],
 *   fda_disclaimer: string,
 * }
 *
 * Built 2026-05-28 after Phil flagged that the patient app's TRT card was
 * invisible because no Lambda action existed for the Stack data path.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { fetchPatientStack, STACK_FDA_DISCLAIMER } from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

async function resolvePatientId(userId: string): Promise<string | null> {
  // Most common path: mobile app holds Healthie client id (digits).
  if (/^\d+$/.test(userId)) {
    const rows = await query<{ patient_id: string }>(
      `SELECT patient_id::text AS patient_id
         FROM healthie_clients
        WHERE healthie_client_id = $1 AND is_active = true
        LIMIT 1`,
      [userId]
    );
    if (rows[0]?.patient_id) return rows[0].patient_id;
    // Legacy fallback: patients table may carry healthie_client_id directly.
    const direct = await query<{ patient_id: string }>(
      `SELECT patient_id::text AS patient_id
         FROM patients
        WHERE healthie_client_id = $1
        LIMIT 1`,
      [userId]
    );
    return direct[0]?.patient_id ?? null;
  }
  // If the caller already passed a UUID (e.g. iPad debug curl), accept it.
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
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }
    const patientId = await resolvePatientId(userId);
    if (!patientId) {
      // Empty stack rather than 404 — mobile app treats null as "no data,
      // fall back to legacy local log" and keeps the screen useful.
      return NextResponse.json({
        patient_id: null,
        items: [],
        fda_disclaimer: STACK_FDA_DISCLAIMER,
      });
    }
    const items = await fetchPatientStack(patientId);
    return NextResponse.json({
      patient_id: patientId,
      items,
      fda_disclaimer: STACK_FDA_DISCLAIMER,
    });
  } catch (err: any) {
    console.error('[headless/stack/get] Error:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

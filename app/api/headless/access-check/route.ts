/**
 * Headless App Access Check Endpoint
 * 
 * The headless mobile app calls this AFTER authenticating with Healthie 
 * to verify the user is allowed to access the app.
 * 
 * GET /api/headless/access-check?healthie_id=XXXX
 * 
 * Returns:
 *   200 { allowed: true }   — user can proceed
 *   403 { allowed: false, reason: "..." } — user is blocked
 *   404 { error: "Patient not found" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getPatientAccessStatus } from '@/lib/appAccessControl';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const healthieId = searchParams.get('healthie_id');

        if (!healthieId) {
            return NextResponse.json(
                { error: 'healthie_id parameter is required' },
                { status: 400 }
            );
        }

        const pool = getPool();

        // Find patient by Healthie ID
        const patientResult = await pool.query<{ patient_id: string; status_key: string | null; full_name: string }>(`
            SELECT p.patient_id, p.status_key, p.full_name
            FROM patients p
            WHERE p.healthie_client_id = $1
            UNION
            SELECT p.patient_id, p.status_key, p.full_name
            FROM healthie_clients hc
            JOIN patients p ON p.patient_id::text = hc.patient_id
            WHERE hc.healthie_client_id = $1 AND hc.is_active = true
            LIMIT 1
        `, [healthieId]);

        if (patientResult.rows.length === 0) {
            // Patient not in our system — could be a new patient not yet synced
            // Default to allowed (they authenticated with Healthie successfully)
            return NextResponse.json({ allowed: true, reason: 'Patient not found in GMH — defaulting to allowed' });
        }

        const patient = patientResult.rows[0];

        // Check access control (includes inactive status_key check)
        const accessCheck = await getPatientAccessStatus(patient.patient_id);

        if (accessCheck.status === 'revoked' || accessCheck.status === 'suspended') {
            console.warn(`[Headless Access Check] BLOCKED: ${patient.full_name} (Healthie: ${healthieId}) — status: ${accessCheck.status}`);
            return NextResponse.json(
                {
                    allowed: false,
                    reason: accessCheck.status === 'suspended'
                        ? 'Your account has been temporarily suspended. Please contact the clinic.'
                        : 'Your account access has been revoked. Please contact the clinic.',
                    status: accessCheck.status,
                },
                { status: 403 }
            );
        }

        return NextResponse.json({ allowed: true });

    } catch (error) {
        console.error('[Headless Access Check] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

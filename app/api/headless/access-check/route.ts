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
        const secret = request.headers.get('x-jarvis-secret');
        if (secret !== process.env.JARVIS_SHARED_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const healthieId = searchParams.get('healthie_id');
        const cachedGroup = searchParams.get('cached_group');

        if (!healthieId) {
            return NextResponse.json(
                { error: 'healthie_id parameter is required' },
                { status: 400 }
            );
        }

        const pool = getPool();

        // Find patient by Healthie ID
        const patientResult = await pool.query<{ patient_id: string; status_key: string | null; full_name: string; healthie_group_id: string | null }>(`
            SELECT p.patient_id, p.status_key, p.full_name, p.healthie_group_id
            FROM patients p
            WHERE p.healthie_client_id = $1
            UNION
            SELECT p.patient_id, p.status_key, p.full_name, p.healthie_group_id
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

        if (cachedGroup && patient.healthie_group_id && String(cachedGroup) !== String(patient.healthie_group_id)) {
            console.warn(`[Headless Access Check] GROUP MISMATCH: ${patient.full_name} (Healthie: ${healthieId}) — cached=${cachedGroup} current=${patient.healthie_group_id}`);
            return NextResponse.json(
                {
                    allowed: false,
                    reason: 'Your account was updated. Please sign in again to continue.',
                    status: 'group_changed',
                },
                { status: 403 }
            );
        }

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

        // Phase 4 (ABXTAC payment-hold lockout) — policy §8.6.9 + Core Principle #8.
        // Feature-flagged off by default via ABXTAC_LOCKOUT_ENABLED env var so we can
        // ship this code dark, manually verify the blocklist, then flip the flag.
        // ONLY ABXTAC patients get locked out for billing reasons — all other care lines
        // log in normally regardless of billing state.
        if (process.env.ABXTAC_LOCKOUT_ENABLED === 'true') {
            try {
                const abxtacResult = await pool.query<{ membership_status: string | null }>(`
                    SELECT a.membership_status
                    FROM abxtac_customer_access a
                    JOIN patients p ON p.healthie_client_id = a.healthie_patient_id
                    WHERE p.patient_id = $1
                    LIMIT 1
                `, [patient.patient_id]);
                const status = abxtacResult.rows[0]?.membership_status ?? null;
                if (status === 'payment_hold') {
                    console.warn(`[Headless Access Check] BLOCKED (ABXTAC payment_hold): ${patient.full_name} (Healthie: ${healthieId})`);
                    return NextResponse.json(
                        {
                            allowed: false,
                            reason: 'Your ABXTAC membership is on billing hold. Please contact GMH to resolve payment and restore access.',
                            status: 'abxtac_payment_hold',
                        },
                        { status: 403 }
                    );
                }
            } catch (abxErr) {
                // Table might not exist in some envs — fail-open (don't lock anyone out due to infra issue).
                console.warn('[Headless Access Check] ABXTAC lockout check failed (fail-open):', (abxErr as Error).message);
            }
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

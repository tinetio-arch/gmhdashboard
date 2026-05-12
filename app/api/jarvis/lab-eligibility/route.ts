import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/jarvis/lab-eligibility?healthieId=12345
 *
 * Gates BioBox at-home lab kit purchases. Patient must have completed a
 * provider consult within the last 365 days to order a kit.
 *
 * Returns:
 *   - eligible:        true if patient can order a BioBox kit
 *   - reason:          'consult_verified' | 'no_patient' | 'no_consult' | 'consult_expired'
 *   - last_consult_date: YYYY-MM-DD string or null
 *   - days_since_consult: integer or null
 *   - tier:            'heal' | 'optimize' | 'thrive' | 'full' | null (membership tier, if any)
 *   - tier_expires_at: ISO timestamp or null
 *
 * Auth: x-jarvis-secret header (matches peptide-eligibility pattern)
 *
 * Used by:
 *   - WooCommerce checkout eligibility gate (abxtac.com)
 *   - Native mobile app BioBox ordering screen
 *   - iPad/mobile web dashboard staff-ordering modal
 */
export async function GET(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthieId');
    const email = request.nextUrl.searchParams.get('email');

    if (!healthieId && !email) {
        return NextResponse.json(
            { error: 'Must provide healthieId or email' },
            { status: 400 }
        );
    }

    try {
        // 1. Resolve patient record
        const [patient] = await query<{
            patient_id: string;
            patient_name: string;
            email: string;
            healthie_client_id: string;
        }>(`
            SELECT
                p.patient_id,
                COALESCE(p.full_name, 'Unknown') as patient_name,
                p.email,
                p.healthie_client_id
            FROM patients p
            WHERE ($1::text IS NOT NULL AND p.healthie_client_id = $1)
               OR ($2::text IS NOT NULL AND LOWER(p.email) = LOWER($2))
            LIMIT 1
        `, [healthieId, email]);

        if (!patient) {
            return NextResponse.json({
                eligible: false,
                reason: 'no_patient',
                last_consult_date: null,
                days_since_consult: null,
                tier: null,
                tier_expires_at: null,
            });
        }

        // 2. Check abxtac_customer_access for provider-verified consult record
        //    This table is populated when a patient completes a visit with a
        //    NOWOptimal provider — same gate used for peptide tier access.
        let access: {
            tier: string;
            tier_expires_at: string;
            last_visit_date: string | null;
            provider_verified: boolean;
        } | undefined;

        try {
            [access] = await query<{
                tier: string;
                tier_expires_at: string;
                last_visit_date: string | null;
                provider_verified: boolean;
            }>(`
                SELECT tier, tier_expires_at, last_visit_date, provider_verified
                FROM abxtac_customer_access
                WHERE ($1::text IS NOT NULL AND healthie_patient_id = $1)
                   OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2))
                LIMIT 1
            `, [healthieId, patient.email]);
        } catch {
            // Table may not exist in some envs — treat as no access record
            access = undefined;
        }

        if (!access || !access.provider_verified) {
            return NextResponse.json({
                eligible: false,
                reason: 'no_consult',
                last_consult_date: null,
                days_since_consult: null,
                tier: null,
                tier_expires_at: null,
            });
        }

        // 3. Check consult freshness (365-day window, same as tier expiry)
        const expiresAt = new Date(access.tier_expires_at);
        const now = new Date();
        const isExpired = expiresAt < now;

        const lastConsultDate = access.last_visit_date;
        let daysSinceConsult: number | null = null;
        if (lastConsultDate) {
            const lastConsult = new Date(lastConsultDate);
            daysSinceConsult = Math.floor(
                (now.getTime() - lastConsult.getTime()) / (1000 * 60 * 60 * 24)
            );
        }

        if (isExpired) {
            return NextResponse.json({
                eligible: false,
                reason: 'consult_expired',
                last_consult_date: lastConsultDate,
                days_since_consult: daysSinceConsult,
                tier: access.tier,
                tier_expires_at: access.tier_expires_at,
            });
        }

        // 4. Eligible — return consult verification + tier metadata
        return NextResponse.json({
            eligible: true,
            reason: 'consult_verified',
            last_consult_date: lastConsultDate,
            days_since_consult: daysSinceConsult,
            tier: access.tier,
            tier_expires_at: access.tier_expires_at,
            patient_name: patient.patient_name,
        });

    } catch (error) {
        console.error('[Jarvis Lab Eligibility] Error:', error);
        return NextResponse.json(
            { error: 'Failed to check eligibility' },
            { status: 500 }
        );
    }
}

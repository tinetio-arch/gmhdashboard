import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/jarvis/peptide-eligibility?healthieId=12345
 *
 * Checks whether a patient is eligible for peptides and what options they have:
 *   - canPickup: true if in eligible group OR has peptide tag (in-house dispense)
 *   - canShip: true if has ABXTac tier access (WooCommerce dropship via YPB)
 *   - availableForShipping: list of YPB products currently available (from synced Google Sheet)
 *   - inHouseProducts: list of in-house peptide products with stock levels
 *
 * Eligible groups: ABXTac, NowMensHealth.Care (75522), NowPrimary.Care (75523)
 * Eligible tags: 'peptide', 'peptides'
 *
 * Auth: x-jarvis-secret header
 */
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
        // 1. Check patient group and tags
        // ghl_tags is a JSONB array of strings, e.g. ["Active Patient", "existing", "GMH Patient"]
        // clinic is a string like "nowmenshealth.care" or "nowprimary.care"
        const [patient] = await query<{
            patient_id: string;
            patient_name: string;
            email: string;
            healthie_client_id: string;
            clinic: string;
            ghl_tags: string[] | null;
        }>(`
            SELECT
                p.patient_id,
                COALESCE(p.full_name, 'Unknown') as patient_name,
                p.email,
                p.healthie_client_id,
                p.clinic,
                p.ghl_tags
            FROM patients p
            WHERE p.healthie_client_id = $1
            LIMIT 1
        `, [healthieId]);

        if (!patient) {
            return NextResponse.json({
                eligible: false,
                canPickup: false,
                canShip: false,
                reason: 'Patient not found',
            });
        }

        const tags = (patient.ghl_tags || []).map(t => t.toLowerCase());
        const clinic = (patient.clinic || '').toLowerCase();

        // Eligibility: ABXTac group, Men's Health, Primary Care, or has peptide/peptides tag
        const hasPeptideTag = tags.some(t => t === 'peptide' || t === 'peptides');
        const isEligibleGroup = clinic.includes('abx') ||
            clinic.includes('men') ||
            clinic.includes('primary');

        const canPickup = hasPeptideTag || isEligibleGroup;

        // 2. Check ABXTac tier access for shipping eligibility
        let canShip = false;
        let tier = null;
        let tierExpired = false;

        try {
            const [access] = await query<{
                tier: string;
                tier_expires_at: string;
                provider_verified: boolean;
            }>(`
                SELECT tier, tier_expires_at, provider_verified
                FROM abxtac_customer_access
                WHERE email = $1 OR healthie_patient_id = $2
                LIMIT 1
            `, [patient.email, healthieId]);

            if (access) {
                tier = access.tier;
                const expiresAt = new Date(access.tier_expires_at);
                tierExpired = expiresAt < new Date();
                canShip = access.provider_verified && !tierExpired;
            }
        } catch {
            // abxtac_customer_access table may not exist — that's OK
        }

        // 3. Get in-house peptide products with stock (for pickup)
        let inHouseProducts: { name: string; stock: number; product_id: string }[] = [];
        if (canPickup) {
            try {
                inHouseProducts = await query<{ name: string; stock: number; product_id: string }>(`
                    SELECT
                        p.name,
                        p.product_id,
                        COALESCE(SUM(o.quantity), 0) - COALESCE(
                            (SELECT SUM(d.quantity)
                             FROM peptide_dispenses d
                             WHERE d.product_id = p.product_id
                               AND d.status = 'Paid'
                               AND d.education_complete = true),
                            0
                        ) as stock
                    FROM peptide_products p
                    LEFT JOIN peptide_orders o ON o.product_id = p.product_id
                    WHERE p.active = true
                    GROUP BY p.product_id, p.name
                    ORDER BY p.name
                `);
            } catch {
                // peptide tables may not have data
            }
        }

        // 4. Get YPB products available for shipping (from synced Google Sheet)
        let availableForShipping: { sku: string; product_name: string; dose: string; price: number | null }[] = [];
        if (canShip) {
            try {
                availableForShipping = await query<{
                    sku: string;
                    product_name: string;
                    dose: string;
                    price: number | null;
                }>(`
                    SELECT sku, product_name, dose, price
                    FROM ypb_available_products
                    WHERE available = true
                    ORDER BY product_name, dose
                `);
            } catch {
                // ypb_available_products table may not exist yet (sync hasn't run)
            }
        }

        return NextResponse.json({
            eligible: canPickup || canShip,
            canPickup,
            canShip,
            tier,
            tierExpired,
            inHouseProducts,
            availableForShipping,
            patientName: patient.patient_name,
        });

    } catch (error) {
        console.error('[Jarvis Peptide Eligibility] Error:', error);
        return NextResponse.json({ error: 'Failed to check eligibility' }, { status: 500 });
    }
}

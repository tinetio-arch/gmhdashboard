import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPeptideDiscountForPatient, applyDiscount } from '@/lib/peptideDiscount';

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
            client_type_key: string | null;
        }>(`
            SELECT
                p.patient_id,
                COALESCE(p.full_name, 'Unknown') as patient_name,
                p.email,
                p.healthie_client_id,
                p.clinic,
                p.ghl_tags,
                p.client_type_key
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

        let canPickup = hasPeptideTag || isEligibleGroup;

        // 2. Check ABXTac tier access for shipping eligibility
        let canShip = false;
        let tier: string | null = null;
        let tierExpired = false;

        // FIX(2026-04-16): Wholesale visibility is RESTRICTED. Only two admin accounts
        // see at-cost pricing. Removed admin@granitemountainhealth.com and any staff
        // accounts. No patient or staff should ever see wholesale prices.
        const WHOLESALE_ADMIN_EMAILS = new Set([
            'philschafer7@gmail.com',
            'admin@nowoptimal.com',
        ]);
        const isAdmin = !!patient.email && WHOLESALE_ADMIN_EMAILS.has(String(patient.email).toLowerCase().trim());
        if (isAdmin) {
            canShip = true;
            canPickup = true;
            tier = 'admin';
        }

        // NOW brand members default to Optimize tier (20% off).
        // Phase 3b: also honor client_type_key (populated by the 2026-04-17 classification batch)
        // — previously only clinic was checked, which left classified-but-clinic-null patients out.
        const clientTypeKey = (patient.client_type_key || '').toLowerCase();
        const isMensHealth = clinic.includes('men') || clinic.includes('nowmenshealth')
            || clientTypeKey === 'nowmenshealth';
        const isPrimaryCare = clinic.includes('primary') || clinic.includes('nowprimary')
            || clientTypeKey === 'nowprimarycare';
        const isLongevity = clientTypeKey === 'nowlongevity';
        if (!tier && (isMensHealth || isPrimaryCare || isLongevity || isEligibleGroup)) {
            canShip = true;
            tier = 'optimize';
        }

        // Check for upgraded tier in abxtac_customer_access (Optimize/Thrive packages)
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

            if (access && access.provider_verified) {
                const expiresAt = new Date(access.tier_expires_at);
                tierExpired = expiresAt < new Date();
                if (!tierExpired) {
                    // FIX(2026-04-16): Only override to a HIGHER tier. Admin (50%) is
                    // the top rank — never downgrade admin to package tier (full/thrive/etc).
                    const TIER_RANK: Record<string, number> = { heal: 1, optimize: 2, thrive: 3, full: 4, admin: 5 };
                    const currentRank = tier ? (TIER_RANK[tier] || 0) : 0;
                    const accessRank = TIER_RANK[access.tier] || 0;
                    if (accessRank > currentRank) {
                        tier = access.tier;
                    }
                    canShip = true;
                }
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

        // 4. Get YPB products available for shipping (from synced Google Sheet).
        // FIX(2026-04-16): Admin tier now returns `admin_price = wholesale_cost + $10`
        // per SKU (flat at-cost markup) instead of 50% off retail.
        const HANDLING_FEE = 10;
        let availableForShipping: {
            sku: string; product_name: string; dose: string;
            price: number | null;
            wholesale_cost: number | null;
            admin_price: number | null;
        }[] = [];
        if (canShip) {
            try {
                // FIX(2026-04-16): Only return products that have images (SKU range
                // YPB.200-YPB.249). Hiding SKUs without mockups from the shop UI.
                const rows = await query<{
                    sku: string;
                    product_name: string;
                    dose: string;
                    price: string | null;
                    wholesale_cost: string | null;
                }>(`
                    SELECT sku, product_name, dose, price, wholesale_cost
                    FROM ypb_available_products
                    WHERE available = true
                      AND has_image = true
                    ORDER BY product_name, dose
                `);
                // Phase 3b: compute member discount server-side and return
                // member_price alongside retail. Mobile app shows the member price
                // so patients see their actual cost, not retail.
                const discountInfo = await getPeptideDiscountForPatient({
                    healthie_client_id: patient.healthie_client_id,
                    email: patient.email,
                    client_type_key: patient.client_type_key
                });
                availableForShipping = rows.map(r => {
                    const wc = r.wholesale_cost != null ? Number(r.wholesale_cost) : null;
                    const retail = r.price != null ? Number(r.price) : null;
                    const memberPrice = retail != null ? applyDiscount(retail, discountInfo.discountPct) : null;
                    // FIX(2026-04-16): SECURITY — only return wholesale_cost + admin_price
                    // to admin accounts. Patients/staff see price field only.
                    return {
                        sku: r.sku,
                        product_name: r.product_name,
                        dose: r.dose,
                        price: memberPrice ?? retail, // Display price = member price (retail if no discount)
                        retail_price: retail,          // Always show what retail was (for "you saved X" UI)
                        member_price: memberPrice,
                        discount_pct: discountInfo.discountPct,
                        discount_tier: discountInfo.tier,
                        wholesale_cost: isAdmin ? wc : null,
                        admin_price: isAdmin && wc != null ? Number((wc + HANDLING_FEE).toFixed(2)) : null,
                    };
                });
            } catch {
                // ypb_available_products table may not exist yet (sync hasn't run)
            }
        }

        // Top-level discount summary (mirrors per-line discount_pct so mobile app
        // can render "Your Optimize tier: 20% off" banner without scanning items).
        const summaryDiscount = await getPeptideDiscountForPatient({
            healthie_client_id: patient.healthie_client_id,
            email: patient.email,
            client_type_key: patient.client_type_key
        });

        return NextResponse.json({
            eligible: canPickup || canShip,
            canPickup,
            canShip,
            tier,
            tierExpired,
            inHouseProducts,
            availableForShipping,
            patientName: patient.patient_name,
            discount: {
                tier: summaryDiscount.tier,
                pct: summaryDiscount.discountPct,
                reason: summaryDiscount.reason,
            },
        });

    } catch (error) {
        console.error('[Jarvis Peptide Eligibility] Error:', error);
        return NextResponse.json({ error: 'Failed to check eligibility' }, { status: 500 });
    }
}

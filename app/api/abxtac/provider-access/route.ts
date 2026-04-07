/**
 * ABXTac Provider-Visit Access API
 *
 * Endpoints:
 *   GET  - Check a customer's current tier access by email
 *   POST - Verify a patient via Healthie and assign/upgrade tier access
 *
 * This is the bridge between Healthie EHR visits and WooCommerce discount tiers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import {
  recordProviderVisit,
  getCustomerAccess,
  verifyProviderVisitFromHealthie,
  linkWooCustomer,
  buildTierCouponPayload,
  type ABXTacTier,
  type ProviderVisitRecord,
  TIER_DISCOUNTS,
} from '@/lib/abxtac-provider-access';
import { getHealthieClient } from '@/lib/healthie';
import { getABXTacClient } from '@/lib/abxtac-woo';

const VALID_TIERS: ABXTacTier[] = ['heal', 'optimize', 'thrive', 'full'];

/**
 * GET /api/abxtac/provider-access?email=patient@example.com
 *
 * Returns the customer's current tier, discount, and verification status.
 */
export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');

  try {
    const email = request.nextUrl.searchParams.get('email');
    if (!email) {
      return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
    }

    const access = await getCustomerAccess(email);

    if (!access) {
      return NextResponse.json({
        found: false,
        email: email.toLowerCase(),
        message: 'No provider-verified access record found for this email.',
      });
    }

    const expired = new Date(access.tierExpiresAt) < new Date();

    return NextResponse.json({
      found: true,
      email: access.email,
      tier: access.tier,
      discountPercent: expired ? 0 : TIER_DISCOUNTS[access.tier],
      providerVerified: access.providerVerified && !expired,
      providerName: access.providerName,
      lastVisitDate: access.lastVisitDate,
      tierAssignedAt: access.tierAssignedAt,
      tierExpiresAt: access.tierExpiresAt,
      expired,
      wooCustomerId: access.customerId || null,
    });
  } catch (error: any) {
    console.error('[ABXTac] Error fetching provider access:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/abxtac/provider-access
 *
 * Two modes:
 *   1. Manual assignment: provide full visit details (admin use)
 *   2. Auto-verify: provide just email + tier, we check Healthie for visit evidence
 *
 * Body (manual):
 *   { email, tier, providerName, visitDate, healthiePatientId?, planOfCare?, wooCustomerId? }
 *
 * Body (auto-verify):
 *   { email, tier, autoVerify: true, wooCustomerId? }
 */
export async function POST(request: NextRequest) {
  await requireApiUser(request, 'write');

  try {
    const body = await request.json();
    const { email, tier, autoVerify, wooCustomerId } = body;

    // Validate required fields
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    if (!tier || !VALID_TIERS.includes(tier)) {
      return NextResponse.json(
        { error: `tier must be one of: ${VALID_TIERS.join(', ')}` },
        { status: 400 }
      );
    }

    let visitRecord: ProviderVisitRecord;

    if (autoVerify) {
      // Mode 2: Auto-verify via Healthie
      const healthie = getHealthieClient();
      const verification = await verifyProviderVisitFromHealthie(healthie, email);

      if (!verification.verified || !verification.visit) {
        return NextResponse.json({
          success: false,
          verified: false,
          message: 'No completed provider visit found in Healthie for this email. '
            + 'Patient must complete a visit with a NOWOptimal Network provider before tier access can be granted.',
        }, { status: 404 });
      }

      visitRecord = {
        healthiePatientId: verification.visit.healthiePatientId || '',
        email: verification.visit.email || email,
        firstName: verification.visit.firstName || '',
        lastName: verification.visit.lastName || '',
        providerName: verification.visit.providerName || 'NOWOptimal Network Provider',
        visitDate: verification.visit.visitDate || new Date().toISOString().split('T')[0],
        visitType: 'provider_verified',
        assignedTier: tier as ABXTacTier,
      };

      console.log(`[ABXTac] Auto-verified patient ${email} via Healthie (patient ID: ${visitRecord.healthiePatientId})`);
    } else {
      // Mode 1: Manual assignment by admin
      const { providerName, visitDate, healthiePatientId, planOfCare } = body;

      if (!providerName || typeof providerName !== 'string') {
        return NextResponse.json(
          { error: 'providerName is required for manual assignment (or use autoVerify: true)' },
          { status: 400 }
        );
      }

      visitRecord = {
        healthiePatientId: healthiePatientId || '',
        email,
        firstName: body.firstName || '',
        lastName: body.lastName || '',
        providerName,
        visitDate: visitDate || new Date().toISOString().split('T')[0],
        visitType: body.visitType || 'manual_assignment',
        assignedTier: tier as ABXTacTier,
        planOfCare,
      };

      console.log(`[ABXTac] Manual tier assignment for ${email} → ${tier} by ${providerName}`);
    }

    // Record the visit and assign tier
    const access = await recordProviderVisit(visitRecord);

    // Link WooCommerce customer ID if provided
    if (wooCustomerId && typeof wooCustomerId === 'number') {
      await linkWooCustomer(email, wooCustomerId);
      access.customerId = wooCustomerId;
    }

    // Create/update the WooCommerce coupon for this customer
    let couponSynced = false;
    try {
      const woo = getABXTacClient();
      const couponPayload = buildTierCouponPayload(email, access.tier);
      const { action } = await woo.syncCoupon(couponPayload);
      couponSynced = true;
      console.log(`[ABXTac] WooCommerce coupon ${action} for ${email}: ${couponPayload.code} (${access.tier} tier, ${TIER_DISCOUNTS[access.tier]}% off)`);
    } catch (couponError: any) {
      // Non-fatal — the access record is saved, coupon can be retried
      console.error(`[ABXTac] Failed to sync WooCommerce coupon for ${email}:`, couponError.message);
    }

    return NextResponse.json({
      success: true,
      verified: true,
      access: {
        email: access.email,
        tier: access.tier,
        discountPercent: TIER_DISCOUNTS[access.tier],
        providerVerified: access.providerVerified,
        providerName: access.providerName,
        lastVisitDate: access.lastVisitDate,
        tierAssignedAt: access.tierAssignedAt,
        tierExpiresAt: access.tierExpiresAt,
      },
      couponSynced,
      message: `Patient verified for ${access.tier.toUpperCase()} tier access (${TIER_DISCOUNTS[access.tier]}% discount).`,
    });
  } catch (error: any) {
    console.error('[ABXTac] Error processing provider access:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


/**
 * Appointment Routing — single source of truth for provider+location assignment.
 *
 * Per Phil 2026-04-21:
 *   - NOWMensHealth.Care patients OR MensHealth-branded types →
 *       Dr. Whitten (12093125) at NowMensHealth.Care location (27566)
 *     Unless staff explicitly overrides on the iPad (staffOverride=true).
 *
 *   - Pelleting (EvexiPel) appointment types →
 *       Phil Schafer NP (12088269) at NowLongevity.Care location (27565)
 *       (Longevity shares the 404 S. Montezuma office with Primary Care.)
 *
 *   - Everything else → provider-based fallback, location from UI dropdown.
 *
 * USED BY:
 *   - app/api/ipad/schedule/route.ts  (staff override supported)
 *   - app/api/abxtac/book/route.ts    (no override — public surface always enforces)
 *   - scripts/ghl-integration/webhook-server.js (future — same enforcement as website)
 */

import { query } from '@/lib/db';

// Provider IDs (Healthie)
export const PROVIDER_WHITTEN = '12093125';
export const PROVIDER_SCHAFER = '12088269';

// Location IDs (Healthie) — verified live 2026-04-21
export const LOCATION_MENSHEALTH = '27566';  // NowMensHealth.Care — 215 N. McCormick
export const LOCATION_PRIMARY = '27565';      // NowPrimary.Care — 404 S. Montezuma
export const LOCATION_LONGEVITY = '27565';    // Same office as Primary Care

// Healthie user_group IDs
export const GROUP_MENSHEALTH = '75522';

// MensHealth-branded appointment type IDs
// Sourced from public/ipad/app.js BRAND_TYPES.mens_health.ids as of 2026-04-21.
export const MENSHEALTH_TYPE_IDS = new Set([
  '504725',  // Initial Male Hormone Replacement Consult
  '504732',  // 5 Week Lab Draw
  '504734',  // 90 Day Lab Draw
  '504735',  // Annual Lab Draw (NMH)
  '504736',  // NMH General TRT Telemedicine
  '505645',  // NMH Peptide Education & Pickup
  '511049',  // NMH TRT Supply Refill
]);

// Pelleting appointment type IDs (EvexiPel)
export const PELLETING_TYPE_IDS = new Set([
  '504727',  // EvexiPel Initial Pelleting Male
  '504728',  // EvexiPel Repeat Pelleting Male
  '504729',  // EvexiPel Repeat Pelleting Female
  '504730',  // EvexiPel Initial Pelleting Female
  '504731',  // Initial Female Hormone Replacement Therapy Consult
  '504717',  // Hormone consult (Longevity)
  '505647',  // other Longevity variant
]);

export type BookingAssignment = {
  providerId: string;
  locationId: string;
  /** true if the routing rule changed what the caller requested (for telemetry) */
  rerouted: boolean;
  /** Which rule fired, or 'default' */
  rule: 'mens_health_group' | 'mens_health_type' | 'pelleting_type' | 'staff_override' | 'default';
};

export type ResolveArgs = {
  /** Local UUID or Healthie numeric ID of the patient */
  patientHealthieId?: string | null;
  /** What appointment type the caller picked */
  appointmentTypeId: string;
  /** What provider the caller picked (UI dropdown value) */
  requestedProviderId: string;
  /** What location the caller picked (UI dropdown value, passed through separately) */
  requestedLocationId?: string | null;
  /** true = staff opted out of routing via explicit toggle (iPad only) */
  staffOverride?: boolean;
};

/**
 * Resolve the authoritative provider + location for a booking.
 * Server-side enforcement prevents wrong-location bookings even if the client sends bad data.
 */
export async function resolveBookingAssignment(opts: ResolveArgs): Promise<BookingAssignment> {
  const requestedProviderId = opts.requestedProviderId;
  const requestedLocationId = opts.requestedLocationId || null;
  const typeId = String(opts.appointmentTypeId);

  // Staff explicit override — respect what they picked (provider + location as-is)
  if (opts.staffOverride) {
    return {
      providerId: requestedProviderId,
      locationId: requestedLocationId || LOCATION_PRIMARY,
      rerouted: false,
      rule: 'staff_override'
    };
  }

  // Rule 1: MensHealth-branded TYPE always → Whitten at MensHealth
  if (MENSHEALTH_TYPE_IDS.has(typeId)) {
    const rerouted = requestedProviderId !== PROVIDER_WHITTEN || requestedLocationId !== LOCATION_MENSHEALTH;
    return {
      providerId: PROVIDER_WHITTEN,
      locationId: LOCATION_MENSHEALTH,
      rerouted,
      rule: 'mens_health_type'
    };
  }

  // Rule 2: Pelleting TYPE always → Longevity location (provider stays Phil unless caller chose Whitten)
  if (PELLETING_TYPE_IDS.has(typeId)) {
    const rerouted = requestedLocationId !== LOCATION_LONGEVITY;
    return {
      providerId: requestedProviderId || PROVIDER_SCHAFER,
      locationId: LOCATION_LONGEVITY,
      rerouted,
      rule: 'pelleting_type'
    };
  }

  // Rule 3: Patient group = NOWMensHealth.Care → Whitten at MensHealth
  if (opts.patientHealthieId) {
    try {
      const [pt] = await query<{ healthie_group_id: string | null; client_type_key: string | null }>(
        `SELECT healthie_group_id, client_type_key
         FROM patients
         WHERE healthie_client_id = $1 OR patient_id::text = $1
         LIMIT 1`,
        [String(opts.patientHealthieId)]
      );
      const isMensHealth = pt?.healthie_group_id === GROUP_MENSHEALTH
        || (pt?.client_type_key || '').toLowerCase() === 'nowmenshealth';
      if (isMensHealth) {
        return {
          providerId: PROVIDER_WHITTEN,
          locationId: LOCATION_MENSHEALTH,
          rerouted: requestedProviderId !== PROVIDER_WHITTEN,
          rule: 'mens_health_group'
        };
      }
    } catch {
      // DB lookup failed — fail-open to caller's choice
    }
  }

  // Default: pass through
  return {
    providerId: requestedProviderId,
    locationId: requestedLocationId || LOCATION_PRIMARY,
    rerouted: false,
    rule: 'default'
  };
}

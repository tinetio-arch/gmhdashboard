/**
 * Fetch Healthie clinical data for a single patient profile.
 * 
 * Uses the existing HealthieClient from healthie.ts to pull medications,
 * allergies, prescriptions, subscriptions, and payment methods in parallel.
 * All API calls are wrapped with a timeout so a slow Healthie API won't
 * block page rendering.
 */

import { query } from './db';
import { createHealthieClient } from './healthie';
import type {
    HealthieMedication,
    HealthieAllergy,
    HealthiePrescription,
    HealthieSubscription,
    HealthiePaymentMethod,
    HealthieBillingItem,
} from './healthie';

// ─── Types ──────────────────────────────────────────────────────

export type HealthiePatientProfile = {
    healthieClientId: string | null;
    medications: HealthieMedication[];
    allergies: HealthieAllergy[];
    prescriptions: HealthiePrescription[];
    subscriptions: HealthieSubscription[];
    paymentMethods: HealthiePaymentMethod[];
    billingItems: HealthieBillingItem[];
    documents: number; // count
    forms: number;     // count
    error?: string;
};

const EMPTY_PROFILE: HealthiePatientProfile = {
    healthieClientId: null,
    medications: [],
    allergies: [],
    prescriptions: [],
    subscriptions: [],
    paymentMethods: [],
    billingItems: [],
    documents: 0,
    forms: 0,
};

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Race a promise against a timeout (ms). Returns `fallback` on timeout.
 *
 * FIX(2026-05-20): the underlying lib/healthie.ts methods used to swallow errors
 * into [] internally; they now throw (so callers can tell an outage from an empty
 * result). This profile aggregates ~8 independent Healthie sections, so we
 * deliberately degrade a single failed/slow section to its fallback rather than
 * failing the whole patient panel — but we now LOG the failure (label) so a
 * Healthie outage is visible instead of looking like a patient with no data.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label = 'section'): Promise<T> {
    return Promise.race([
        promise.catch((err) => {
            console.error(`[healthiePatientData] ${label} failed, degrading to fallback:`, err?.message || err);
            return fallback;
        }),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

// ─── Main Export ────────────────────────────────────────────────

/**
 * Fetch all Healthie clinical data for a patient.
 *
 * Resolves the healthie_client_id from the DB, then fetches everything
 * in parallel with a 5-second timeout per call. If Healthie is down
 * or the patient has no Healthie link, returns sensible defaults.
 */
export async function fetchHealthiePatientProfile(
    patientId: string
): Promise<HealthiePatientProfile> {
    console.log(`[healthiePatientData] START for patientId=${patientId}`);
    // 1. Resolve Healthie client ID
    const rows = await query<{ healthie_client_id: string }>(
        `SELECT healthie_client_id
       FROM healthie_clients
      WHERE patient_id = $1
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1`,
        [patientId]
    );

    const healthieClientId = rows[0]?.healthie_client_id ?? null;
    console.log(`[healthiePatientData] patientId=${patientId} => healthieClientId=${healthieClientId} (rows=${rows.length})`);
    if (!healthieClientId) {
        console.log(`[healthiePatientData] NO healthie_client_id found, returning empty profile`);
        return { ...EMPTY_PROFILE };
    }

    const client = createHealthieClient();
    if (!client) {
        return { ...EMPTY_PROFILE, healthieClientId, error: 'Healthie client not configured' };
    }

    const TIMEOUT = 5_000;

    // 2. Fetch everything in parallel with timeouts
    try {
        const [
            medications,
            allergies,
            prescriptions,
            subscriptions,
            paymentMethods,
            billingItems,
            documents,
            forms,
        ] = await Promise.all([
            withTimeout(client.getMedications(healthieClientId), TIMEOUT, [] as HealthieMedication[], 'medications'),
            withTimeout(client.getAllergies(healthieClientId), TIMEOUT, [] as HealthieAllergy[], 'allergies'),
            withTimeout(client.getPrescriptions(healthieClientId), TIMEOUT, [] as HealthiePrescription[], 'prescriptions'),
            withTimeout(client.getClientSubscriptions(healthieClientId), TIMEOUT, [] as HealthieSubscription[], 'subscriptions'),
            withTimeout(client.getPaymentMethods(healthieClientId), TIMEOUT, [] as HealthiePaymentMethod[], 'paymentMethods'),
            withTimeout(client.getBillingItems(healthieClientId, 25), TIMEOUT, [] as HealthieBillingItem[], 'billingItems'),
            withTimeout(
                client.getDocuments(healthieClientId).then((d: any[]) => d.length),
                TIMEOUT,
                0,
                'documents'
            ),
            withTimeout(
                client.getFormAnswerGroups(healthieClientId).then((f: any[]) => f.length),
                TIMEOUT,
                0,
                'forms'
            ),
        ]);

        console.log(`[healthiePatientData] clientId=${healthieClientId} => meds=${medications.length}, allergies=${allergies.length}, rx=${prescriptions.length}, subs=${subscriptions.length}, billing=${billingItems.length}, docs=${documents}, forms=${forms}`);

        return {
            healthieClientId,
            medications,
            allergies,
            prescriptions,
            subscriptions,
            paymentMethods,
            billingItems,
            documents,
            forms,
        };
    } catch (err: any) {
        console.error('[healthiePatientData] Error fetching profile:', err.message);
        return { ...EMPTY_PROFILE, healthieClientId, error: err.message };
    }
}

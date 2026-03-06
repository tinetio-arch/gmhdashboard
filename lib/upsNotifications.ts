/**
 * UPS Shipping SMS Notifications via GoHighLevel
 *
 * Sends text messages to patients when:
 * - A shipping label is created (with tracking number + link)
 * - A shipment is voided (cancellation notice)
 *
 * Uses the patient's GHL contact ID + GHLClient.sendSms()
 */

import { query } from './db';
import { getGHLClientForPatient } from './ghl';

type PatientSmsInfo = {
    patient_id: string;
    full_name: string;
    ghl_contact_id: string | null;
    client_type_key: string | null;
    phone_primary: string | null;
};

/**
 * Look up the patient's GHL contact ID + clinic info for SMS routing
 */
async function getPatientSmsInfo(patientId: string): Promise<PatientSmsInfo | null> {
    const rows = await query<PatientSmsInfo>(
        `SELECT patient_id, full_name, ghl_contact_id, client_type_key, phone_primary
     FROM patients
     WHERE patient_id = $1
     LIMIT 1`,
        [patientId]
    );
    return rows[0] ?? null;
}

/**
 * Send an SMS notification to a patient via GHL.
 * Returns { sent: true } on success, or { sent: false, reason: string } if skipped/failed.
 */
async function sendPatientSms(
    patientId: string,
    message: string
): Promise<{ sent: boolean; reason?: string }> {
    const patient = await getPatientSmsInfo(patientId);

    if (!patient) {
        return { sent: false, reason: 'Patient not found' };
    }

    if (!patient.ghl_contact_id) {
        return { sent: false, reason: `No GHL contact ID for ${patient.full_name}` };
    }

    const ghlClient = getGHLClientForPatient(null, patient.client_type_key);
    if (!ghlClient) {
        return { sent: false, reason: 'GHL client not configured' };
    }

    try {
        await ghlClient.sendSms(patient.ghl_contact_id, message);
        console.log(
            `[UPS-SMS] ✅ Sent SMS to ${patient.full_name} (${patient.ghl_contact_id}): ${message.substring(0, 60)}...`
        );
        return { sent: true };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[UPS-SMS] ❌ Failed to send SMS to ${patient.full_name}:`, msg);
        return { sent: false, reason: msg };
    }
}

/**
 * Send tracking notification when a shipment label is created.
 */
export async function notifyShipmentCreated(
    patientId: string,
    trackingNumber: string,
    serviceName: string
): Promise<{ sent: boolean; reason?: string }> {
    const trackingUrl = `https://www.ups.com/track?tracknum=${trackingNumber}`;
    const message =
        `Hi! Your package from NOW Men's Health has shipped via ${serviceName}. ` +
        `Tracking #: ${trackingNumber}\n` +
        `Track it here: ${trackingUrl}`;

    return sendPatientSms(patientId, message);
}

/**
 * Send notification when a shipment is voided/cancelled.
 */
export async function notifyShipmentVoided(
    patientId: string,
    trackingNumber: string
): Promise<{ sent: boolean; reason?: string }> {
    const message =
        `Hi! This is NOW Men's Health. The shipment with tracking # ${trackingNumber} ` +
        `has been cancelled. If you have questions, please contact us. Thank you!`;

    return sendPatientSms(patientId, message);
}

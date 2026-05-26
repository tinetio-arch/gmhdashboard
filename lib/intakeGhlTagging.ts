/**
 * lib/intakeGhlTagging.ts
 *
 * After a patient finishes the LAST of a brand's intake forms, find their GHL
 * contact and add an "Intake Complete" tag. The GHL workflow's reminder logic
 * uses this to skip nudges once intake is fully done.
 *
 * Design notes:
 *  - Tag only fires when ALL active forms for the brand have submissions by
 *    this patient (status in provisioned / healthie_unmapped / local_only).
 *    A per-form tag would over-nudge and create state-explosion in workflows.
 *  - Best-effort: this never blocks or fails the patient submission. Any GHL
 *    error is logged and swallowed.
 *  - Idempotent: `GHLClient.addTag()` checks existing tags before writing.
 */
import { query } from '@/lib/db';
import { createGHLClientForABXTAC, type GHLClient } from '@/lib/ghl';

export const INTAKE_COMPLETE_TAG = 'Intake Complete';

/** Statuses that mean "this form was successfully captured" (any of these count toward completion). */
const COMPLETE_STATUSES = ['provisioned', 'healthie_unmapped', 'local_only'] as const;

/** Brand → GHL client factory. Add new brands as their GHL locations come online. */
function getGHLClientForBrand(brandKey: string): GHLClient | null {
    switch (brandKey) {
        case 'abxtac':
            return createGHLClientForABXTAC();
        // Future: nowmenshealth, nowprimarycare, nowlongevity → their own factories
        default:
            return null;
    }
}

/**
 * Return true when this patient has at least one successfully-captured submission
 * for EVERY active form_definition belonging to the brand.
 */
async function isBrandIntakeFullyComplete(brandKey: string, patientId: string): Promise<boolean> {
    const rows = await query<{ active_count: string; completed_count: string }>(
        `WITH active_forms AS (
             SELECT form_def_id
               FROM form_definitions
              WHERE brand_key = $1 AND is_active = true
         ),
         completed_for_patient AS (
             SELECT DISTINCT s.form_def_id
               FROM intake_submissions s
               JOIN active_forms a USING (form_def_id)
              WHERE s.patient_id = $2
                AND s.status = ANY($3::text[])
         )
         SELECT (SELECT count(*) FROM active_forms)::text          AS active_count,
                (SELECT count(*) FROM completed_for_patient)::text AS completed_count`,
        [brandKey, patientId, COMPLETE_STATUSES as unknown as string[]]
    );
    const r = rows[0];
    if (!r) return false;
    const active = Number(r.active_count);
    const completed = Number(r.completed_count);
    return active > 0 && completed >= active;
}

/**
 * Call this AFTER a successful intake submission. If the patient has just
 * completed the last of their brand's forms, tag them in GHL. Best-effort —
 * any error is logged and swallowed.
 *
 * Patient identity:
 *  - patientId is the join key against intake_submissions for the
 *    completion check.
 *  - applicantEmail/applicantPhone are used to look up the GHL contact
 *    (the patient may have come in via a GHL workflow that created the contact).
 */
export async function markIntakeCompleteIfDone(args: {
    brandKey: string;
    patientId: string;
    applicantEmail?: string | null;
    applicantPhone?: string | null;
}): Promise<{ tagged: boolean; reason: string }> {
    const { brandKey, patientId, applicantEmail, applicantPhone } = args;

    try {
        const done = await isBrandIntakeFullyComplete(brandKey, patientId);
        if (!done) return { tagged: false, reason: 'not_all_forms_complete' };

        const ghl = getGHLClientForBrand(brandKey);
        if (!ghl) return { tagged: false, reason: `no_ghl_client_for_brand:${brandKey}` };

        // Look up the GHL contact. Email first (more stable), phone fallback.
        let contact = null as Awaited<ReturnType<typeof ghl.findContactByEmail>>;
        if (applicantEmail) {
            contact = await ghl.findContactByEmail(applicantEmail);
        }
        if (!contact && applicantPhone) {
            contact = await ghl.findContactByPhone(applicantPhone);
        }
        if (!contact?.id) return { tagged: false, reason: 'ghl_contact_not_found' };

        await ghl.addTag(contact.id, INTAKE_COMPLETE_TAG);
        console.log(`[Intake] Tagged GHL contact ${contact.id} (${brandKey}) with "${INTAKE_COMPLETE_TAG}"`);
        return { tagged: true, reason: 'ok' };
    } catch (e) {
        console.error('[Intake] markIntakeCompleteIfDone failed (non-fatal):', e instanceof Error ? e.message : String(e));
        return { tagged: false, reason: 'error' };
    }
}

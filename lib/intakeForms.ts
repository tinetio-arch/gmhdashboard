/**
 * lib/intakeForms.ts
 *
 * Self-serve patient intake decoupled from Healthie's native intake portal.
 * Data-driven form definitions (see migrations/20260520_intake_forms.sql) are
 * captured in OUR Postgres, then provisioned: patient created locally + in
 * Healthie (which still triggers Healthie's onboarding flow), and — when the
 * brand's Healthie form is mapped — answers pushed via createFormAnswerGroup.
 *
 * Reusable per brand. ABXTAC is the worked example; see
 * docs/INTAKE_MIGRATION_PLAYBOOK.md for the rollout to the other brands.
 */
import { query } from '@/lib/db';
import {
    createPatientInHealthie,
    type ClinicType,
    type ClientTypeKey,
} from '@/lib/patientHealthieSync';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

export interface FormFieldDef {
    field_id: string;
    ordinal: number;
    field_key: string;
    label: string;
    mod_type: string;
    required: boolean;
    options: string[] | null;
    description: string | null;
    healthie_custom_module_id: string | null;
}

export interface FormDefinition {
    form_def_id: string;
    brand_key: string;
    slug: string;
    name: string;
    description: string | null;
    client_type_key: string;
    healthie_custom_module_form_id: string | null;
    version: number;
    fields: FormFieldDef[];
}

export interface IntakeSubmissionInput {
    answers: Record<string, string>;
    applicantName: string;
    applicantEmail?: string | null;
    applicantPhone?: string | null;
    dateOfBirth?: string | null;
    address?: string | null;
    signatureDataUrl?: string | null;
    source?: 'web' | 'ios' | 'ipad';
    ip?: string | null;
    userAgent?: string | null;
    // When true (or env INTAKE_DRY_RUN=1), validate + capture the submission but
    // create NO patient and call NO Healthie API — for end-to-end testing with
    // zero side effects and zero customer communication.
    dryRun?: boolean;
}

export interface ProvisionResult {
    submissionId: string;
    status: 'provisioned' | 'healthie_unmapped' | 'dry_run' | 'local_only' | 'error';
    patientId: string | null;
    healthieClientId: string | null;
    healthieFormAnswerGroupId: string | null;
    error?: string;
}

/**
 * Load the active form definition for a brand + slug (most recent active version).
 * Returns null if no active form exists.
 */
export async function getActiveFormDefinition(
    brandKey: string,
    slug: string
): Promise<FormDefinition | null> {
    const defs = await query<Omit<FormDefinition, 'fields'>>(
        `SELECT form_def_id, brand_key, slug, name, description, client_type_key,
                healthie_custom_module_form_id, version
           FROM form_definitions
          WHERE brand_key = $1 AND slug = $2 AND is_active = true
          ORDER BY version DESC
          LIMIT 1`,
        [brandKey, slug]
    );
    const def = defs[0];
    if (!def) return null;

    const fields = await query<FormFieldDef>(
        `SELECT field_id, ordinal, field_key, label, mod_type, required, options, description,
                healthie_custom_module_id
           FROM form_fields
          WHERE form_def_id = $1
          ORDER BY ordinal ASC`,
        [def.form_def_id]
    );

    return { ...def, fields };
}

/**
 * Validate submitted answers against a form definition.
 * Returns an array of human-readable errors (empty = valid).
 */
export function validateSubmission(
    def: FormDefinition,
    answers: Record<string, string>
): string[] {
    const errors: string[] = [];
    for (const field of def.fields) {
        const raw = answers[field.field_key];
        const provided = raw !== undefined && raw !== null && String(raw).trim() !== '';

        if (field.required && !provided) {
            // checkboxes are required-consent: must be truthy
            errors.push(`"${field.label}" is required.`);
            continue;
        }
        if (!provided) continue;

        if (field.mod_type === 'checkbox') {
            const v = String(raw).toLowerCase();
            if (field.required && !['true', '1', 'yes', 'on', 'checked'].includes(v)) {
                errors.push(`"${field.label}" must be acknowledged.`);
            }
        }
        if ((field.mod_type === 'radio') && Array.isArray(field.options) && field.options.length) {
            if (!field.options.includes(String(raw))) {
                errors.push(`"${field.label}" must be one of the provided options.`);
            }
        }
    }
    return errors;
}

/**
 * Push completed answers to Healthie via createFormAnswerGroup.
 * Only fields with a mapped healthie_custom_module_id are sent.
 * Returns the Healthie form_answer_group id, or null on failure / no mapping.
 */
async function pushAnswersToHealthie(
    def: FormDefinition,
    healthieClientId: string,
    answers: Record<string, string>
): Promise<string | null> {
    if (!def.healthie_custom_module_form_id || !HEALTHIE_API_KEY) return null;

    const formAnswers = def.fields
        .filter((f) => f.healthie_custom_module_id && answers[f.field_key] !== undefined)
        .map((f) => ({
            custom_module_id: f.healthie_custom_module_id as string,
            answer: String(answers[f.field_key]),
            user_id: healthieClientId,
        }));

    if (formAnswers.length === 0) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${HEALTHIE_API_KEY}`,
                AuthorizationSource: 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    mutation CreateFormAnswerGroup($formId: String!, $userId: String!, $formAnswers: [FormAnswerInput!]!, $finished: Boolean) {
                        createFormAnswerGroup(input: { custom_module_form_id: $formId, user_id: $userId, form_answers: $formAnswers, finished: $finished }) {
                            form_answer_group { id }
                            messages { field message }
                        }
                    }`,
                variables: {
                    formId: def.healthie_custom_module_form_id,
                    userId: healthieClientId,
                    formAnswers,
                    finished: true,
                },
            }),
            signal: controller.signal,
            cache: 'no-store',
        } as any);

        if (!res.ok) {
            console.error('[Intake] Healthie answer push HTTP', res.status);
            return null;
        }
        const json = await res.json();
        if (json.errors) {
            console.error('[Intake] Healthie answer push errors:', json.errors.map((e: any) => e.message).join(', '));
            return null;
        }
        return json.data?.createFormAnswerGroup?.form_answer_group?.id || null;
    } catch (e) {
        console.error('[Intake] Healthie answer push failed:', e instanceof Error ? e.message : String(e));
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Capture a self-serve intake submission and provision it.
 *
 * Flow ("our forms feed Healthie"):
 *   1. INSERT intake_submissions (status='provisioning') — local capture of record.
 *   2. Find-or-create the patient in OUR Postgres (dedup by email).
 *   3. Create the patient in Healthie (createPatientInHealthie dedups + triggers
 *      Healthie's onboarding flow), link via healthie_clients.
 *   4. Push answers to Healthie if the form is mapped (else status='healthie_unmapped').
 *
 * Healthie is best-effort: a submission is never lost if Healthie is down.
 */
export async function submitIntake(
    def: FormDefinition,
    input: IntakeSubmissionInput
): Promise<ProvisionResult> {
    // 1. Capture locally first — never lose a patient's submission.
    const inserted = await query<{ submission_id: string }>(
        `INSERT INTO intake_submissions
            (form_def_id, brand_key, applicant_name, applicant_email, applicant_phone,
             date_of_birth, address, answers, signature_data_url, status, source, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'provisioning',$10,$11,$12)
         RETURNING submission_id`,
        [
            def.form_def_id,
            def.brand_key,
            input.applicantName,
            input.applicantEmail || null,
            input.applicantPhone || null,
            input.dateOfBirth || null,
            input.address || null,
            JSON.stringify(input.answers),
            input.signatureDataUrl || null,
            input.source || 'web',
            input.ip || null,
            input.userAgent || null,
        ]
    );
    const submissionId = inserted[0].submission_id;

    // Dry-run: validated + captured, but NO patient and NO Healthie call. Used to
    // test the full pipeline end-to-end with zero side effects / zero comms.
    const dryRun = input.dryRun || process.env.INTAKE_DRY_RUN === '1';
    if (dryRun) {
        await query(
            `UPDATE intake_submissions SET status = 'dry_run', provisioned_at = NOW() WHERE submission_id = $1`,
            [submissionId]
        );
        return {
            submissionId,
            status: 'dry_run',
            patientId: null,
            healthieClientId: null,
            healthieFormAnswerGroupId: null,
        };
    }

    try {
        // 2. Find-or-create patient in our DB (dedup by email).
        let patientId: string | null = null;
        if (input.applicantEmail) {
            const existing = await query<{ patient_id: string }>(
                `SELECT patient_id FROM patients WHERE lower(email) = lower($1) LIMIT 1`,
                [input.applicantEmail]
            );
            patientId = existing[0]?.patient_id || null;
        }
        if (!patientId) {
            const created = await query<{ patient_id: string }>(
                `INSERT INTO patients (full_name, email, dob, phone_primary, client_type_key, status, status_key, date_added)
                 VALUES ($1, $2, $3, $4, $5, 'Active', 'active', NOW())
                 RETURNING patient_id`,
                [
                    input.applicantName,
                    input.applicantEmail || null,
                    input.dateOfBirth || null,
                    input.applicantPhone || null,
                    def.client_type_key,
                ]
            );
            patientId = created[0].patient_id;
        }

        // 3. Create in Healthie (clientTypeKey drives the group; clinic is a
        //    required-type placeholder only — getHealthieConfig prefers clientTypeKey).
        //    Suppress Healthie's welcome/set-password email by default: OUR forms
        //    own all patient communication (the decoupling goal). Re-enable per
        //    deployment with INTAKE_HEALTHIE_SEND_WELCOME=1 if ever desired.
        //
        //    Kill-switch: when INTAKE_PUSH_TO_HEALTHIE=false, skip the Healthie
        //    create AND the answer-push entirely. The patient is local-only —
        //    our DB becomes the system of record. This is the dial we turn down
        //    as we migrate off Healthie brand-by-brand (start with ABXTAC).
        const pushToHealthie = process.env.INTAKE_PUSH_TO_HEALTHIE !== 'false';
        if (!pushToHealthie) {
            await query(
                `UPDATE intake_submissions
                    SET patient_id = $1, status = 'local_only', provisioned_at = NOW()
                  WHERE submission_id = $2`,
                [patientId, submissionId]
            );
            return {
                submissionId,
                status: 'local_only',
                patientId,
                healthieClientId: null,
                healthieFormAnswerGroupId: null,
            };
        }

        const sendHealthieWelcome = process.env.INTAKE_HEALTHIE_SEND_WELCOME === '1';
        const healthieResult = await createPatientInHealthie({
            patientName: input.applicantName,
            email: input.applicantEmail,
            phoneNumber: input.applicantPhone,
            dateOfBirth: input.dateOfBirth,
            address: input.address,
            clinic: 'nowprimary.care' as ClinicType,
            clientTypeKey: def.client_type_key as ClientTypeKey,
            suppressWelcome: !sendHealthieWelcome,
        });

        let healthieClientId: string | null = null;
        if (healthieResult.success && healthieResult.healthieClientId) {
            healthieClientId = healthieResult.healthieClientId;
            await query(
                `UPDATE patients SET healthie_client_id = $1 WHERE patient_id = $2 AND healthie_client_id IS NULL`,
                [healthieClientId, patientId]
            );
            await query(
                `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                 VALUES ($1, $2, true, 'self_serve_intake')
                 ON CONFLICT (healthie_client_id) DO NOTHING`,
                [patientId, healthieClientId]
            );
        } else {
            console.error('[Intake] Healthie patient create failed:', healthieResult.error);
        }

        // 4. Push answers to Healthie if mapped.
        let answerGroupId: string | null = null;
        if (healthieClientId) {
            answerGroupId = await pushAnswersToHealthie(def, healthieClientId, input.answers);
        }

        const status: ProvisionResult['status'] =
            healthieClientId && (answerGroupId || !def.healthie_custom_module_form_id)
                ? (def.healthie_custom_module_form_id && answerGroupId ? 'provisioned' : 'healthie_unmapped')
                : healthieClientId
                ? 'healthie_unmapped'
                : 'error';

        await query(
            `UPDATE intake_submissions
                SET patient_id = $1, healthie_client_id = $2, healthie_form_answer_group_id = $3,
                    status = $4, provisioned_at = NOW()
              WHERE submission_id = $5`,
            [patientId, healthieClientId, answerGroupId, status, submissionId]
        );

        return {
            submissionId,
            status,
            patientId,
            healthieClientId,
            healthieFormAnswerGroupId: answerGroupId,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Intake] Provisioning error:', msg);
        await query(
            `UPDATE intake_submissions SET status = 'error', error = $1 WHERE submission_id = $2`,
            [msg, submissionId]
        );
        return {
            submissionId,
            status: 'error',
            patientId: null,
            healthieClientId: null,
            healthieFormAnswerGroupId: null,
            error: 'Submission saved but provisioning failed',
        };
    }
}

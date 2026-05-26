/**
 * scripts/wire-abxtac-intake.ts
 *
 * One-shot, idempotent wiring of the ABXTAC patient-intake set, end-to-end
 * under Phil's "self-serve primary, Healthie silent" decision (2026-05-26):
 *
 *   1. Ensures all 8 ABXTAC forms EXIST as customModuleForm templates in
 *      Healthie. The 7 generic ones already exist; only "ABX Tactical
 *      Services Agreement" is created here (if absent).
 *   2. Reads each form's custom_modules (question ids) from Healthie.
 *   3. UPSERTs `form_definitions` + `form_fields` in our Postgres with
 *      healthie_custom_module_form_id + per-field healthie_custom_module_id
 *      set, so the self-serve API can post answers straight to the chart.
 *   4. Best-effort creates an ABXTAC onboarding flow holding all 8 forms,
 *      NOT attached to any user_group — so Healthie holds them organized
 *      for manual fallback but emails nobody. If the flow-create mutation
 *      isn't supported, this step is skipped + logged.
 *
 * Re-runnable. Run from gmhdashboard:
 *   npx tsx --env-file=.env.local scripts/wire-abxtac-intake.ts
 *
 * This file is the template for the next brand (Now Men's Health, Primary
 * Care, Longevity) — copy + change the BRAND_CONFIG block.
 */
import { query, getPool } from '../lib/db';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

// ─── BRAND CONFIG ─────────────────────────────────────────────────────────
// Edit this block to wire another brand. The shape is identical.
const BRAND_CONFIG = {
    brandKey: 'abxtac',
    clientTypeKey: 'abxtac',
    onboardingFlowName: 'ABXTAC Intake',
    forms: [
        { slug: 'hipaa-agreement',     name: 'HIPAA Agreement',                       healthieId: '2898628', createIfMissing: null },
        { slug: 'consent-to-treat',    name: 'Consent to Treat',                      healthieId: '2898608', createIfMissing: null },
        { slug: 'telehealth-consent',  name: 'Telehealth Informed Consent',           healthieId: '2898624', createIfMissing: null },
        { slug: 'ai-scribe-consent',   name: 'Patient Informed Consent for AI Scribe',healthieId: '2898621', createIfMissing: null },
        { slug: 'financial-agreement', name: 'Financial Agreement',                   healthieId: '2898609', createIfMissing: null },
        { slug: 'patient-intake',      name: 'NOWOPTIMAL Patient Intake Form',        healthieId: '2898622', createIfMissing: null },
        { slug: 'peptide-consent',     name: 'Peptide Therapy Informed Consent',      healthieId: '2960753', createIfMissing: null },
        {
            slug: 'services-agreement',
            name: 'ABX Tactical Services Agreement',
            healthieId: null as string | null,  // will be created
            createIfMissing: {
                description: 'Tactical medicine consultation and antibiotic pack authorization',
                questions: [
                    { label: 'Occupation',                    mod_type: 'text',     required: true  },
                    { label: 'Professional Background',       mod_type: 'radio',    required: true,  options: ['First Responder','Military (Active)','Military (Reserve)','Law Enforcement','Other'] },
                    { label: 'Training and Certifications',   mod_type: 'textarea', required: false, description: 'List relevant medical/tactical training and certifications' },
                    { label: 'Deployment Status',             mod_type: 'radio',    required: true,  options: ['Active Deployment','Reserve/Training','Civilian'] },
                    { label: 'Antibiotic Pack Authorization', mod_type: 'checkbox', required: true,  description: 'I authorize prescription of tactical antibiotic pack for emergency use' },
                    { label: 'Self-Administration Training',  mod_type: 'checkbox', required: true,  description: 'I have completed or will complete self-administration training' },
                    { label: 'Emergency Use Understanding',   mod_type: 'checkbox', required: true,  description: 'I understand these medications are for emergency use only and require provider notification' },
                    { label: 'Liability Waiver',              mod_type: 'checkbox', required: true,  description: 'I understand and assume responsibility for proper use of tactical medications' },
                    { label: 'Participant Signature',         mod_type: 'signature',required: true  },
                ] as Array<{ label: string; mod_type: string; required: boolean; description?: string; options?: string[] }>,
            },
        },
    ],
};
// ──────────────────────────────────────────────────────────────────────────

async function gql<T = any>(queryText: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${HEALTHIE_API_KEY}`,
            AuthorizationSource: 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: queryText, variables }),
        cache: 'no-store',
    } as any);
    const json: any = await res.json();
    if (json.errors) throw new Error(`Healthie GQL: ${json.errors.map((e: any) => e.message).join('; ')}`);
    return json.data as T;
}

/** Stable machine key derived from a label. Lowercase, underscore-delimited. */
function slugifyKey(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'field';
}

/** Find an existing form by exact name (case-insensitive). */
async function findFormIdByName(name: string): Promise<string | null> {
    const data = await gql<{ customModuleForms: Array<{ id: string; name: string }> }>(
        `query { customModuleForms(offset: 0) { id name } }`
    );
    const hit = (data.customModuleForms || []).find((f) => f.name?.toLowerCase() === name.toLowerCase());
    return hit?.id || null;
}

/** Read a form's custom_modules in order. */
async function readModules(formId: string): Promise<Array<{ id: string; label: string; mod_type: string; required: boolean; options: string | null; description: string | null }>> {
    const data = await gql<{ customModuleForm: { id: string; name: string; custom_modules: Array<{ id: string; label: string; mod_type: string; required: boolean; options: string | null; sublabel: string | null }> } }>(
        `query($id: ID!) { customModuleForm(id: $id) { id name custom_modules { id label mod_type required options sublabel } } }`,
        { id: formId }
    );
    return (data.customModuleForm?.custom_modules || []).map((m) => ({
        id: m.id, label: m.label, mod_type: m.mod_type, required: !!m.required,
        options: m.options || null, description: m.sublabel || null,
    }));
}

/** Create a customModuleForm with questions in Healthie. Idempotent: skips questions
 * whose labels already exist on the form. */
async function ensureFormCreated(name: string, def: NonNullable<typeof BRAND_CONFIG.forms[0]['createIfMissing']>): Promise<string> {
    let formId = await findFormIdByName(name);
    if (!formId) {
        console.log(`  · creating Healthie form "${name}"`);
        const escName = name.replace(/"/g, '\\"');
        // Healthie input field is `name` (was `form_name` in the legacy
        // scripts/create-healthie-forms.ts — that script is stale).
        const m = `mutation { createCustomModuleForm(input: { name: "${escName}", use_for_charting: false, use_for_program: false }) { customModuleForm { id name } messages { field message } } }`;
        const data = await gql<{ createCustomModuleForm: { customModuleForm: { id: string } | null; messages: Array<{ field: string; message: string }> } }>(m);
        const msgs = data.createCustomModuleForm.messages || [];
        if (!data.createCustomModuleForm.customModuleForm) {
            throw new Error(`createCustomModuleForm failed: ${msgs.map((x) => `${x.field}:${x.message}`).join(', ')}`);
        }
        formId = data.createCustomModuleForm.customModuleForm.id;
        console.log(`    ✅ form id ${formId}`);
    } else {
        console.log(`  · form "${name}" already exists (id ${formId})`);
    }

    // Add missing questions only.
    const existing = await readModules(formId);
    const existingLabels = new Set(existing.map((m) => m.label.toLowerCase()));
    for (const q of def.questions) {
        if (existingLabels.has(q.label.toLowerCase())) continue;
        const opts = q.options ? `, options: ${JSON.stringify(q.options.join(','))}` : '';
        // Healthie's createCustomModule input uses `sublabel`, not `description`
        // (the read shape is the same — `sublabel` on custom_modules).
        const desc = q.description ? `, sublabel: "${q.description.replace(/"/g, '\\"')}"` : '';
        const mut = `mutation { createCustomModule(input: { custom_module_form_id: "${formId}", label: "${q.label.replace(/"/g, '\\"')}", mod_type: "${q.mod_type}", required: ${q.required}${desc}${opts} }) { customModule { id label } messages { field message } } }`;
        const r = await gql<{ createCustomModule: { customModule: { id: string } | null; messages: Array<{ field: string; message: string }> } }>(mut);
        if (!r.createCustomModule.customModule) {
            const msgs = (r.createCustomModule.messages || []).map((x) => `${x.field}:${x.message}`).join(', ');
            console.log(`    ⚠️ question "${q.label}" not added: ${msgs}`);
        } else {
            console.log(`    + ${q.label} (mod ${r.createCustomModule.customModule.id})`);
        }
    }
    return formId;
}

/** UPSERT one brand form into our Postgres with full Healthie mapping. */
async function upsertFormDefinition(brandKey: string, clientTypeKey: string, slug: string, name: string, description: string | null, healthieFormId: string, modules: Awaited<ReturnType<typeof readModules>>) {
    const defRow = await query<{ form_def_id: string }>(
        `INSERT INTO form_definitions (brand_key, slug, name, description, client_type_key, healthie_custom_module_form_id, version, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 1, true)
         ON CONFLICT (brand_key, slug, version)
         DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, healthie_custom_module_form_id = EXCLUDED.healthie_custom_module_form_id
         RETURNING form_def_id`,
        [brandKey, slug, name, description, clientTypeKey, healthieFormId]
    );
    const formDefId = defRow[0].form_def_id;

    // form_fields are nothing but a mirror of Healthie's custom_modules — wipe + rewrite
    // so the local state matches Healthie exactly on every run (and survives any
    // label/slug churn). intake_submissions store answers as JSONB by field_key, not
    // by FK, so dropping field rows is safe.
    await query(`DELETE FROM form_fields WHERE form_def_id = $1`, [formDefId]);

    const seen = new Map<string, number>();
    let ordinal = 0;
    for (const m of modules) {
        ordinal += 1;
        const base = slugifyKey(m.label);
        const count = seen.get(base) || 0;
        const fieldKey = count === 0 ? base : `${base}_${count + 1}`;
        seen.set(base, count + 1);
        const optionsJson = m.options ? JSON.stringify(m.options.split(',').map((s) => s.trim()).filter(Boolean)) : null;
        await query(
            `INSERT INTO form_fields (form_def_id, ordinal, field_key, label, mod_type, required, options, description, healthie_custom_module_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
            [formDefId, ordinal, fieldKey, m.label, m.mod_type, m.required, optionsJson, m.description, m.id]
        );
    }
    return { formDefId, fieldCount: modules.length };
}

/** Best-effort: create an onboarding flow holding the 8 forms, NOT attached to any group. */
async function tryBuildOnboardingFlow(flowName: string, formIds: string[]): Promise<void> {
    // Check for an existing flow by that name first.
    const list = await gql<{ onboardingFlows: Array<{ id: string; name: string; user_groups: Array<{ id: string; name: string }>; onboarding_items: Array<{ id: string; item_id: string }> }> }>(
        `query { onboardingFlows { id name user_groups { id } onboarding_items { id item_id } } }`
    );
    let flow = list.onboardingFlows.find((f) => f.name?.toLowerCase() === flowName.toLowerCase());
    if (!flow) {
        // Attempt to create. We don't know for sure the API supports this — try, catch.
        try {
            const data = await gql<{ createOnboardingFlow: { onboardingFlow: { id: string } | null; messages: Array<{ field: string; message: string }> } }>(
                `mutation { createOnboardingFlow(input: { name: "${flowName.replace(/"/g, '\\"')}" }) { onboardingFlow { id } messages { field message } } }`
            );
            if (!data.createOnboardingFlow.onboardingFlow) {
                const msgs = (data.createOnboardingFlow.messages || []).map((x) => `${x.field}:${x.message}`).join(', ');
                console.log(`  ⚠️ flow create returned no flow: ${msgs} — skipping flow build (likely UI-only).`);
                return;
            }
            flow = { id: data.createOnboardingFlow.onboardingFlow.id, name: flowName, user_groups: [], onboarding_items: [] };
            console.log(`  ✅ created onboarding flow "${flowName}" (id ${flow.id})`);
        } catch (e: any) {
            console.log(`  ⚠️ createOnboardingFlow not supported by API (${e.message}). Skipping flow build; forms are organized in our DB.`);
            return;
        }
    } else {
        console.log(`  · onboarding flow "${flowName}" already exists (id ${flow.id})`);
        if ((flow.user_groups || []).length > 0) {
            console.log(`    ⚠️ flow is ATTACHED to ${flow.user_groups.length} group(s) — this would auto-email patients. Phil's choice is "Healthie silent" — leave attached only if intentional.`);
        }
    }

    const have = new Set((flow.onboarding_items || []).map((i) => i.item_id));
    for (const fid of formIds) {
        if (have.has(fid)) continue;
        try {
            await gql(
                `mutation($input: createOnboardingItemInput!) { createOnboardingItem(input: $input) { onboardingItem { id } } }`,
                { input: { onboarding_flow_id: flow.id, item_type: 'custom_module_form', item_id: fid, is_skippable: false } }
            );
            console.log(`    + flow item: form ${fid}`);
        } catch (e: any) {
            console.log(`    ⚠️ could not add form ${fid} to flow: ${e.message}`);
        }
    }
}

async function main() {
    if (!HEALTHIE_API_KEY) { console.error('NO HEALTHIE_API_KEY'); process.exit(1); }
    console.log(`\n=== Wiring intake for brand "${BRAND_CONFIG.brandKey}" (self-serve primary, Healthie silent) ===`);

    const wiredFormIds: string[] = [];
    const summary: Array<{ slug: string; healthieFormId: string; fields: number }> = [];

    for (const f of BRAND_CONFIG.forms) {
        console.log(`\n• ${f.name} [slug=${f.slug}]`);
        let healthieId = f.healthieId;
        if (!healthieId) {
            if (!f.createIfMissing) throw new Error(`Form "${f.name}" has no healthieId and no createIfMissing definition.`);
            healthieId = await ensureFormCreated(f.name, f.createIfMissing);
        } else {
            console.log(`  · using existing Healthie form id ${healthieId}`);
        }
        const modules = await readModules(healthieId);
        console.log(`  · ${modules.length} question(s) on Healthie`);
        const description = f.createIfMissing?.description || null;
        const res = await upsertFormDefinition(BRAND_CONFIG.brandKey, BRAND_CONFIG.clientTypeKey, f.slug, f.name, description, healthieId, modules);
        console.log(`  ✅ upserted form_definitions ${res.formDefId} + ${res.fieldCount} form_fields`);
        wiredFormIds.push(healthieId);
        summary.push({ slug: f.slug, healthieFormId: healthieId, fields: res.fieldCount });
    }

    console.log(`\n=== Onboarding flow (organize-only; not attached to any group) ===`);
    await tryBuildOnboardingFlow(BRAND_CONFIG.onboardingFlowName, wiredFormIds);

    console.log(`\n=== Summary ===`);
    for (const s of summary) console.log(`  ${s.slug.padEnd(22)} ${s.healthieFormId.padEnd(10)} ${s.fields} fields`);

    await getPool().end();
    console.log('\n✅ Done.\n');
}

main().catch((e) => { console.error('WIRING FAILED:', e); process.exit(1); });

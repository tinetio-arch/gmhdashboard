#!/usr/bin/env node
/**
 * Bind Tri-Mix (527506) and Acupuncture (527507) appointment types to
 * Dr. Aaron Whitten (provider_id 12093125) in Healthie.
 *
 * Why this is separate from creation:
 *   createAppointmentType does accept provider_ids_for_appt_type_connections,
 *   but if a future Healthie schema change drops the field default we want
 *   the binding step to be retriable independently. This script is idempotent
 *   — it queries current state first and only writes if the binding is wrong.
 *
 * Pattern matches existing Men's Health types (e.g., 504725 Initial Male HRT
 * Consult, 520702 Male HRT Follow-Up):
 *   - require_specific_providers: true
 *   - provider_ids_for_appt_type_connections: "12093125"
 *
 * WARNING from Healthie schema docs on provider_ids_for_appt_type_connections:
 *   "Defaults to removing all connections if left out"
 *   → never call updateAppointmentType without passing this field, or it
 *     wipes existing connections.
 *
 * Usage:
 *   node scripts/healthie/bind-trimix-acupuncture-to-whitten.js [--dry-run]
 */

const fs = require('fs');

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const DRY_RUN = process.argv.includes('--dry-run');

const DR_WHITTEN_ID = '12093125';
const TARGETS = [
    { id: '527506', name: 'Tri-Mix Injection Consult' },
    { id: '527507', name: 'Acupuncture' },
];

function loadApiKey() {
    if (process.env.HEALTHIE_API_KEY) return process.env.HEALTHIE_API_KEY;
    const envPath = '/home/ec2-user/.env.production';
    if (!fs.existsSync(envPath)) return null;
    const line = fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('HEALTHIE_API_KEY='));
    if (!line) return null;
    return line.split('=', 2)[1].replace(/^["']|["']$/g, '').trim();
}

async function gql(apiKey, query, variables) {
    const res = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${apiKey}`,
            AuthorizationSource: 'API',
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
    return json.data;
}

async function fetchCurrentState(apiKey, ids) {
    const data = await gql(
        apiKey,
        `query {
            appointmentTypes {
                id
                name
                require_specific_providers
                provider_appt_type_connections { user_id provider_name }
            }
        }`,
        {}
    );
    const wanted = new Set(ids.map(String));
    return (data.appointmentTypes || []).filter((t) => wanted.has(String(t.id)));
}

function alreadyBound(state) {
    if (!state.require_specific_providers) return false;
    const ids = (state.provider_appt_type_connections || []).map((c) => String(c.user_id));
    return ids.length === 1 && ids[0] === DR_WHITTEN_ID;
}

async function updateBinding(apiKey, apptTypeId) {
    const mutation = `
        mutation UpdateAppointmentType($input: updateAppointmentTypeInput!) {
            updateAppointmentType(input: $input) {
                appointmentType {
                    id
                    name
                    require_specific_providers
                    provider_appt_type_connections { user_id provider_name }
                }
                messages { field message }
            }
        }
    `;
    const input = {
        id: apptTypeId,
        require_specific_providers: true,
        provider_ids_for_appt_type_connections: DR_WHITTEN_ID,
    };
    const data = await gql(apiKey, mutation, { input });
    const result = data.updateAppointmentType;
    if (result.messages && result.messages.length > 0) {
        throw new Error(
            `Validation: ${result.messages
                .map((m) => `${m.field}: ${m.message}`)
                .join(', ')}`
        );
    }
    return result.appointmentType;
}

async function main() {
    const apiKey = loadApiKey();
    if (!apiKey) {
        console.error('HEALTHIE_API_KEY not set (env or .env.production)');
        process.exit(1);
    }

    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(`Provider: Dr. Aaron Whitten (${DR_WHITTEN_ID})`);
    console.log(`Targets:  ${TARGETS.map((t) => `${t.id} ${t.name}`).join(', ')}\n`);

    const ids = TARGETS.map((t) => t.id);
    const states = await fetchCurrentState(apiKey, ids);

    if (states.length !== TARGETS.length) {
        const found = new Set(states.map((s) => String(s.id)));
        const missing = ids.filter((id) => !found.has(id));
        console.error(`Missing appointment types in Healthie: ${missing.join(', ')}`);
        process.exit(1);
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const state of states) {
        const tag = `${state.id} ${state.name}`;
        if (alreadyBound(state)) {
            console.log(`SKIP  ${tag} — already bound to Dr. Whitten only`);
            skipped++;
            continue;
        }
        if (DRY_RUN) {
            console.log(`PLAN  ${tag} — would set require_specific_providers=true, providers=[${DR_WHITTEN_ID}]`);
            continue;
        }
        try {
            const after = await updateBinding(apiKey, state.id);
            const connected = (after.provider_appt_type_connections || [])
                .map((c) => `${c.user_id} ${c.provider_name}`)
                .join('; ');
            console.log(`✅    ${tag} — require_specific=${after.require_specific_providers}, providers=[${connected}]`);
            updated++;
            await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
            console.error(`❌    ${tag} — ${err.message}`);
            failed++;
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (already correct): ${skipped}`);
    console.log(`Failed:  ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});

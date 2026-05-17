#!/usr/bin/env node
/**
 * Create Tri-Mix and Acupuncture appointment types in Healthie.
 *
 * Both are STAFF-ONLY (clients_can_book=false). Dr. Whitten (12093125)
 * is the typical performing provider; staff selects provider at booking
 * time via the iPad schedule route.
 *
 * IDEMPOTENT: queries existing appointmentTypes by exact name first; only
 * creates types that don't already exist. Safe to re-run.
 *
 * No pricing — per SOT (module 22, March 31 2026 incident): Healthie
 * `pricing` field auto-creates `requested_payment` on booking, which
 * caused a patient to be double-charged. Subscription billing handles
 * cost; appointment types stay $0.
 *
 * Usage:
 *   export HEALTHIE_API_KEY="gh_live_..."
 *   node scripts/healthie/create-trimix-acupuncture-types.js [--dry-run]
 *
 * Env fallback: reads /home/ec2-user/.env.production if HEALTHIE_API_KEY
 * not set in the calling shell.
 */

const fs = require('fs');
const path = require('path');

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const DRY_RUN = process.argv.includes('--dry-run');

const NEW_TYPES = [
    {
        name: 'Tri-Mix Injection Consult',
        length: 30,
        clients_can_book: false,
        contact_type_overrides: ['in_person'],
    },
    {
        name: 'Acupuncture',
        length: 30,
        clients_can_book: false,
        contact_type_overrides: ['in_person'],
    },
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
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    if (json.errors) {
        throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
}

async function fetchExistingByName(apiKey, names) {
    const data = await gql(
        apiKey,
        `query { appointmentTypes { id name } }`,
        {}
    );
    const all = data.appointmentTypes || [];
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    return all
        .filter((t) => wanted.has((t.name || '').toLowerCase()))
        .reduce((acc, t) => {
            acc[(t.name || '').toLowerCase()] = t;
            return acc;
        }, {});
}

async function createType(apiKey, type) {
    const mutation = `
        mutation CreateAppointmentType($input: createAppointmentTypeInput!) {
            createAppointmentType(input: $input) {
                appointmentType {
                    id
                    name
                    length
                    clients_can_book
                    available_contact_types
                }
                messages { field message }
            }
        }
    `;
    const input = {
        name: type.name,
        length: type.length,
        clients_can_book: type.clients_can_book,
        contact_type_overrides: type.contact_type_overrides,
    };
    const data = await gql(apiKey, mutation, { input });
    const result = data.createAppointmentType;
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
    console.log(`Types to ensure: ${NEW_TYPES.map((t) => t.name).join(', ')}\n`);

    const existing = await fetchExistingByName(
        apiKey,
        NEW_TYPES.map((t) => t.name)
    );

    const results = { created: [], skipped: [], failed: [] };

    for (const type of NEW_TYPES) {
        const found = existing[type.name.toLowerCase()];
        if (found) {
            console.log(`SKIP  ${type.name} — already exists (id ${found.id})`);
            results.skipped.push({ ...type, id: found.id });
            continue;
        }
        if (DRY_RUN) {
            console.log(`PLAN  ${type.name} — would create (length=${type.length}, in_person, staff-only)`);
            continue;
        }
        try {
            const created = await createType(apiKey, type);
            console.log(`✅    ${created.name} created (id ${created.id})`);
            results.created.push(created);
            await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
            console.error(`❌    ${type.name} — ${err.message}`);
            results.failed.push({ name: type.name, error: err.message });
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Created: ${results.created.length}`);
    console.log(`Skipped (already existed): ${results.skipped.length}`);
    console.log(`Failed:  ${results.failed.length}`);

    if (results.created.length > 0) {
        console.log('\nNew Healthie IDs (add to SOT module 24):');
        for (const t of results.created) {
            console.log(`  ${t.id} | ${t.name} | ${t.length} min | clients_can_book=${t.clients_can_book}`);
        }
    }

    process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});

/**
 * One-off script: Pull all Healthie clients and insert any missing ones into local patients + healthie_clients tables.
 *
 * Usage: npx tsx .tmp/sync-healthie-to-local.ts
 * Run from /home/ec2-user/gmhdashboard
 */

import { healthieGraphQL } from '@/lib/healthieApi';
import { query } from '@/lib/db';

interface HealthieUser {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_number: string | null;
    dob: string | null;
    gender: string | null;
    user_group: { id: string; name: string } | null;
    active_tags: { id: string; name: string }[] | null;
    location: {
        line1: string | null;
        line2: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
    } | null;
    active: boolean;
}

async function fetchAllHealthieClients(): Promise<HealthieUser[]> {
    const all: HealthieUser[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
        console.log(`Fetching Healthie clients offset=${offset}...`);
        const data = await healthieGraphQL<{ users: HealthieUser[] }>(`
            query GetAllClients($offset: Int, $limit: Int) {
                users(offset: $offset, page_size: $limit, active_status: "Active", sort_by: "ID") {
                    id
                    first_name
                    last_name
                    email
                    phone_number
                    dob
                    gender
                    active
                    user_group { id name }
                    active_tags { id name }
                    location { line1 line2 city state zip }
                }
            }
        `, { offset, limit });

        const users = data?.users || [];
        if (users.length === 0) break;

        all.push(...users);
        offset += users.length;

        // Rate limit safety — Healthie allows ~120 req/min, go slow
        await new Promise(r => setTimeout(r, 2000));
    }

    return all;
}

async function main() {
    console.log('Starting Healthie → Local DB sync...\n');

    // 1. Fetch all Healthie clients
    const healthieClients = await fetchAllHealthieClients();
    console.log(`\nFetched ${healthieClients.length} active clients from Healthie\n`);

    // 2. Get existing healthie_client_ids from local DB
    const existingLinks = await query<{ healthie_client_id: string }>(
        `SELECT healthie_client_id FROM healthie_clients WHERE is_active = true`
    );
    const linkedIds = new Set(existingLinks.map(r => r.healthie_client_id));

    const existingPatients = await query<{ healthie_client_id: string }>(
        `SELECT healthie_client_id FROM patients WHERE healthie_client_id IS NOT NULL`
    );
    const patientIds = new Set(existingPatients.map(r => r.healthie_client_id));

    // 3. Find missing clients
    const missing = healthieClients.filter(c => !linkedIds.has(c.id) && !patientIds.has(c.id));
    console.log(`Found ${missing.length} Healthie clients NOT in local DB\n`);

    if (missing.length === 0) {
        console.log('All Healthie clients are already synced!');
        process.exit(0);
    }

    // 4. Insert missing clients
    let created = 0;
    let errors = 0;

    for (const client of missing) {
        const fullName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Unknown';
        try {
            // Insert into patients table
            const [newPatient] = await query<{ patient_id: string }>(
                `INSERT INTO patients (
                    full_name, email, phone_primary, dob, gender,
                    address_line1, address_line2, city, state, postal_code,
                    healthie_client_id, status_key, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING patient_id`,
                [
                    fullName,
                    client.email || null,
                    client.phone_number || null,
                    client.dob || null,
                    client.gender || null,
                    client.location?.line1 || null,
                    client.location?.line2 || null,
                    client.location?.city || null,
                    client.location?.state || null,
                    client.location?.zip || null,
                    client.id,
                    'active',
                ]
            );

            if (newPatient) {
                // Insert into healthie_clients link table
                await query(
                    `INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active, created_at, updated_at)
                     VALUES ($1, $2, 'healthie_sync', TRUE, NOW(), NOW())
                     ON CONFLICT (healthie_client_id) DO UPDATE SET
                        patient_id = EXCLUDED.patient_id,
                        is_active = TRUE,
                        updated_at = NOW()`,
                    [newPatient.patient_id, client.id]
                );

                created++;
                console.log(`  ✅ Created: ${fullName} (Healthie: ${client.id} → Patient: ${newPatient.patient_id})`);
            }
        } catch (err: any) {
            errors++;
            console.error(`  ❌ Failed: ${fullName} (Healthie: ${client.id}): ${err.message}`);
        }
    }

    console.log(`\n=== SYNC COMPLETE ===`);
    console.log(`Created: ${created}`);
    console.log(`Errors: ${errors}`);
    console.log(`Already existed: ${healthieClients.length - missing.length}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

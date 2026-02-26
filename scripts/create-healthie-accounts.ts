#!/usr/bin/env npx tsx
/**
 * Create Healthie Accounts for Patients Missing Them
 * - Assigns to NowMensHealth.Care (75522) or NowPrimary.Care (75523) based on client type
 * - Links new Healthie ID to GMH database
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';
import { HealthieClient } from '../lib/healthie';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const healthie = new HealthieClient({
    apiKey: process.env.HEALTHIE_API_KEY!,
    apiUrl: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql'
});

// Healthie Group IDs
const GROUPS = {
    MENS_HEALTH: '75522',    // NowMensHealth.Care
    PRIMARY_CARE: '75523'    // NowPrimary.Care
};

interface PatientToCreate {
    patient_id: string;
    patient_name: string;
    email: string | null;
    phone_number: string | null;
    client_type_key: string | null;
    dob: string | null;
}

function parseName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' };
    }
    const lastName = parts.pop() || '';
    const firstName = parts.join(' ');
    return { firstName, lastName };
}

function determineGroup(clientType: string | null): string {
    if (!clientType) return GROUPS.PRIMARY_CARE;

    // Men's Health patients go to NowMensHealth.Care
    if (clientType.toLowerCase().includes('nowmenshealth') ||
        clientType.toLowerCase().includes('mens_health') ||
        clientType.toLowerCase().includes('menshealth')) {
        return GROUPS.MENS_HEALTH;
    }

    // Everyone else goes to NowPrimary.Care
    return GROUPS.PRIMARY_CARE;
}

function normalizePhone(phone: string | null): string | undefined {
    if (!phone) return undefined;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return digits.length >= 10 ? `+${digits}` : undefined;
}

async function run() {
    console.log('🏥 Creating Healthie Accounts for Missing Patients\n');

    // Get patients missing Healthie who are NOT inactive
    const result = await pool.query<PatientToCreate>(`
    SELECT 
      p.patient_id, 
      p.patient_name, 
      p.email, 
      p.phone_number,
      pts.client_type_key,
      p.dob::text
    FROM patient_data_entry_v p
    LEFT JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text AND hc.is_active = TRUE
    LEFT JOIN patients pts ON pts.patient_id::text = p.patient_id::text
    WHERE hc.patient_id IS NULL
      AND (pts.status_key IS NULL OR pts.status_key != 'inactive')
    ORDER BY p.patient_name
  `);

    console.log(`Found ${result.rows.length} patients needing Healthie accounts\n`);

    let created = 0;
    let errors = 0;
    const mensHealthCreated: string[] = [];
    const primaryCareCreated: string[] = [];

    for (const patient of result.rows) {
        try {
            const { firstName, lastName } = parseName(patient.patient_name);
            const groupId = determineGroup(patient.client_type_key);
            const groupName = groupId === GROUPS.MENS_HEALTH ? 'NowMensHealth.Care' : 'NowPrimary.Care';

            console.log(`Creating: ${patient.patient_name} → ${groupName}...`);

            // Create client in Healthie
            const newClient = await healthie.createClient({
                first_name: firstName,
                last_name: lastName || firstName, // Healthie requires last name
                email: patient.email || undefined,
                phone_number: normalizePhone(patient.phone_number),
                dob: patient.dob || undefined,
                user_group_id: groupId,
                dont_send_welcome: true,  // Don't send welcome email
                skipped_email: !patient.email  // Mark as skipped if no email
            });

            // Link to our database
            await pool.query(`
        INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method, created_at, updated_at)
        VALUES ($1, $2, TRUE, 'created', NOW(), NOW())
      `, [patient.patient_id, newClient.id]);

            console.log(`   ✅ Created Healthie ID: ${newClient.id}`);
            created++;

            if (groupId === GROUPS.MENS_HEALTH) {
                mensHealthCreated.push(patient.patient_name);
            } else {
                primaryCareCreated.push(patient.patient_name);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));

        } catch (err) {
            console.error(`   ❌ Error: ${(err as Error).message}`);
            errors++;
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Successfully created: ${created}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`\n📂 NowMensHealth.Care (${mensHealthCreated.length}):`);
    mensHealthCreated.forEach(n => console.log(`   - ${n}`));
    console.log(`\n📂 NowPrimary.Care (${primaryCareCreated.length}):`);
    primaryCareCreated.forEach(n => console.log(`   - ${n}`));

    await pool.end();
}

run().catch(console.error);

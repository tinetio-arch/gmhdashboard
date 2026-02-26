#!/usr/bin/env npx tsx
/**
 * Auto-Link Patients to Healthie
 * Searches for unlinked patients in Healthie by email and links them
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

interface PatientToLink {
    patient_id: string;
    patient_name: string;
    email: string | null;
    phone_number: string | null;
}

async function run() {
    console.log('🔗 Auto-Link Patients to Healthie\n');

    // Get patients missing Healthie links
    const result = await pool.query<PatientToLink>(`
    SELECT p.patient_id, p.patient_name, p.email, p.phone_number
    FROM patient_data_entry_v p
    LEFT JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text AND hc.is_active = TRUE
    WHERE hc.patient_id IS NULL
    ORDER BY p.patient_name
  `);

    console.log(`Found ${result.rows.length} patients missing Healthie links\n`);

    let linked = 0;
    let notFound = 0;
    let errors = 0;
    const notFoundList: string[] = [];

    for (const patient of result.rows) {
        try {
            let healthieClient = null;

            // Try to find by email first
            if (patient.email) {
                healthieClient = await healthie.findClientByEmail(patient.email);
            }

            // If not found by email, try phone
            if (!healthieClient && patient.phone_number) {
                healthieClient = await healthie.findClientByPhone(patient.phone_number);
            }

            if (healthieClient) {
                // Check if this healthie_client_id is already linked
                const existingLink = await pool.query(`
          SELECT patient_id FROM healthie_clients 
          WHERE healthie_client_id = $1
        `, [healthieClient.id]);

                if (existingLink.rows.length > 0) {
                    console.log(`⚠️ Skipped: ${patient.patient_name} - Healthie ID ${healthieClient.id} already linked to another patient`);
                    notFound++;
                    continue;
                }

                // Check if this patient already has a different Healthie link
                const existingPatient = await pool.query(`
          SELECT healthie_client_id FROM healthie_clients 
          WHERE patient_id = $1 AND is_active = TRUE
        `, [patient.patient_id]);

                if (existingPatient.rows.length > 0) {
                    // Update existing record
                    await pool.query(`
            UPDATE healthie_clients 
            SET healthie_client_id = $2, match_method = $3, updated_at = NOW()
            WHERE patient_id = $1
          `, [patient.patient_id, healthieClient.id, patient.email ? 'email' : 'phone']);
                } else {
                    // Insert new record
                    await pool.query(`
            INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method, created_at, updated_at)
            VALUES ($1, $2, TRUE, $3, NOW(), NOW())
          `, [patient.patient_id, healthieClient.id, patient.email ? 'email' : 'phone']);
                }

                console.log(`✅ Linked: ${patient.patient_name} → Healthie ID ${healthieClient.id}`);
                linked++;
            } else {
                notFoundList.push(`${patient.patient_name} (${patient.email || patient.phone_number || 'no contact info'})`);
                notFound++;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (err) {
            console.error(`❌ Error linking ${patient.patient_name}:`, (err as Error).message);
            errors++;
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Successfully linked: ${linked}`);
    console.log(`❓ Not found in Healthie: ${notFound}`);
    console.log(`❌ Errors: ${errors}`);

    if (notFoundList.length > 0) {
        console.log('\n📝 Patients not found in Healthie:');
        notFoundList.forEach(p => console.log(`   - ${p}`));
    }

    await pool.end();
}

run().catch(console.error);

/**
 * Script to fix duplicate contact errors by finding existing GHL contacts
 * and linking them to GMH patients
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from 'pg';
import { createGHLClientForMensHealth, createGHLClientForPrimaryCare } from '../lib/ghl';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const ghlMH = createGHLClientForMensHealth();
const ghlPC = createGHLClientForPrimaryCare();

// Patients with duplicate errors
const patients = [
    { name: 'Nicholas Muenks', phone: '+19289100323', email: 'nickschoeneman@icloud.com', type: 'primecare', id: '8d2c5824-1301-46a2-975f-a1e27788101a' },
    { name: 'Greg Lucas', phone: '+19289253529', type: 'menshealth', id: '56538500-7a03-415f-b2a0-56aba16f1ad2' },
    { name: 'Brandon Meyer', phone: '+17245442849', type: 'menshealth', id: 'ba118fbb-c4b3-4e3f-b10e-d189d8b1289d' },
    { name: 'Gregory Lucas', phone: '+19289253529', type: 'menshealth', id: '0c15ab46-4e77-48fb-aa60-d2b0c397385a' },
    { name: 'Josh Straight', phone: '+16232510394', type: 'menshealth', id: '94b12f4a-f128-479a-9a7a-d6297130b6a4' },
    { name: 'Anthony Horn', phone: '+19289252342', type: 'menshealth', id: '53d9e83b-b06c-4705-9e74-a67828b4be0c' },
    { name: 'Dylan Woods', phone: '+19286077157', type: 'menshealth', id: 'dd2c734b-dfd9-46ac-b207-ff04b0ac830a' },
    { name: 'Brad Odom', phone: '+19284510311', type: 'menshealth', id: '1ba02763-fba0-4ecd-9852-43adb27890a1' },
];

async function searchAndLink() {
    console.log('Searching GHL for existing contacts...');
    console.log('='.repeat(80));

    for (const p of patients) {
        const ghl = p.type === 'primecare' ? ghlPC : ghlMH;
        if (!ghl) {
            console.log(`No GHL client for ${p.type}`);
            continue;
        }

        console.log(`\n${p.name} (phone: ${p.phone})`);

        try {
            // Search by phone
            const contact = await ghl.findContactByPhone(p.phone);
            if (contact) {
                console.log(`  ✅ Found in GHL: id=${contact.id}, name=${contact.firstName} ${contact.lastName}`);

                // Update database with this GHL ID
                await pool.query(`
          UPDATE patients 
          SET ghl_contact_id = $1, 
              ghl_sync_status = 'synced',
              ghl_sync_error = NULL
          WHERE patient_id = $2
        `, [contact.id, p.id]);
                console.log(`  ✅ Linked to GMH patient ${p.id}`);
            } else {
                console.log(`  ❌ Not found by phone`);

                // Try search by name
                const nameParts = p.name.split(' ');
                const byName = await ghl.findContactByName(nameParts[0], nameParts[nameParts.length - 1]);
                if (byName) {
                    console.log(`  ✅ Found by name: id=${byName.id}, phone=${byName.phone}`);
                    await pool.query(`
            UPDATE patients 
            SET ghl_contact_id = $1, 
                ghl_sync_status = 'synced',
                ghl_sync_error = NULL
            WHERE patient_id = $2
          `, [byName.id, p.id]);
                    console.log(`  ✅ Linked to GMH patient ${p.id}`);
                } else {
                    console.log(`  ❌ Not found by name either - may need manual review`);
                }
            }
        } catch (e) {
            console.log(`  ❌ Error: ${(e as Error).message}`);
        }
    }

    await pool.end();
    console.log('\nDone!');
}

searchAndLink();

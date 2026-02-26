import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { query } from '../lib/db';

async function main() {
    try {
        await query('ALTER TABLE peptide_products ADD COLUMN IF NOT EXISTS label_directions TEXT', []);
        console.log('✅ label_directions column added');
        await query('ALTER TABLE peptide_products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true', []);
        console.log('✅ active column added');
        await query('ALTER TABLE peptide_dispenses ADD COLUMN IF NOT EXISTS patient_dob TEXT', []);
        console.log('✅ patient_dob column added to dispenses');
    } catch (e: any) {
        console.error('Error:', e.message);
    }
    process.exit(0);
}

main();

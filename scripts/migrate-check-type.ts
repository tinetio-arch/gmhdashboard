import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import pg from 'pg';

const { Pool } = pg;

async function migrate() {
    const pool = new Pool({
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT || '5432'),
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Adding check_type column...');
        await pool.query(`ALTER TABLE controlled_substance_checks ADD COLUMN IF NOT EXISTS check_type VARCHAR(20) NOT NULL DEFAULT 'morning'`);
        console.log('✅ Added check_type column');

        console.log('Creating index...');
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_cs_checks_type ON controlled_substance_checks(check_type)`);
        console.log('✅ Created index');

        console.log('Migration complete!');
    } catch (err) {
        console.error('Migration error:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();

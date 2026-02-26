#!/usr/bin/env node
/**
 * Run the supply PAR migration using the app's existing db connection.
 * Usage: timeout 30 npx tsx scripts/run-supply-migration.ts
 */
import { readFileSync } from 'fs';
import { getPool } from '../lib/db';

async function main() {
    const sql = readFileSync('./migrations/20260219_supply_par.sql', 'utf8');
    const pool = getPool();
    try {
        await pool.query(sql);
        console.log('✅ Supply PAR tables created successfully');

        // Quick verify
        const res = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('supply_items', 'supply_counts', 'supply_count_history')
      ORDER BY table_name
    `);
        console.log('Tables:', res.rows.map(r => r.table_name).join(', '));
    } catch (err: any) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();

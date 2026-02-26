#!/usr/bin/env tsx
/**
 * Check status_key values in patients table
 */
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';

async function main() {
    const statuses = await query<{ status_key: string; count: string }>(`
    SELECT status_key, COUNT(*)::text as count
    FROM patients
    GROUP BY status_key
    ORDER BY COUNT(*) DESC;
  `);

    console.log('Patient Status Distribution:\n');
    statuses.forEach(s => {
        console.log(`  ${s.status_key || 'NULL'}: ${s.count}`);
    });
}

main().catch(console.error).finally(() => process.exit(0));

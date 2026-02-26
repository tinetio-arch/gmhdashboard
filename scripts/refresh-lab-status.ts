#!/usr/bin/env npx tsx
/**
 * Refresh Lab Status - Updates lab_status in the labs table based on current date
 * 
 * Lab status logic:
 * - If next_lab_date < today: "Overdue by X days"
 * - If next_lab_date within 30 days: "Due in X days"  
 * - If next_lab_date > 30 days out: "Current (due in X days)"
 * - If no next_lab_date but has last_lab_date: compute from last_lab
 * 
 * Run manually: npx tsx scripts/refresh-lab-status.ts
 * Cron: 0 5 * * * (daily at 5am UTC / 10pm MST)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db';

async function refreshLabStatus() {
    console.log('🔬 Refreshing lab status values...\n');

    // Update labs table with computed status based on next_lab_date
    const updateResult = await query(`
        UPDATE labs
        SET 
            lab_status = CASE
                WHEN next_lab_date IS NULL AND last_lab_date IS NOT NULL THEN
                    CASE 
                        WHEN (CURRENT_DATE - last_lab_date) > 180 THEN 'Overdue (last lab ' || (CURRENT_DATE - last_lab_date) || ' days ago)'
                        ELSE 'Current (last lab ' || (CURRENT_DATE - last_lab_date) || ' days ago)'
                    END
                WHEN next_lab_date < CURRENT_DATE THEN 'Overdue by ' || (CURRENT_DATE - next_lab_date) || ' days'
                WHEN next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Due in ' || (next_lab_date - CURRENT_DATE) || ' days'
                ELSE 'Current (due in ' || (next_lab_date - CURRENT_DATE) || ' days)'
            END,
            updated_at = NOW()
        WHERE 
            next_lab_date IS NOT NULL 
            OR last_lab_date IS NOT NULL
        RETURNING lab_id
    `);

    console.log(`✅ Updated ${updateResult.length} lab records\n`);

    // Also update patients table lab_status for patients without labs table entry
    const patientUpdate = await query(`
        UPDATE patients p
        SET 
            lab_status = CASE
                WHEN NOT EXISTS (SELECT 1 FROM labs l WHERE l.patient_id = p.patient_id) THEN 'No lab data'
                ELSE p.lab_status
            END,
            last_modified = NOW()
        WHERE 
            status_key IN ('active', 'active_pending')
            AND NOT EXISTS (SELECT 1 FROM labs l WHERE l.patient_id = p.patient_id)
        RETURNING patient_id
    `);

    console.log(`📋 Updated ${patientUpdate.length} patients with no lab records\n`);

    // Show summary
    const summary = await query(`
        SELECT 
            status_category,
            COUNT(*) as count
        FROM (
            SELECT 
                p.patient_id,
                CASE 
                    WHEN COALESCE(l.lab_status, '') LIKE 'Overdue%' THEN 'Overdue'
                    WHEN COALESCE(l.lab_status, '') LIKE 'Due in%' THEN 'Due Soon'
                    WHEN COALESCE(l.lab_status, '') LIKE 'Current%' THEN 'Current'
                    ELSE 'No Data'
                END as status_category
            FROM patients p
            LEFT JOIN labs l ON l.patient_id = p.patient_id
            WHERE p.status_key IN ('active', 'active_pending')
        ) sub
        GROUP BY status_category
        ORDER BY 
            CASE status_category
                WHEN 'Overdue' THEN 1
                WHEN 'Due Soon' THEN 2
                WHEN 'Current' THEN 3
                ELSE 4
            END
    `);

    console.log('=== LAB STATUS SUMMARY ===');
    summary.forEach((r: any) => console.log(`  ${r.status_category}: ${r.count}`));

    console.log('\n🎉 Lab status refresh complete!');
}

async function main() {
    try {
        await refreshLabStatus();
        process.exit(0);
    } catch (err) {
        console.error('❌ Lab status refresh failed:', err);
        process.exit(1);
    }
}

main();

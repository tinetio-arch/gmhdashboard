/**
 * TEMPORARY: Fix peptide_products column widths
 * DELETE THIS FILE AFTER USE
 * 
 * The category column was VARCHAR(10) but the UI sends values like 'Growth Hormone' (15 chars).
 * This widens all narrow VARCHAR columns to prevent "value too long" errors.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function POST() {
    try {
        await requireUser('write');

        const results: string[] = [];

        // 1. Check current schema
        const cols = await query<{ column_name: string; data_type: string; character_maximum_length: number | null }>(
            `SELECT column_name, data_type, character_maximum_length 
             FROM information_schema.columns 
             WHERE table_name = 'peptide_products' 
             ORDER BY ordinal_position`
        );

        results.push('=== BEFORE ===');
        cols.forEach(c => results.push(`  ${c.column_name}: ${c.data_type}(${c.character_maximum_length || 'unlimited'})`));

        // 2. Widen narrow columns
        const fixes = [
            { col: 'category', target: 50 },
            { col: 'sku', target: 50 },
            { col: 'name', target: 200 },
            { col: 'supplier', target: 100 },
        ];

        for (const fix of fixes) {
            const col = cols.find(c => c.column_name === fix.col);
            if (col && col.character_maximum_length && col.character_maximum_length < fix.target) {
                await query(`ALTER TABLE peptide_products ALTER COLUMN ${fix.col} TYPE VARCHAR(${fix.target})`);
                results.push(`✅ ${fix.col}: VARCHAR(${col.character_maximum_length}) → VARCHAR(${fix.target})`);
            } else if (col) {
                results.push(`⏭️ ${fix.col}: already VARCHAR(${col.character_maximum_length || 'unlimited'}) — no change needed`);
            } else {
                results.push(`⚠️ ${fix.col}: column not found`);
            }
        }

        // 3. Verify
        const after = await query<{ column_name: string; data_type: string; character_maximum_length: number | null }>(
            `SELECT column_name, data_type, character_maximum_length 
             FROM information_schema.columns 
             WHERE table_name = 'peptide_products' 
             ORDER BY ordinal_position`
        );

        results.push('=== AFTER ===');
        after.forEach(c => results.push(`  ${c.column_name}: ${c.data_type}(${c.character_maximum_length || 'unlimited'})`));

        // 4. Test insert
        try {
            await query('BEGIN');
            await query(
                `INSERT INTO peptide_products (name, category, reorder_point) VALUES ($1, $2, $3)`,
                ['__SCHEMA_TEST__', 'Growth Hormone', 5]
            );
            await query(`DELETE FROM peptide_products WHERE name = '__SCHEMA_TEST__'`);
            await query('COMMIT');
            results.push('✅ Test insert with "Growth Hormone" category SUCCEEDED');
        } catch (testErr) {
            await query('ROLLBACK');
            results.push(`❌ Test insert FAILED: ${testErr instanceof Error ? testErr.message : String(testErr)}`);
        }

        // 5. Data counts
        const [counts] = await query<{ products: string; orders: string; dispenses: string }>(
            `SELECT 
                (SELECT COUNT(*) FROM peptide_products) as products,
                (SELECT COUNT(*) FROM peptide_orders) as orders,
                (SELECT COUNT(*) FROM peptide_dispenses) as dispenses`
        );
        results.push(`📊 Products: ${counts.products}, Orders: ${counts.orders}, Dispenses: ${counts.dispenses}`);

        return NextResponse.json({ success: true, results });
    } catch (error) {
        console.error('Schema fix error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', stack: error instanceof Error ? error.stack : undefined },
            { status: 500 }
        );
    }
}

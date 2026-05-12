/**
 * Import Premier Plan wholesale prices from the YPB catalog CSV.
 * Source: Google Sheet docs/1x5XcmmxajDUCuw701PBMgmznbZZ44vZfF8J7VoEUU1U
 * Column 7 = "Premier Plan $497/mo" — our tier's wholesale price per SKU.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import * as fs from 'fs';

function parseCSVLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            out.push(cur); cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

async function main() {
    const raw = fs.readFileSync('/tmp/ypb-wholesale.csv', 'utf8');
    const lines = raw.split('\n');

    // Find header row — contains "SKU" and "Premier Plan"
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/\bSKU\b/i.test(lines[i]) && /Premier Plan/i.test(lines[i])) { headerIdx = i; break; }
    }
    if (headerIdx < 0) { console.error('Header row not found'); process.exit(1); }
    const header = parseCSVLine(lines[headerIdx]);
    console.log('Header columns:', header.map((c, i) => `${i}:${c}`).join(' | '));

    // Locate specific columns
    const SKU_COL = header.findIndex(h => /^\s*SKU\s*$/i.test(h));
    const NAME_COL = header.findIndex(h => /Product Name/i.test(h));
    const PREMIER_COL = header.findIndex(h => /Premier Plan/i.test(h));
    const MSRP_COL = header.findIndex(h => /^\s*MSRP\s*$/i.test(h));
    console.log(`Cols: SKU=${SKU_COL}, Name=${NAME_COL}, Premier=${PREMIER_COL}, MSRP=${MSRP_COL}`);

    let matched = 0, unmatched = 0, skipped = 0;
    const unmatchedSkus: string[] = [];

    for (let i = headerIdx + 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const sku = (cols[SKU_COL] || '').trim();
        const priceStr = (cols[PREMIER_COL] || '').replace(/[$,\s]/g, '');
        const price = parseFloat(priceStr);
        const productName = (cols[NAME_COL] || '').trim();

        if (!sku || !/^YPB\./i.test(sku)) { skipped++; continue; }
        if (isNaN(price) || price <= 0) { skipped++; continue; }

        const result = await query<{ sku: string; product_name: string }>(
            `UPDATE ypb_available_products
             SET wholesale_cost = $1,
                 wholesale_cost_updated_at = NOW(),
                 wholesale_cost_source = 'premier-plan-catalog'
             WHERE UPPER(sku) = UPPER($2)
             RETURNING sku, product_name`,
            [price, sku]
        );

        if (result.length > 0) {
            matched++;
            console.log(`  ✓ ${sku.padEnd(10)} $${price.toFixed(2).padStart(7)} → ${result[0].product_name}`);
        } else {
            unmatched++;
            unmatchedSkus.push(`${sku} ($${price.toFixed(2)}) ${productName}`);
        }
    }

    console.log(`\n=== RESULT ===`);
    console.log(`Matched & updated: ${matched}`);
    console.log(`Not in our ypb_available_products table: ${unmatched}`);
    console.log(`Skipped (no SKU / no price): ${skipped}`);

    if (unmatched > 0) {
        console.log(`\nSKUs in catalog but NOT in our DB (${unmatched}):`);
        for (const s of unmatchedSkus.slice(0, 30)) console.log(`  ${s}`);
    }

    // Show coverage
    const coverage = await query<{ n: string; with_cost: string }>(
        `SELECT COUNT(*)::text AS n, COUNT(wholesale_cost)::text AS with_cost FROM ypb_available_products WHERE available = true`
    );
    console.log(`\nDB coverage: ${coverage[0]?.with_cost}/${coverage[0]?.n} available products now have wholesale cost.`);

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

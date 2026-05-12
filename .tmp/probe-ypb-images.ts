/**
 * Probe abxtac.com/3d-vials/{SKU}_mockup.png for every YPB SKU.
 * Mark which ones have actual images. Store in ypb_available_products.has_image.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import * as https from 'https';

async function headCheck(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const req = https.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
            resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

async function main() {
    // Ensure column exists
    await query(`ALTER TABLE ypb_available_products
      ADD COLUMN IF NOT EXISTS has_image BOOLEAN DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS has_image_checked_at TIMESTAMPTZ DEFAULT NULL`);

    const rows = await query<{ sku: string; product_name: string }>(
        `SELECT sku, product_name FROM ypb_available_products WHERE available = true ORDER BY sku`
    );
    console.log(`Probing ${rows.length} SKUs...`);

    let withImg = 0, withoutImg = 0;
    const missing: string[] = [];

    for (const r of rows) {
        const url = `https://abxtac.com/3d-vials/${r.sku}_mockup.png`;
        const has = await headCheck(url);
        await query(
            `UPDATE ypb_available_products SET has_image = $1, has_image_checked_at = NOW() WHERE sku = $2`,
            [has, r.sku]
        );
        if (has) {
            withImg++;
        } else {
            withoutImg++;
            missing.push(`${r.sku}: ${r.product_name}`);
        }
        process.stdout.write(has ? '.' : 'x');
    }
    console.log(`\n\nResults: ${withImg} have images / ${withoutImg} missing`);
    if (missing.length) {
        console.log('\nSKUs missing images:');
        for (const m of missing) console.log('  ' + m);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

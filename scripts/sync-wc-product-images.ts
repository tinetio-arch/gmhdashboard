#!/usr/bin/env npx tsx
/**
 * Sync 3D Vial Mockup Images to WooCommerce Products
 *
 * FIX(2026-04-10): WooCommerce order confirmation emails don't show product images
 * because WC products have no images set. This script sets the `images` array on
 * each product to point to the 3D vial mockup hosted at abxtac.com/3d-vials/.
 *
 * Usage: npx tsx scripts/sync-wc-product-images.ts
 * Dry run: npx tsx scripts/sync-wc-product-images.ts --dry-run
 */

import 'dotenv/config';

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_WC_CONSUMER_KEY;
const WC_SECRET = process.env.ABXTAC_WC_CONSUMER_SECRET;

const DRY_RUN = process.argv.includes('--dry-run');

if (!WC_KEY || !WC_SECRET) {
    console.error('Missing ABXTAC_WC_CONSUMER_KEY or ABXTAC_WC_CONSUMER_SECRET in .env');
    process.exit(1);
}

const API_BASE = `${WC_URL}/wp-json/wc/v3`;
const AUTH = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');

async function wcGet(endpoint: string) {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Authorization': `Basic ${AUTH}` },
    });
    if (!resp.ok) throw new Error(`WC GET ${endpoint}: ${resp.status} ${await resp.text()}`);
    return resp.json();
}

async function wcPut(endpoint: string, body: any) {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Basic ${AUTH}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`WC PUT ${endpoint}: ${resp.status} ${await resp.text()}`);
    return resp.json();
}

async function main() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Syncing 3D vial images to WooCommerce products...\n`);

    // 1. Fetch all products
    let page = 1;
    let allProducts: any[] = [];
    while (true) {
        const products = await wcGet(`/products?per_page=100&page=${page}`);
        allProducts = allProducts.concat(products);
        if (products.length < 100) break;
        page++;
    }

    console.log(`Found ${allProducts.length} WooCommerce products\n`);

    let updated = 0;
    let skipped = 0;
    let noSku = 0;

    for (const product of allProducts) {
        const sku = product.sku;
        const name = product.name;

        if (!sku || !sku.startsWith('YPB.')) {
            console.log(`  SKIP (no YPB SKU): "${name}" [sku: ${sku || 'none'}]`);
            noSku++;
            continue;
        }

        const imageUrl = `https://abxtac.com/3d-vials/${sku}_mockup.png`;

        // Check if product already has this image
        const existingImages = product.images || [];
        const alreadyHasImage = existingImages.some((img: any) =>
            img.src?.includes(sku) || img.src?.includes('3d-vials')
        );

        if (alreadyHasImage) {
            console.log(`  OK: "${name}" [${sku}] — already has 3D vial image`);
            skipped++;
            continue;
        }

        // Set the 3D vial as the primary product image
        const newImages = [
            { src: imageUrl, name: `${sku} 3D Vial Mockup`, alt: name },
            ...existingImages, // Keep any existing images as secondary
        ];

        if (DRY_RUN) {
            console.log(`  WOULD UPDATE: "${name}" [${sku}] → ${imageUrl}`);
            updated++;
        } else {
            try {
                await wcPut(`/products/${product.id}`, { images: newImages });
                console.log(`  ✅ UPDATED: "${name}" [${sku}] → 3D vial image set`);
                updated++;
            } catch (err: any) {
                console.error(`  ❌ FAILED: "${name}" [${sku}] — ${err.message}`);
            }
        }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Total products: ${allProducts.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Already had image: ${skipped}`);
    console.log(`No YPB SKU: ${noSku}`);
    if (DRY_RUN) console.log('\n[DRY RUN] No changes were made. Run without --dry-run to apply.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

/**
 * Import Jane EMR Products to Healthie
 * 
 * Usage:
 *   DRY_RUN=true npx tsx scripts/import-products-to-healthie.ts   # Test with first 3 products
 *   npx tsx scripts/import-products-to-healthie.ts                 # Full import
 * 
 * Rate Limiting:
 *   - 500ms delay between requests
 *   - Batch pause every 10 products (2s)
 */

import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || 'gh_live_SHmVYEL4hDX2o7grAgDDVvDkpvYgzRHzlZlgQOZ7WTp9KZgmAeEgJpOtB8HLMCVp';

const CSV_PATH = '/home/ec2-user/.antigravity-server/bin/Products.csv';
const DRY_RUN = process.env.DRY_RUN === 'true';
const DELAY_MS = 500;  // 500ms between requests
const BATCH_SIZE = 10; // Pause every 10 products
const BATCH_PAUSE_MS = 2000; // 2s pause between batches

interface JaneProduct {
    Name: string;
    Info: string;
    Price: string;
    'Product Code': string;
    'Income Category': string;
    Cost: string;
    Manufacturer: string;
    Supplier: string;
    SKU: string;
    MSRP: string;
    Notes: string;
    '# Sold in Last 30 Days': string;
    'Reorder Quantity': string;
    'Price Includes Tax': string;
    'NOW Primary Care Inventory': string;
    'NowMensHealth.Care Inventory': string;
    'Tax (Sales Tax)': string;
}

interface CreateProductResult {
    name: string;
    success: boolean;
    id?: string;
    error?: string;
}

async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function createProduct(product: JaneProduct): Promise<CreateProductResult> {
    const mutation = `
    mutation CreateProduct($input: createProductInput!) {
      createProduct(input: $input) {
        product {
          id
          name
          price
        }
        messages {
          field
          message
        }
      }
    }
  `;

    // Parse price - remove any currency symbols, handle empty
    let price = product.Price?.replace(/[^0-9.]/g, '') || '0';
    if (!price || price === '') price = '0';

    // Determine tax description
    const taxDescription = product['Tax (Sales Tax)']?.trim() || null;

    const input = {
        name: product.Name.trim(),
        price: price,
        unlimited_quantity: true,
        ...(taxDescription && { tax_description: taxDescription }),
    };

    try {
        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: mutation,
                variables: { input },
            }),
        });

        const data = await response.json();

        if (data.errors) {
            return {
                name: product.Name,
                success: false,
                error: data.errors.map((e: any) => e.message).join(', '),
            };
        }

        if (data.data?.createProduct?.messages?.length > 0) {
            return {
                name: product.Name,
                success: false,
                error: data.data.createProduct.messages.map((m: any) => `${m.field}: ${m.message}`).join(', '),
            };
        }

        return {
            name: product.Name,
            success: true,
            id: data.data?.createProduct?.product?.id,
        };
    } catch (error: any) {
        return {
            name: product.Name,
            success: false,
            error: error.message,
        };
    }
}

async function main() {
    console.log('🚀 Healthie Product Import');
    console.log('═'.repeat(60));
    console.log(`📁 Source: ${CSV_PATH}`);
    console.log(`⏱️  Delay: ${DELAY_MS}ms between requests`);
    console.log(`📦 Batch: Pause ${BATCH_PAUSE_MS}ms every ${BATCH_SIZE} products`);
    if (DRY_RUN) {
        console.log('🧪 DRY RUN MODE - Only importing first 3 products');
    }
    console.log('═'.repeat(60) + '\n');

    // Read and parse CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const records: JaneProduct[] = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
    });

    console.log(`📋 Found ${records.length} products in CSV\n`);

    // Filter out empty rows
    const products = records.filter(p => p.Name && p.Name.trim());
    console.log(`✅ ${products.length} valid products to import\n`);

    // Limit for dry run
    const toImport = DRY_RUN ? products.slice(0, 3) : products;

    const results: CreateProductResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < toImport.length; i++) {
        const product = toImport[i];

        // Batch pause
        if (i > 0 && i % BATCH_SIZE === 0) {
            console.log(`\n⏸️  Batch pause (${BATCH_PAUSE_MS}ms)...\n`);
            await delay(BATCH_PAUSE_MS);
        }

        const result = await createProduct(product);
        results.push(result);

        if (result.success) {
            successCount++;
            console.log(`✅ [${i + 1}/${toImport.length}] ${result.name} (ID: ${result.id})`);
        } else {
            failCount++;
            console.log(`❌ [${i + 1}/${toImport.length}] ${result.name} - ${result.error}`);
        }

        // Delay between requests
        if (i < toImport.length - 1) {
            await delay(DELAY_MS);
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed:  ${failCount}`);
    console.log(`📦 Total:   ${toImport.length}`);

    if (failCount > 0) {
        console.log('\n❌ Failed Products:');
        results.filter(r => !r.success).forEach(r => {
            console.log(`   - ${r.name}: ${r.error}`);
        });
    }

    if (DRY_RUN) {
        console.log('\n🧪 DRY RUN complete. Run without DRY_RUN=true for full import.');
    }

    console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

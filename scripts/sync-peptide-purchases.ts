#!/usr/bin/env npx tsx
/**
 * Sync Peptide Purchases from Healthie
 * 
 * Queries Healthie for product purchases matching peptide product IDs (29082-29109)
 * and creates "Pending" dispense records in peptide_dispenses table.
 * 
 * This acts as a safety net to catch purchases that might have been missed by webhooks.
 * 
 * Cron Schedule: Every 6 hours at :50 (after billing syncs)
 * Usage: npx tsx scripts/sync-peptide-purchases.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';
import { query } from '@/lib/db';

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

interface HealthieOfferingPurchase {
    id: string;
    offering_id: string;
    offering_name: string;
    user_id: string;
    user_name: string;
    purchased_at: string;
    payment_status: string;
}

interface PeptideProduct {
    product_id: string;
    name: string;
    healthie_product_id: string;
}

async function fetchPeptideProducts(): Promise<PeptideProduct[]> {
    return query<PeptideProduct>(`
    SELECT product_id, name, healthie_product_id 
    FROM peptide_products 
    WHERE healthie_product_id IS NOT NULL
  `);
}

async function fetchExistingDispenses(): Promise<Set<string>> {
    const rows = await query<{ healthie_purchase_id: string }>(`
    SELECT healthie_purchase_id 
    FROM peptide_dispenses 
    WHERE healthie_purchase_id IS NOT NULL
  `);
    return new Set(rows.map(r => r.healthie_purchase_id));
}

async function fetchHealthiePurchases(offeringIds: string[]): Promise<HealthieOfferingPurchase[]> {
    if (!HEALTHIE_API_KEY) {
        console.error('Missing HEALTHIE_API_KEY');
        return [];
    }

    const allPurchases: HealthieOfferingPurchase[] = [];

    // Query for user_package_selections by offering_id (required by Healthie API)
    const graphqlQuery = `query GetPackageSelections($offering_id: ID, $offset: Int, $page_size: Int) {
    userPackageSelections(offering_id: $offering_id, offset: $offset, page_size: $page_size) {
      id
      offering { id name }
      user { id full_name }
      created_at
    }
  }`;

    console.log(`📥 Fetching purchases for ${offeringIds.length} peptide products from Healthie...`);

    // Query each peptide product separately (API requires offering_id or user_id)
    for (const offeringId of offeringIds) {
        let offset = 0;
        let hasMore = true;
        const pageSize = 50;

        while (hasMore) {
            try {
                const res = await fetch('https://api.gethealthie.com/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        authorization: `Basic ${HEALTHIE_API_KEY}`,
                        authorizationsource: 'API'
                    },
                    body: JSON.stringify({
                        query: graphqlQuery,
                        variables: { offering_id: offeringId, offset, page_size: pageSize }
                    })
                });

                const data = await res.json() as any;

                if (data.errors) {
                    // Skip products with no purchases or invalid IDs
                    if (!data.errors[0]?.message?.includes('No record')) {
                        console.log(`   Offering ${offeringId}: ${data.errors[0]?.message || 'API error'}`);
                    }
                    break;
                }

                const selections = data.data?.userPackageSelections || [];

                for (const sel of selections) {
                    allPurchases.push({
                        id: sel.id,
                        offering_id: sel.offering?.id || offeringId,
                        offering_name: sel.offering?.name || 'Unknown',
                        user_id: sel.user?.id || '',
                        user_name: sel.user?.full_name || 'Unknown',
                        purchased_at: sel.created_at,
                        payment_status: 'Pending'
                    });
                }

                if (selections.length < pageSize) {
                    hasMore = false;
                } else {
                    offset += pageSize;
                }

                // Rate limiting between pages
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`Error fetching offering ${offeringId}:`, err);
                break;
            }
        }

        // Rate limiting between products
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`✅ Total peptide purchases from Healthie: ${allPurchases.length}`);
    return allPurchases;
}

async function createPendingDispenses(
    purchases: HealthieOfferingPurchase[],
    productMap: Map<string, PeptideProduct>,
    existingPurchaseIds: Set<string>
): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const purchase of purchases) {
        // Skip if already exists
        if (existingPurchaseIds.has(purchase.id)) {
            skipped++;
            continue;
        }

        const product = productMap.get(purchase.offering_id);
        if (!product) {
            console.log(`⚠️  No product mapping for offering ${purchase.offering_id}`);
            skipped++;
            continue;
        }

        try {
            await query(`
        INSERT INTO peptide_dispenses (
          product_id, quantity, patient_name, sale_date, order_date,
          status, education_complete, paid, notes, healthie_purchase_id
        ) VALUES ($1, 1, $2, $3::date, $3::date, 'Pending', false, false, $4, $5)
        ON CONFLICT (healthie_purchase_id) DO NOTHING
      `, [
                product.product_id,
                purchase.user_name,
                purchase.purchased_at.split(' ')[0], // Extract date
                `Auto-synced from Healthie purchase ${purchase.id}`,
                purchase.id
            ]);
            created++;
            console.log(`✅ Created pending dispense: ${purchase.user_name} - ${product.name}`);
        } catch (err) {
            console.error(`Error creating dispense for ${purchase.user_name}:`, err);
        }
    }

    return { created, skipped };
}

async function main() {
    console.log('🔄 Syncing peptide purchases from Healthie...');
    console.log(`   Time: ${new Date().toISOString()}`);

    // Get peptide products with Healthie IDs
    const products = await fetchPeptideProducts();
    console.log(`📦 Found ${products.length} peptide products with Healthie IDs`);

    if (products.length === 0) {
        console.log('No peptide products configured with Healthie IDs. Exiting.');
        return;
    }

    // Build product ID map
    const healthieIds = products.map(p => p.healthie_product_id);
    const productMap = new Map<string, PeptideProduct>();
    for (const p of products) {
        productMap.set(p.healthie_product_id, p);
    }

    // Get existing dispenses to avoid duplicates
    const existingPurchaseIds = await fetchExistingDispenses();
    console.log(`📋 ${existingPurchaseIds.size} existing dispenses with Healthie purchase IDs`);

    // Fetch purchases from Healthie
    const purchases = await fetchHealthiePurchases(healthieIds);

    // Create pending dispenses for new purchases
    const { created, skipped } = await createPendingDispenses(
        purchases,
        productMap,
        existingPurchaseIds
    );

    console.log('\n🎉 Sync complete!');
    console.log(`   Created: ${created} new pending dispenses`);
    console.log(`   Skipped: ${skipped} (already exists or no product mapping)`);
}

main().catch(err => {
    console.error('Sync failed:', err);
    process.exit(1);
});

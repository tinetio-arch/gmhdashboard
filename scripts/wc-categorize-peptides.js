#!/usr/bin/env node
/**
 * WooCommerce Peptide Category Migration
 *
 * Creates 11 therapeutic categories on abxtac.com and reassigns all YPB products.
 * Also creates the $30 Peptide Supply Kit product.
 *
 * SAFE: Does NOT change visibility, pricing, or product status.
 * Only updates category assignments.
 *
 * Usage: node scripts/wc-categorize-peptides.js [--dry-run]
 */

require('dotenv').config({ path: '.env.local' });

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY;
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET;

if (!WC_KEY || !WC_SECRET) {
  console.error('Missing ABXTAC_CONSUMER_KEY or ABXTAC_CONSUMER_SECRET in .env.local');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('=== DRY RUN MODE — no changes will be made ===\n');

// ── Category Definitions ──────────────────────────────────────────

const CATEGORIES_TO_CREATE = [
  { name: 'Healing & Tissue Repair', slug: 'healing-tissue-repair' },
  { name: 'Weight Management',       slug: 'weight-management' },
  { name: 'Sexual Health',           slug: 'sexual-health' },
  { name: 'Cognitive & Neuro',       slug: 'cognitive-neuro' },
  { name: 'Anti-Aging & Longevity',  slug: 'anti-aging-longevity' },
  { name: 'Growth Hormone',          slug: 'growth-hormone' },
  { name: 'Sleep & Recovery',        slug: 'sleep-recovery' },
  { name: 'Immune Support',          slug: 'immune-support' },
  { name: 'Body Composition',        slug: 'body-composition' },
  { name: 'Vitamins',                slug: 'vitamins' },
  { name: 'Supplies',                slug: 'supplies' },
];

// ── Product → Category Mapping (SKU → slug) ──────────────────────

const SKU_TO_CATEGORY = {
  // ── Healing & Tissue Repair ──
  'YPB.212': 'healing-tissue-repair',  // BPC-157 (5mg)
  'YPB.213': 'healing-tissue-repair',  // BPC-157 (10mg)
  'YPB.237': 'healing-tissue-repair',  // BPC-157 (20mg)
  'YPB.214': 'healing-tissue-repair',  // TB500 (5mg)
  'YPB.215': 'healing-tissue-repair',  // TB500 (10mg)
  'YPB.216': 'healing-tissue-repair',  // Wolverine Blend (5mg)
  'YPB.217': 'healing-tissue-repair',  // Wolverine Blend (10mg)
  'YPB.218': 'healing-tissue-repair',  // GLOW GHK-Cu/BPC/TB
  'YPB.221': 'healing-tissue-repair',  // GHK-Cu (50mg)
  'YPB.222': 'healing-tissue-repair',  // GHK-Cu (100mg)
  'YPB.244': 'healing-tissue-repair',  // LL37 (5mg)
  'YPB.264': 'healing-tissue-repair',  // KLOW blend

  // ── Weight Management ──
  'YPB.200': 'weight-management',  // GLP-1 Semaglutide (10mg)
  'YPB.201': 'weight-management',  // GLP-1 Semaglutide (20mg)
  'YPB.202': 'weight-management',  // GLP-1 Semaglutide (30mg)
  'YPB.203': 'weight-management',  // GLP-2 Tirzepatide (10mg)
  'YPB.204': 'weight-management',  // GLP-2 Tirzepatide (20mg)
  'YPB.205': 'weight-management',  // GLP-2 Tirzepatide (30mg)
  'YPB.206': 'weight-management',  // GLP-2 Tirzepatide (40mg)
  'YPB.207': 'weight-management',  // GLP-2 Tirzepatide (50mg)
  'YPB.208': 'weight-management',  // GLP-2 Tirzepatide (60mg)
  'YPB.209': 'weight-management',  // GLP-3 Retatrutide (10mg)
  'YPB.210': 'weight-management',  // GLP-3 Retatrutide (20mg)
  'YPB.234': 'weight-management',  // GLP-3 Retatrutide (30mg)
  'YPB.235': 'weight-management',  // GLP-3 Retatrutide (40mg)
  'YPB.236': 'weight-management',  // GLP-3 Retatrutide (50mg)
  'YPB.287': 'weight-management',  // GLP-3 Retatrutide RZ (60mg)
  'YPB.239': 'weight-management',  // Cagrilintide (5mg) / GLP-1 S (5mg)
  'YPB.240': 'weight-management',  // Cagrilintide (2.5mg) / GLP-1 S (2.5mg)
  'YPB.241': 'weight-management',  // Cagrilintide (10mg)
  'YPB.242': 'weight-management',  // 5-amino-1mq (5mg)
  'YPB.247': 'weight-management',  // 5-amino-1mq (50mg)
  'YPB.243': 'weight-management',  // SLU-PP-332 (5mg)
  'YPB.248': 'weight-management',  // AOD9604 (5mg)
  'YPB.269': 'weight-management',  // Mazdutide (100mg)
  'YPB.278': 'weight-management',  // Survodutide (10mg)

  // ── Sexual Health ──
  'YPB.266': 'sexual-health',  // KissPeptin (10mg)
  'YPB.270': 'sexual-health',  // Melanotan 2 (10mg)
  'YPB.274': 'sexual-health',  // PT-141 (10mg)

  // ── Cognitive & Neuro ──
  'YPB.219': 'cognitive-neuro',  // CJC-1295 Without DAC (10mg)
  'YPB.228': 'cognitive-neuro',  // Selank (10mg) [draft]
  'YPB.229': 'cognitive-neuro',  // Semax (10mg) [draft]
  'YPB.245': 'cognitive-neuro',  // SS-31 (10mg)
  'YPB.273': 'cognitive-neuro',  // Pinealon (20mg)
  'YPB.272': 'cognitive-neuro',  // Snap-8 (10mg)

  // ── Anti-Aging & Longevity ──
  'YPB.223': 'anti-aging-longevity',  // NAD+ (500mg)
  'YPB.224': 'anti-aging-longevity',  // NAD+ (1000mg)
  'YPB.227': 'anti-aging-longevity',  // MOTS-c (10mg)
  'YPB.271': 'anti-aging-longevity',  // MOTS-c (40mg)
  'YPB.232': 'anti-aging-longevity',  // N-Acetyl Epitalon Amidate (5mg)
  'YPB.253': 'anti-aging-longevity',  // Epitalon (10mg)
  'YPB.254': 'anti-aging-longevity',  // Epitalon (50mg)
  'YPB.255': 'anti-aging-longevity',  // FOXO4 (10mg)
  'YPB.275': 'anti-aging-longevity',  // PNC-27 (10mg)

  // ── Growth Hormone ──
  'YPB.211': 'growth-hormone',  // Sermorelin (10mg)
  'YPB.220': 'growth-hormone',  // CJC-1295 With DAC (5mg)
  'YPB.238': 'growth-hormone',  // 2X Blend CJC-1295/Ipamorelin [draft]
  'YPB.230': 'growth-hormone',  // DSIP (15mg)
  'YPB.252': 'growth-hormone',  // DSIP (5mg)
  'YPB.257': 'growth-hormone',  // GHRP-6 Acetate (10mg)
  'YPB.282': 'growth-hormone',  // GHRP-6 Acetate (5mg)
  'YPB.261': 'growth-hormone',  // Hexarelin Acetate (5mg)
  'YPB.262': 'growth-hormone',  // IGF-1 LR3 (1mg)
  'YPB.285': 'growth-hormone',  // IGF-1 LR3 (0.1mg)
  'YPB.286': 'growth-hormone',  // IGF-DES (0.1mg)
  'YPB.263': 'growth-hormone',  // Ipamorelin (10mg)
  'YPB.279': 'growth-hormone',  // Tesamorelin (10mg)
  'YPB.288': 'growth-hormone',  // Tesamorelin (20mg)
  'YPB.233': 'growth-hormone',  // GDF-8 (1mg)

  // ── Sleep & Recovery ──
  'YPB.246': 'sleep-recovery',  // SS-31 (50mg)
  'YPB.281': 'sleep-recovery',  // VIP10 (10mg)
  'YPB.277': 'sleep-recovery',  // ARA-290 (10mg)

  // ── Immune Support ──
  'YPB.231': 'immune-support',  // Thymosin Alpha 1 (TA1) (10mg)
  'YPB.280': 'immune-support',  // Thymalin (10mg)
  'YPB.265': 'immune-support',  // KPV / Lysine-Proline-Valine (10mg)

  // ── Body Composition ──
  'YPB.250': 'body-composition',  // AICAR (50mg)
  'YPB.256': 'body-composition',  // HCG (10000iu)
  'YPB.258': 'body-composition',  // HMG (75iu)
  'YPB.249': 'body-composition',  // ACE-031 (1mg)

  // ── Vitamins ──
  'YPB.251': 'vitamins',  // B12 (10ml)
  'YPB.259': 'vitamins',  // Glutathione (1500mg)
  'YPB.283': 'vitamins',  // Glutathione (600mg)
  'YPB.267': 'vitamins',  // 8X Blend (MIC + B vitamins)
  'YPB.268': 'vitamins',  // 4X Blend (MIC)

  // ── Supplies ──
  'YPB.225': 'supplies',  // Reconstitution Water (3ml)
  'YPB.226': 'supplies',  // Reconstitution Water (10ml)
};

// ── API Helpers ───────────────────────────────────────────────────

const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');

async function wcGet(path) {
  const url = `${WC_URL}/wp-json/wc/v3/${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function wcPost(path, body) {
  if (DRY_RUN) { console.log(`  [DRY] POST ${path}:`, JSON.stringify(body).slice(0, 200)); return { id: 0 }; }
  const url = `${WC_URL}/wp-json/wc/v3/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function wcPut(path, body) {
  if (DRY_RUN) { console.log(`  [DRY] PUT ${path}:`, JSON.stringify(body).slice(0, 200)); return {}; }
  const url = `${WC_URL}/wp-json/wc/v3/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== WooCommerce Peptide Category Migration ===\n');

  // 1. Fetch existing categories
  console.log('1. Fetching existing categories...');
  const existingCats = await wcGet('products/categories?per_page=100');
  const catSlugToId = {};
  for (const c of existingCats) {
    catSlugToId[c.slug] = c.id;
  }
  console.log(`   Found ${existingCats.length} existing categories\n`);

  // 2. Create missing categories
  console.log('2. Creating therapeutic categories...');
  for (const cat of CATEGORIES_TO_CREATE) {
    if (catSlugToId[cat.slug]) {
      console.log(`   [EXISTS] ${cat.name} (id=${catSlugToId[cat.slug]})`);
    } else {
      const created = await wcPost('products/categories', { name: cat.name, slug: cat.slug });
      catSlugToId[cat.slug] = created.id;
      console.log(`   [CREATED] ${cat.name} (id=${created.id})`);
    }
  }
  console.log();

  // 3. Fetch all products (published + draft)
  console.log('3. Fetching all products...');
  let allProducts = [];
  for (const status of ['publish', 'draft']) {
    let page = 1;
    while (true) {
      const prods = await wcGet(`products?per_page=100&page=${page}&status=${status}`);
      if (!prods.length) break;
      allProducts.push(...prods);
      page++;
    }
  }
  console.log(`   Found ${allProducts.length} total products\n`);

  // 4. Update product categories
  console.log('4. Updating product categories...');
  let updated = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const product of allProducts) {
    const sku = product.sku;
    if (!sku || !sku.startsWith('YPB.')) {
      // Skip BioBox and non-YPB products
      continue;
    }

    const targetSlug = SKU_TO_CATEGORY[sku];
    if (!targetSlug) {
      console.log(`   [UNMAPPED] ${sku} — ${product.name} (keeping current categories)`);
      unmapped++;
      continue;
    }

    const targetCatId = catSlugToId[targetSlug];
    if (!targetCatId) {
      console.log(`   [ERROR] Category slug '${targetSlug}' not found for ${sku}`);
      continue;
    }

    // Check if product already has this category
    const currentSlugs = product.categories.map(c => c.slug);
    if (currentSlugs.length === 1 && currentSlugs[0] === targetSlug) {
      skipped++;
      continue;
    }

    // Replace ALL categories with just the therapeutic one
    // (removes old tier categories like heal/optimize/thrive)
    await wcPut(`products/${product.id}`, {
      categories: [{ id: targetCatId }],
    });
    console.log(`   [UPDATED] ${sku} — ${product.name}: [${currentSlugs.join(', ')}] → [${targetSlug}]`);
    updated++;

    // Rate limit: WC API allows ~2 req/sec for non-batch
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n   Updated: ${updated}, Skipped (already correct): ${skipped}, Unmapped: ${unmapped}\n`);

  // 5. Create Supply Kit product
  console.log('5. Creating Peptide Supply Kit product...');
  const existingKit = allProducts.find(p => p.sku === 'YPB.290');
  if (existingKit) {
    console.log(`   [EXISTS] Supply Kit already exists (id=${existingKit.id})`);
  } else {
    const suppliesCatId = catSlugToId['supplies'];
    const kit = await wcPost('products', {
      name: 'Peptide Supply Kit',
      sku: 'YPB.290',
      type: 'simple',
      regular_price: '30.00',
      description: 'Everything you need to reconstitute and administer your peptides. Includes mixing syringes, injection needles, and alcohol swabs.',
      short_description: 'Mixing syringes, injection needles, and alcohol swabs for peptide use.',
      status: 'publish',
      catalog_visibility: 'visible',
      categories: suppliesCatId ? [{ id: suppliesCatId }] : [],
      manage_stock: false,
      stock_status: 'instock',
    });
    console.log(`   [CREATED] Peptide Supply Kit (id=${kit.id}, sku=YPB.290, price=$30.00)`);
  }

  console.log('\n=== Migration complete ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

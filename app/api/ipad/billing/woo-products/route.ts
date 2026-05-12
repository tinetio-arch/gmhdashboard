/**
 * iPad — WooCommerce Product Catalog for Ship-to-Patient
 *
 * Fetches live product catalog from ABXTac WooCommerce store.
 * Applies tier-based discounts based on patient's Healthie group:
 *   - NOWMensHealth.Care, NOWPrimary.Care, NOWLongevity.Care → 20% off (optimize tier)
 *   - ABXTAC with provider-verified tier → 10/20/30% (heal/optimize/thrive)
 *   - All others → retail price
 *
 * GET /api/ipad/billing/woo-products?patient_id=xxx&q=bpc
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { THERAPEUTIC_CATEGORIES, BIOBOX_SLUG, resolveTherapeuticCategory } from '@/lib/peptideCategories';
export const dynamic = 'force-dynamic';

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

// 5-minute in-memory cache
let cachedProducts: any[] | null = null;
let cacheExpiry = 0;

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  regular_price: string;
  description: string;
  short_description: string;
  status: string;
  stock_quantity: number | null;
  stock_status: string;
  images: Array<{ id: number; src: string; alt: string }>;
  categories: Array<{ id: number; name: string; slug: string }>;
}

const ADMIN_EMAILS = new Set(['admin@nowoptimal.com', 'admin@granitemountainhealth.com', 'philschafer7@gmail.com']);
const AT_COST_HANDLING_FEE = 10; // $10 flat handling on top of wholesale

async function getWholesalePrices(): Promise<Record<string, number>> {
  try {
    const rows = await query<{ sku: string; wholesale_cost: number }>(
      `SELECT sku, wholesale_cost FROM ypb_available_products WHERE wholesale_cost IS NOT NULL`
    );
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.sku] = Number(r.wholesale_cost) + AT_COST_HANDLING_FEE;
    }
    return map;
  } catch { return {}; }
}

function extractBiomarkers(html: string): string[] {
  const markers: string[] = [];
  const liRegex = /<li>(.*?)<\/li>/gi;
  let match;
  let inBiomarkers = false;
  const lines = html.split('\n');
  for (const line of lines) {
    if (line.includes('Biomarkers Included')) inBiomarkers = true;
    if (inBiomarkers && line.includes('How BioBox Works')) break;
    if (inBiomarkers) {
      while ((match = liRegex.exec(line)) !== null) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text) markers.push(text);
      }
    }
  }
  return markers;
}

/**
 * Fetch all published products from WooCommerce (with 5-min cache)
 */
async function fetchWooProducts(): Promise<WooProduct[]> {
  if (cachedProducts && Date.now() < cacheExpiry) {
    return cachedProducts;
  }

  if (!WC_KEY || !WC_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const allProducts: WooProduct[] = [];
  let page = 1;
  const perPage = 50;

  // Paginate through all products
  while (true) {
    const response = await fetch(
      `${WC_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=publish&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error(`WooCommerce API error: ${response.status}`);
    }

    const products: WooProduct[] = await response.json();
    allProducts.push(...products);

    const totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1');
    if (page >= totalPages || page >= 10) break;
    page++;
  }

  // Cache for 5 minutes
  cachedProducts = allProducts;
  cacheExpiry = Date.now() + 5 * 60 * 1000;

  return allProducts;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'read');
    const isAdmin = ADMIN_EMAILS.has(user.email?.toLowerCase() || '');

    const searchQuery = (request.nextUrl.searchParams.get('q') || '').toLowerCase().trim();
    const rawPatientId = request.nextUrl.searchParams.get('patient_id');

    // Fetch products from WooCommerce
    const allProducts = await fetchWooProducts();

    // New products (YPB.250+) are admin-only until approved for general use
    const products = allProducts.filter(p => {
      if (!p.sku?.startsWith('YPB.')) return true; // non-YPB (e.g. BioBox) always visible
      const skuNum = parseInt(p.sku.split('.')[1] || '0');
      if (skuNum >= 250) return isAdmin;
      return true;
    });

    // Filter by search query if provided
    let filtered = products;
    if (searchQuery) {
      const normalizedQ = searchQuery.replace(/[-.\s]/g, '');
      filtered = products.filter(p => {
        const normalizedName = p.name.toLowerCase().replace(/[-.\s]/g, '');
        const normalizedSku = p.sku.toLowerCase().replace(/[-.\s]/g, '');
        return normalizedName.includes(normalizedQ) || normalizedSku.includes(normalizedQ);
      });
    }

    // Admin defaults to at-cost; other staff default to retail with tier dropdown
    const discount = isAdmin
      ? { rate: 0, reason: 'at_cost' }
      : { rate: 0, reason: 'retail' };

    // Fetch wholesale prices for at-cost tier calculations
    const wholesalePrices = await getWholesalePrices();

    // Map to response format with pricing
    const result = filtered.map(p => {
      const retailPrice = parseFloat(p.price) || 0;

      const categorySlugs = (p.categories || []).map((c: any) => c.slug);
      const isBioBox = categorySlugs.includes(BIOBOX_SLUG) || p.sku?.startsWith('B0');
      const section = isBioBox ? 'BioBox Labs' : 'Peptides';
      const therapeuticCat = isBioBox ? null : resolveTherapeuticCategory(categorySlugs);

      const atCostPrice = wholesalePrices[p.sku] || null;
      const displayPrice = (isAdmin && atCostPrice != null) ? atCostPrice : retailPrice;

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        retail_price: retailPrice,
        price: displayPrice,
        stock_quantity: p.stock_quantity,
        stock_status: p.stock_status,
        image_url: p.images?.[0]?.src || null,
        vial_image_url: (!isBioBox && p.sku) ? `https://abxtac.com/3d-vials/${p.sku}_mockup.png` : null,
        category: therapeuticCat?.label || p.categories?.[0]?.name || 'Uncategorized',
        therapeutic_category: therapeuticCat ? { slug: therapeuticCat.slug, label: therapeuticCat.label, shortLabel: therapeuticCat.shortLabel, color: therapeuticCat.color } : null,
        section,
        description: p.short_description?.replace(/<[^>]*>/g, '').trim() || '',
        biomarkers: isBioBox ? extractBiomarkers(p.description || '') : null,
        at_cost_price: wholesalePrices[p.sku] || null,
      };
    });

    // Build list of categories that have products (for filter tabs)
    const catCounts = new Map<string, number>();
    for (const p of result) {
      const slug = p.therapeutic_category?.slug || (p.section === 'BioBox Labs' ? 'biobox' : null);
      if (slug) catCounts.set(slug, (catCounts.get(slug) || 0) + 1);
    }
    const categories_available = THERAPEUTIC_CATEGORIES
      .filter(c => catCounts.has(c.slug))
      .map(c => ({ slug: c.slug, label: c.shortLabel, color: c.color, count: catCounts.get(c.slug) || 0 }));
    // Add BioBox if present
    if (catCounts.has('biobox')) {
      categories_available.push({ slug: 'biobox', label: 'BioBox', color: '#10b981', count: catCounts.get('biobox') || 0 });
    }

    return NextResponse.json({
      success: true,
      products: result,
      categories_available,
      discount: isAdmin
        ? { rate: 0, reason: 'at_cost', label: 'At Cost (wholesale + $10)' }
        : { rate: 0, reason: 'retail', label: 'Retail' },
      shipping: {
        flat_rate: 20,
        free_threshold: 400,
        label: '$20 flat rate · Free over $400',
      },
      total_products: result.length,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[woo-products] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Failed to fetch products' }, { status: 500 });
  }
}

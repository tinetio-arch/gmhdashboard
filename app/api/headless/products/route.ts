import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { THERAPEUTIC_CATEGORIES, BIOBOX_SLUG, resolveTherapeuticCategory } from '@/lib/peptideCategories';

export const dynamic = 'force-dynamic';

const ADMIN_EMAILS = new Set(['admin@nowoptimal.com', 'admin@granitemountainhealth.com', 'philschafer7@gmail.com']);

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

let cachedProducts: any[] | null = null;
let cacheExpiry = 0;

async function fetchAllWCProducts() {
  if (cachedProducts && Date.now() < cacheExpiry) return cachedProducts;

  const all: any[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${WC_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { cache: 'no-store' }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;
    all.push(...data);
    if (page >= parseInt(res.headers.get('x-wp-totalpages') || '1')) break;
    page++;
  }

  cachedProducts = all;
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return all;
}

function matchesPattern(sku: string, pattern: string): boolean {
  if (pattern === 'YPB.200-249') {
    const m = /^YPB\.(\d+)$/i.exec(sku);
    return m ? parseInt(m[1]) >= 200 && parseInt(m[1]) <= 249 : false;
  }
  if (pattern === 'YPB.250+') {
    const m = /^YPB\.(\d+)$/i.exec(sku);
    return m ? parseInt(m[1]) >= 250 : false;
  }
  if (pattern.includes('%')) {
    const prefix = pattern.replace('%', '');
    return sku.startsWith(prefix);
  }
  return sku === pattern;
}

export async function GET(request: NextRequest) {
  try {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthie_id');

    // Determine if user is admin
    let isAdmin = false;
    if (healthieId) {
      const [patient] = await query<{ email: string | null }>(
        `SELECT email FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
        [healthieId]
      );
      if (patient?.email && ADMIN_EMAILS.has(patient.email.toLowerCase())) {
        isAdmin = true;
      }
    }

    // Load visibility rules (graceful fallback if table doesn't exist)
    let rules: Array<{ sku_pattern: string; visible_to: string }> = [];
    try {
      rules = await query<{ sku_pattern: string; visible_to: string }>(
        `SELECT sku_pattern, visible_to FROM app_product_visibility ORDER BY id`
      );
    } catch { /* table may not exist yet — show all products */ }

    // Fetch all WC products
    const allProducts = await fetchAllWCProducts();

    // Sort rules: exact SKU matches first, then patterns (so YPB.290='all' beats YPB.250+='admin')
    const sortedRules = [...rules].sort((a, b) => {
      const aExact = !a.sku_pattern.includes('%') && !a.sku_pattern.includes('-') && !a.sku_pattern.includes('+');
      const bExact = !b.sku_pattern.includes('%') && !b.sku_pattern.includes('-') && !b.sku_pattern.includes('+');
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return 0;
    });

    // Filter based on visibility rules
    const filtered = allProducts.filter(p => {
      if (!p.sku || !p.price || parseFloat(p.price) <= 0) return false;

      for (const rule of sortedRules) {
        if (matchesPattern(p.sku, rule.sku_pattern)) {
          if (rule.visible_to === 'none') return false;
          if (rule.visible_to === 'admin') return isAdmin;
          return true; // 'all'
        }
      }
      // No rule matched — visible to all by default
      return true;
    });

    // Extract biomarkers for BioBox products
    const extractBiomarkers = (html: string): string[] => {
      const markers: string[] = [];
      const liRegex = /<li>(.*?)<\/li>/gi;
      let inBio = false;
      for (const line of html.split('\n')) {
        if (line.includes('Biomarkers Included')) inBio = true;
        if (inBio && line.includes('How BioBox Works')) break;
        if (inBio) {
          let match;
          while ((match = liRegex.exec(line)) !== null) {
            const text = match[1].replace(/<[^>]*>/g, '').trim();
            if (text) markers.push(text);
          }
        }
      }
      return markers;
    };

    const products = filtered.map(p => {
      const categorySlugs = (p.categories || []).map((c: any) => c.slug);
      const isBioBox = categorySlugs.includes(BIOBOX_SLUG) || p.sku?.startsWith('B0');
      const therapeuticCat = isBioBox ? null : resolveTherapeuticCategory(categorySlugs);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        price: p.price,
        regular_price: p.regular_price,
        description: p.description,
        short_description: p.short_description,
        status: p.status,
        stock_quantity: p.stock_quantity,
        images: (p.images || []).map((img: any) => ({ id: img.id, src: img.src, alt: img.alt })),
        categories: (p.categories || []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
        section: isBioBox ? 'BioBox Labs' : 'Peptides',
        therapeutic_category: therapeuticCat ? { slug: therapeuticCat.slug, label: therapeuticCat.label, shortLabel: therapeuticCat.shortLabel, color: therapeuticCat.color, requiresApproval: therapeuticCat.requiresApproval } : null,
        biomarkers: isBioBox ? extractBiomarkers(p.description || '') : null,
      };
    });

    // Build list of categories that have products (for client-side filter/grouping)
    const catCounts = new Map<string, number>();
    for (const p of products) {
      const slug = p.therapeutic_category?.slug || (p.section === 'BioBox Labs' ? 'biobox' : null);
      if (slug) catCounts.set(slug, (catCounts.get(slug) || 0) + 1);
    }
    const categories_available = THERAPEUTIC_CATEGORIES
      .filter(c => catCounts.has(c.slug))
      .map(c => ({ slug: c.slug, label: c.shortLabel, color: c.color, count: catCounts.get(c.slug) || 0, requiresApproval: c.requiresApproval }));
    if (catCounts.has('biobox')) {
      categories_available.push({ slug: 'biobox', label: 'BioBox', color: '#10b981', count: catCounts.get('biobox') || 0, requiresApproval: false });
    }

    return NextResponse.json({
      products,
      categories_available,
      is_admin: isAdmin,
      total: products.length,
    });
  } catch (error: any) {
    console.error('[headless/products] Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

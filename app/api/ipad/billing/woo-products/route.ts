/**
 * iPad — WooCommerce Product Catalog for Ship-to-Patient
 *
 * Fetches live product catalog from ABXTac WooCommerce store.
 * Applies tier-based discounts based on patient's Healthie group:
 *   - NOWMensHealth.Care, NOWPrimary.Care, NOWLongevity.Care → 20% off
 *   - ABXTAC with package → tier-based discount (20/30/40%)
 *   - All others → retail price
 *
 * GET /api/ipad/billing/woo-products?patient_id=xxx&q=bpc
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

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

/**
 * Get patient's discount rate based on their client type
 *
 * Discount rules:
 *   - NOWMensHealth.Care, NOWPrimary.Care, NOWLongevity.Care → 20% off
 *   - ABXTAC → 20% off (TODO: tier-based when patient-to-package schema supports it)
 *   - All others → retail price
 */
async function getPatientDiscount(patientId: string): Promise<{ rate: number; reason: string }> {
  const [patient] = await query<{
    client_type_key: string | null;
  }>('SELECT client_type_key FROM patients WHERE patient_id = $1', [patientId]);

  if (!patient) return { rate: 0, reason: 'retail' };

  const clientType = patient.client_type_key?.toLowerCase() || '';

  // NOW brand members + ABXTAC get 20% off
  if (['nowmenshealth', 'nowprimarycare', 'nowlongevity', 'abxtac'].includes(clientType)) {
    return { rate: 0.20, reason: 'member_discount' };
  }

  return { rate: 0, reason: 'retail' };
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
      `${WC_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=publish`,
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64'),
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      throw new Error(`WooCommerce API error: ${response.status}`);
    }

    const products: WooProduct[] = await response.json();
    allProducts.push(...products);

    const totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1');
    if (page >= totalPages) break;
    page++;
  }

  // Cache for 5 minutes
  cachedProducts = allProducts;
  cacheExpiry = Date.now() + 5 * 60 * 1000;

  return allProducts;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const searchQuery = (request.nextUrl.searchParams.get('q') || '').toLowerCase().trim();
    const rawPatientId = request.nextUrl.searchParams.get('patient_id');

    // Fetch products from WooCommerce
    const products = await fetchWooProducts();

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

    // Get patient discount if patient_id provided
    let discount = { rate: 0, reason: 'retail' };
    if (rawPatientId) {
      const resolvedId = await resolvePatientId(rawPatientId);
      if (resolvedId) {
        discount = await getPatientDiscount(resolvedId);
      }
    }

    // Map to response format with pricing
    const result = filtered.map(p => {
      const retailPrice = parseFloat(p.price) || 0;
      const discountedPrice = discount.rate > 0
        ? Math.round(retailPrice * (1 - discount.rate) * 100) / 100
        : retailPrice;

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        retail_price: retailPrice,
        price: discountedPrice,
        discount_rate: discount.rate,
        discount_reason: discount.reason,
        stock_quantity: p.stock_quantity,
        stock_status: p.stock_status,
        image_url: p.images?.[0]?.src || null,
        // Use 3D vial mockup if available
        vial_image_url: p.sku ? `https://abxtac.com/3d-vials/${p.sku}_mockup.png` : null,
        category: p.categories?.[0]?.name || 'Uncategorized',
        description: p.short_description?.replace(/<[^>]*>/g, '').trim() || '',
      };
    });

    return NextResponse.json({
      success: true,
      products: result,
      discount: {
        rate: discount.rate,
        reason: discount.reason,
        label: discount.rate > 0 ? `${Math.round(discount.rate * 100)}% off` : 'Retail',
      },
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

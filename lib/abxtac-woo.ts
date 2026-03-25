/**
 * ABXTac WooCommerce Integration
 *
 * This module handles the integration between ABXTac's WooCommerce store
 * and the GMH Dashboard for order processing, fulfillment, and tracking.
 *
 * CRITICAL: This follows YourPeptideBrand's exact integration requirements:
 * - SKU Format: YPB.### (e.g., YPB.213 for BPC-157 10mg)
 * - Weight: 1 oz standard for all products
 * - Shipping: USPS only (First-Class, Priority, Priority Express)
 * - Bundles: Must be pre-mapped with YPB before creation
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

// Product SKU mapping as per YourPeptideBrand catalog
export const YPB_PRODUCT_CATALOG = {
  'BPC-157-5MG': 'YPB.212',
  'BPC-157-10MG': 'YPB.213',
  'GLP-2-TZ-10MG': 'YPB.203',
  'GLP-2-TZ-20MG': 'YPB.204',
  'GLP-2-TZ-30MG': 'YPB.205',
  'TB-500-5MG': 'YPB.214',
  'TB-500-10MG': 'YPB.215',
  'CJC-1295-2MG': 'YPB.216',
  'CJC-1295-5MG': 'YPB.217',
  'AOD-9604-5MG': 'YPB.218',
  'SEMAX-10MG': 'YPB.219',
  'SELANK-10MG': 'YPB.220',
} as const;

// Shipping methods allowed by YPB
export const ALLOWED_SHIPPING_METHODS = [
  'usps_first_class',
  'usps_priority',
  'usps_priority_express'
] as const;

export interface WooCommerceConfig {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  wpAPI: boolean;
  version: string;
}

export interface WooOrder {
  id: number;
  parent_id: number;
  status: 'pending' | 'processing' | 'on-hold' | 'completed' | 'cancelled' | 'refunded' | 'failed';
  currency: string;
  date_created: string;
  date_modified: string;
  discount_total: string;
  shipping_total: string;
  total: string;
  total_tax: string;
  customer_id: number;
  billing: {
    first_name: string;
    last_name: string;
    company?: string;
    address_1: string;
    address_2?: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
    email: string;
    phone: string;
  };
  shipping: {
    first_name: string;
    last_name: string;
    company?: string;
    address_1: string;
    address_2?: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
  };
  line_items: Array<{
    id: number;
    name: string;
    product_id: number;
    variation_id: number;
    quantity: number;
    tax_class: string;
    subtotal: string;
    total: string;
    sku: string;
    price: number;
    meta_data: Array<{
      key: string;
      value: string;
    }>;
  }>;
  shipping_lines: Array<{
    id: number;
    method_title: string;
    method_id: string;
    total: string;
  }>;
  meta_data: Array<{
    id: number;
    key: string;
    value: any;
  }>;
}

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  type: 'simple' | 'grouped' | 'external' | 'variable';
  status: 'draft' | 'pending' | 'private' | 'publish';
  sku: string;
  price: string;
  regular_price: string;
  sale_price?: string;
  stock_quantity?: number;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  weight: string;
  dimensions: {
    length: string;
    width: string;
    height: string;
  };
  categories: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
  meta_data: Array<{
    id: number;
    key: string;
    value: any;
  }>;
}

export interface WooSubscription {
  id: number;
  parent_id: number;
  status: 'active' | 'on-hold' | 'cancelled' | 'expired' | 'pending-cancel';
  billing_period: 'day' | 'week' | 'month' | 'year';
  billing_interval: number;
  start_date: string;
  next_payment_date: string;
  customer_id: number;
  line_items: Array<{
    product_id: number;
    quantity: number;
    total: string;
  }>;
}

export class ABXTacWooCommerce {
  private apiUrl: string;
  private client: AxiosInstance;
  private consumerKey: string;
  private consumerSecret: string;

  constructor(config: WooCommerceConfig) {
    this.apiUrl = `${config.url}/wp-json/wc/v3`;
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;

    // Create axios instance with WooCommerce authentication
    this.client = axios.create({
      baseURL: this.apiUrl,
      auth: {
        username: this.consumerKey,
        password: this.consumerSecret
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Validate webhook signature from WooCommerce
   */
  validateWebhookSignature(body: string, signature: string, secret: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    return signature === expectedSignature;
  }

  /**
   * Validate order SKUs match YPB format
   */
  validateOrderSKUs(order: WooOrder): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const item of order.line_items) {
      if (!item.sku) {
        errors.push(`Product "${item.name}" missing SKU`);
        continue;
      }

      // Check if SKU follows YPB.### format
      const skuPattern = /^YPB\.\d{3}$/;
      if (!skuPattern.test(item.sku)) {
        errors.push(`Invalid SKU format for "${item.name}": ${item.sku} (must be YPB.###)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate shipping method is USPS only
   */
  validateShipping(order: WooOrder): { valid: boolean; error?: string } {
    if (order.shipping_lines.length === 0) {
      return { valid: false, error: 'No shipping method selected' };
    }

    const shippingMethod = order.shipping_lines[0].method_id.toLowerCase();

    // Check if shipping method contains USPS
    if (!shippingMethod.includes('usps')) {
      return {
        valid: false,
        error: `Invalid shipping method: ${order.shipping_lines[0].method_title}. Only USPS methods allowed.`
      };
    }

    return { valid: true };
  }

  /**
   * Get orders with specific status
   */
  async getOrders(status?: string, perPage: number = 100): Promise<WooOrder[]> {
    try {
      const params: any = { per_page: perPage };
      if (status) params.status = status;

      const response = await this.client.get('/orders', { params });
      return response.data;
    } catch (error: any) {
      console.error('Error fetching orders:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get processing orders ready for fulfillment
   */
  async getProcessingOrders(): Promise<WooOrder[]> {
    const orders = await this.getOrders('processing');

    // Filter orders that pass validation
    const validOrders = orders.filter(order => {
      const skuValidation = this.validateOrderSKUs(order);
      const shippingValidation = this.validateShipping(order);

      if (!skuValidation.valid) {
        console.error(`Order #${order.id} SKU validation failed:`, skuValidation.errors);
        return false;
      }

      if (!shippingValidation.valid) {
        console.error(`Order #${order.id} shipping validation failed:`, shippingValidation.error);
        return false;
      }

      return true;
    });

    return validOrders;
  }

  /**
   * Get single order by ID
   */
  async getOrder(orderId: number): Promise<WooOrder> {
    try {
      const response = await this.client.get(`/orders/${orderId}`);
      return response.data;
    } catch (error: any) {
      console.error(`Error fetching order #${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId: number, status: WooOrder['status'], note?: string): Promise<WooOrder> {
    try {
      const data: any = { status };
      if (note) {
        data.customer_note = note;
      }

      const response = await this.client.put(`/orders/${orderId}`, data);
      return response.data;
    } catch (error: any) {
      console.error(`Error updating order #${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Add tracking information to order
   * Note: This requires a tracking plugin like WooCommerce Shipment Tracking
   */
  async addTrackingInfo(
    orderId: number,
    trackingNumber: string,
    carrier: string = 'USPS'
  ): Promise<WooOrder> {
    try {
      // Add tracking as order meta data
      const metaData = [
        { key: '_tracking_number', value: trackingNumber },
        { key: '_tracking_carrier', value: carrier },
        { key: '_date_shipped', value: new Date().toISOString() },
        { key: '_tracking_url', value: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}` }
      ];

      const response = await this.client.put(`/orders/${orderId}`, {
        meta_data: metaData,
        status: 'completed'
      });

      return response.data;
    } catch (error: any) {
      console.error(`Error adding tracking to order #${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get products
   */
  async getProducts(perPage: number = 100): Promise<WooProduct[]> {
    try {
      const response = await this.client.get('/products', {
        params: { per_page: perPage }
      });
      return response.data;
    } catch (error: any) {
      console.error('Error fetching products:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update product stock
   */
  async updateProductStock(productId: number, quantity: number): Promise<WooProduct> {
    try {
      const response = await this.client.put(`/products/${productId}`, {
        stock_quantity: quantity,
        stock_status: quantity > 0 ? 'instock' : 'outofstock'
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error updating product #${productId} stock:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get customer by email
   */
  async getCustomerByEmail(email: string): Promise<any> {
    try {
      const response = await this.client.get('/customers', {
        params: { email, per_page: 1 }
      });
      return response.data[0] || null;
    } catch (error: any) {
      console.error(`Error fetching customer ${email}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Verify customer is 18+ (stored in customer meta)
   */
  async verifyCustomerAge(customerId: number): Promise<boolean> {
    try {
      const response = await this.client.get(`/customers/${customerId}`);
      const customer = response.data;

      // Check for age verification in meta data
      const ageVerified = customer.meta_data?.find(
        (meta: any) => meta.key === '_age_verified'
      );

      return ageVerified?.value === 'yes' || false;
    } catch (error: any) {
      console.error(`Error verifying customer #${customerId} age:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Get subscriptions
   */
  async getSubscriptions(customerId?: number): Promise<WooSubscription[]> {
    try {
      const endpoint = customerId
        ? `/subscriptions?customer=${customerId}`
        : '/subscriptions';

      const response = await this.client.get(endpoint);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching subscriptions:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Pause subscription
   */
  async pauseSubscription(subscriptionId: number): Promise<WooSubscription> {
    try {
      const response = await this.client.put(`/subscriptions/${subscriptionId}`, {
        status: 'on-hold'
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error pausing subscription #${subscriptionId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Resume subscription
   */
  async resumeSubscription(subscriptionId: number): Promise<WooSubscription> {
    try {
      const response = await this.client.put(`/subscriptions/${subscriptionId}`, {
        status: 'active'
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error resuming subscription #${subscriptionId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create bundle mapping request for YPB
   * This generates the email content to send to integrations@yourpeptidebrand.com
   */
  generateBundleMappingRequest(
    bundleName: string,
    products: Array<{ sku: string; name: string; quantity: number }>
  ): string {
    const productList = products.map(p =>
      `- ${p.name} - ${p.sku} - Qty: ${p.quantity}`
    ).join('\n');

    return `Subject: Bundle Mapping Request - ABXTac

Please map the following bundle:
Bundle Name: ${bundleName}
Products:
${productList}

Thank you,
ABXTac Team`;
  }

  /**
   * Validate bundle SKU format from YPB
   * Bundle SKUs should be comma-separated list of individual SKUs
   */
  validateBundleSKU(bundleSKU: string): boolean {
    const skus = bundleSKU.split(',').map(s => s.trim());
    const skuPattern = /^YPB\.\d{3}$/;

    return skus.every(sku => skuPattern.test(sku));
  }

  /**
   * Get order fulfillment summary for dashboard
   */
  async getOrderFulfillmentSummary(): Promise<{
    processing: number;
    shipped: number;
    delivered: number;
    issues: Array<{ orderId: number; issue: string }>;
  }> {
    try {
      const [processing, completed] = await Promise.all([
        this.getOrders('processing'),
        this.getOrders('completed', 50)
      ]);

      const issues: Array<{ orderId: number; issue: string }> = [];

      // Check for SKU issues
      for (const order of processing) {
        const skuValidation = this.validateOrderSKUs(order);
        if (!skuValidation.valid) {
          issues.push({
            orderId: order.id,
            issue: skuValidation.errors.join(', ')
          });
        }

        const shippingValidation = this.validateShipping(order);
        if (!shippingValidation.valid) {
          issues.push({
            orderId: order.id,
            issue: shippingValidation.error!
          });
        }
      }

      // Count shipped (completed with tracking)
      const shipped = completed.filter(order =>
        order.meta_data?.some(meta => meta.key === '_tracking_number')
      );

      return {
        processing: processing.length,
        shipped: shipped.length,
        delivered: 0, // Would need to check USPS tracking API
        issues
      };
    } catch (error: any) {
      console.error('Error getting fulfillment summary:', error.message);
      throw error;
    }
  }
}

// Export singleton instance if environment variables are set
let abxtacClient: ABXTacWooCommerce | null = null;

export function getABXTacClient(): ABXTacWooCommerce {
  if (!abxtacClient) {
    const config: WooCommerceConfig = {
      url: process.env.ABXTAC_WOO_URL || 'https://abxtac.com',
      consumerKey: process.env.ABXTAC_CONSUMER_KEY || '',
      consumerSecret: process.env.ABXTAC_CONSUMER_SECRET || '',
      wpAPI: true,
      version: 'wc/v3'
    };

    if (!config.consumerKey || !config.consumerSecret) {
      throw new Error('ABXTac WooCommerce credentials not configured. Set ABXTAC_CONSUMER_KEY and ABXTAC_CONSUMER_SECRET in .env');
    }

    abxtacClient = new ABXTacWooCommerce(config);
  }

  return abxtacClient;
}
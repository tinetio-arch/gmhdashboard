/**
 * McKesson MMS API Client — Supply Ordering Integration
 *
 * Connects to McKesson MMS for office supply availability checks and ordering.
 * Currently targets SANDBOX environment only.
 *
 * Auth: OAuth2 client_credentials → JWT Bearer token (5-minute TTL).
 * Token endpoint: https://api-gateway.mms.mckesson.com/oauth2/token
 * Docs: https://gateway.mms.mckesson.com/documentation
 */

import { query } from './db';

// ─── Config ───

const MCKESSON_BASE_URL = process.env.MCKESSON_BASE_URL || 'https://api-gateway.mms.mckesson.com/sandbox';
const MCKESSON_TOKEN_URL = process.env.MCKESSON_TOKEN_URL || 'https://api-gateway.mms.mckesson.com/oauth2/token';
const MCKESSON_CLIENT_ID = process.env.MCKESSON_CLIENT_ID || '';
const MCKESSON_CLIENT_SECRET = process.env.MCKESSON_CLIENT_SECRET || '';
const MCKESSON_ENVIRONMENT = process.env.MCKESSON_ENVIRONMENT || 'sandbox';

// ─── OAuth2 Token Cache ───

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 30s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  if (!MCKESSON_CLIENT_ID || !MCKESSON_CLIENT_SECRET) {
    throw new Error('[MCKESSON] Missing MCKESSON_CLIENT_ID or MCKESSON_CLIENT_SECRET in env');
  }

  console.log('[MCKESSON] Fetching new OAuth2 access token');

  const basicAuth = Buffer.from(`${MCKESSON_CLIENT_ID}:${MCKESSON_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(MCKESSON_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[MCKESSON] OAuth2 token request failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as { access_token: string; token_type: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);

  console.log(`[MCKESSON] Token acquired, expires in ${data.expires_in}s`);
  return cachedToken;
}

// ─── Types ───

export interface McKessonItem {
  itemId: string;
  quantity: number;
  unitOfMeasure: string;
}

export interface McKessonShipTo {
  accountId: string;
}

export interface McKessonOrderRequest {
  patientId?: string;
  purchaseOrderNumber?: string;
  shipTo: McKessonShipTo;
  items: McKessonItem[];
}

export interface McKessonValidationMessage {
  lineNumber: number;
  itemId: string;
  message: string;
  type: string;
  purchasable: boolean;
  tags: string[];
  lineLevel: boolean;
}

export interface McKessonOrderResponse {
  accepted: boolean;
  orderId: string;
  message: string;
  validation: {
    valid: boolean;
    messages: McKessonValidationMessage[];
  };
}

export interface McKessonOrderStatus {
  orderId: string;
  status: string;
  submittedDate: string;
}

export interface McKessonOrderLine {
  price: number;
  lineNumber: string;
  itemId: string;
  unitOfMeasure: string;
  description: string;
  manufacturerId: string;
  productTotal: string;
  freightTotal: string;
  taxTotal: number;
  netTotal: number;
  quantityOrdered: string;
  quantityOpen: number;
  quantityBackorder: number;
  quantityShipped: number;
  quantityCancelled: number;
}

export interface McKessonOrderDetails {
  orderId: string;
  purchaseOrderNumber: string;
  submittedDate: string;
  orderStatus: string;
  subTotal: number;
  productTotal: number;
  numberOfLinesOpen: number;
  linesBackOrdered: number;
  linesShipped: number;
  linesCancelled: number;
  linesTotal: number;
  lines: McKessonOrderLine[];
  account: McKessonAddress;
  shipTo: McKessonAddress;
  trackingLines: McKessonTrackingLine[];
}

export interface McKessonAddress {
  id: number;
  name: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  state: string;
  postalCode: string;
  type: string;
}

export interface McKessonTrackingLine {
  accountId: string;
  orderId: string;
  trackingId: string;
  line: string;
  unitOfMeasure: string;
  quantity: string;
  carrier: string;
}

export interface McKessonAvailabilityItem {
  itemId: string;
  stock: { name: string; description: string };
  status: { reason: string; detail: string; purchasable: boolean };
  formulary: { description: string };
  replacement: {
    type: string;
    replacementId: string;
    source: string;
    allowBypass: boolean;
    reason: string;
  } | null;
  returnable: boolean;
  storageRequirement: string;
  unitOfMeasures: Array<{
    type: string;
    unitOfMeasure: string;
    eaches: number;
    weight: { weight: number; units: string };
    atomicUnits: string;
    lastPurchaseDate: string;
  }>;
}

export interface McKessonTrackingDetails {
  orderId: string;
  trackingDetails: Array<{
    trackingId: string;
    carrierName: string;
  }>;
}

// ─── API Client ───

async function mckFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = `${MCKESSON_BASE_URL}${path}`;
  const method = options.method || 'GET';

  console.log(`[MCKESSON] ${method} ${path}`);

  const token = await getAccessToken();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const fetchOpts: RequestInit = { method, headers };
  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOpts);

  // If 401, token may have expired — retry once with fresh token
  if (res.status === 401) {
    console.log('[MCKESSON] Token expired, refreshing...');
    cachedToken = null;
    const freshToken = await getAccessToken();
    headers['Authorization'] = `Bearer ${freshToken}`;
    const retryRes = await fetch(url, { ...fetchOpts, headers });
    if (!retryRes.ok) {
      const errorText = await retryRes.text().catch(() => 'No response body');
      console.error(`[MCKESSON] ${method} ${path} → ${retryRes.status} (retry): ${errorText}`);
      throw new Error(`McKesson API error ${retryRes.status}: ${errorText}`);
    }
    const text = await retryRes.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'No response body');
    console.error(`[MCKESSON] ${method} ${path} → ${res.status}: ${errorText}`);
    throw new Error(`McKesson API error ${res.status}: ${errorText}`);
  }

  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ─── Product Availability ───

export async function checkItemAvailability(
  accountId: string,
  items: Array<{ itemId: number; quantity: number; unitOfMeasure?: string }>,
  shipToAccountId?: string
): Promise<McKessonAvailabilityItem[]> {
  const body: any = {
    items: items.map(i => ({
      itemId: i.itemId,
      quantity: i.quantity,
      unitOfMeasure: i.unitOfMeasure || 'EA',
    })),
  };
  if (shipToAccountId) {
    body.shipto = { accountId: parseInt(shipToAccountId) };
  }

  return mckFetch<McKessonAvailabilityItem[]>(
    `/v1/products/availability/${accountId}`,
    { method: 'POST', body }
  );
}

// ─── Orders ───

export async function submitOrder(
  accountId: string,
  order: McKessonOrderRequest
): Promise<McKessonOrderResponse> {
  if (MCKESSON_ENVIRONMENT !== 'sandbox') {
    // Safety: block production orders until explicitly enabled
    throw new Error('[MCKESSON] Production orders are disabled. Set MCKESSON_ENVIRONMENT=production to enable.');
  }

  return mckFetch<McKessonOrderResponse>(
    `/v1/orders/${accountId}`,
    { method: 'POST', body: order }
  );
}

export async function getOrderDetails(
  accountId: string,
  orderId: string
): Promise<McKessonOrderDetails> {
  return mckFetch<McKessonOrderDetails>(
    `/v1/orders/${accountId}/${orderId}`
  );
}

export async function getOrderStatus(
  accountId: string,
  orderId: string
): Promise<McKessonOrderStatus> {
  return mckFetch<McKessonOrderStatus>(
    `/v1/orders/${accountId}/${orderId}/status`
  );
}

export async function getOrderTracking(
  accountId: string,
  orderId: string
): Promise<McKessonTrackingDetails> {
  return mckFetch<McKessonTrackingDetails>(
    `/v1/orders/tracking/${accountId}/${orderId}`
  );
}

// ─── Database Operations ───

export interface McKessonOrderRow {
  id: number;
  mckesson_order_id: string | null;
  account_id: string;
  po_number: string | null;
  status: string;
  order_data: any;
  response_data: any;
  tracking_data: any;
  total_items: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Place a McKesson order and record it in our database.
 * Returns the DB record + McKesson response.
 */
export async function placeAndRecordOrder(
  accountId: string,
  items: Array<{ supplyItemId?: number; mckItemId: string; quantity: number; unitOfMeasure?: string }>,
  shipToAccountId: string,
  poNumber?: string,
  createdBy?: string
): Promise<{ dbOrder: McKessonOrderRow; mckResponse: McKessonOrderResponse }> {
  const orderRequest: McKessonOrderRequest = {
    purchaseOrderNumber: poNumber,
    shipTo: { accountId: shipToAccountId },
    items: items.map(i => ({
      itemId: i.mckItemId,
      quantity: i.quantity,
      unitOfMeasure: i.unitOfMeasure || 'EA',
    })),
  };

  // Submit to McKesson
  const mckResponse = await submitOrder(accountId, orderRequest);

  // Record in our database
  const rows = await query<McKessonOrderRow>(
    `INSERT INTO mckesson_orders
     (mckesson_order_id, account_id, po_number, status, order_data, response_data, total_items, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      mckResponse.orderId || null,
      accountId,
      poNumber || null,
      mckResponse.accepted ? 'accepted' : 'error',
      JSON.stringify(orderRequest),
      JSON.stringify(mckResponse),
      items.length,
      createdBy || null,
    ]
  );

  // Record individual line items
  for (const item of items) {
    await query(
      `INSERT INTO mckesson_order_items (mckesson_order_id, supply_item_id, mckesson_item_id, quantity, unit_of_measure)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, item.supplyItemId || null, item.mckItemId, item.quantity, item.unitOfMeasure || 'EA']
    );
  }

  return { dbOrder: rows[0], mckResponse };
}

/**
 * Fetch all McKesson orders from our database, most recent first.
 */
export async function fetchMcKessonOrders(limit: number = 50): Promise<McKessonOrderRow[]> {
  return query<McKessonOrderRow>(
    `SELECT * FROM mckesson_orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
}

/**
 * Fetch a single order by our internal ID.
 */
export async function fetchMcKessonOrderById(id: number): Promise<McKessonOrderRow | null> {
  const rows = await query<McKessonOrderRow>(
    `SELECT * FROM mckesson_orders WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Refresh order status from McKesson and update our database.
 */
export async function refreshOrderStatus(
  dbOrderId: number,
  accountId: string
): Promise<McKessonOrderRow | null> {
  const order = await fetchMcKessonOrderById(dbOrderId);
  if (!order || !order.mckesson_order_id) return null;

  try {
    const details = await getOrderDetails(accountId, order.mckesson_order_id);
    const tracking = await getOrderTracking(accountId, order.mckesson_order_id).catch(() => null);

    const rows = await query<McKessonOrderRow>(
      `UPDATE mckesson_orders
       SET status = $1, response_data = $2, tracking_data = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        details.orderStatus || order.status,
        JSON.stringify(details),
        tracking ? JSON.stringify(tracking) : order.tracking_data,
        dbOrderId,
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.error(`[MCKESSON] Failed to refresh order ${dbOrderId}:`, err);
    return order;
  }
}

/**
 * Get supply items that have a McKesson item ID mapped.
 */
export async function fetchMappedSupplyItems(): Promise<Array<{
  id: number;
  name: string;
  category: string;
  unit: string;
  par_level: number | null;
  mckesson_item_id: string;
  mckesson_unit_of_measure: string;
  qty_on_hand: number;
}>> {
  return query(
    `SELECT si.id, si.name, si.category, si.unit, si.par_level,
            si.mckesson_item_id, si.mckesson_unit_of_measure,
            COALESCE(sc.qty_on_hand, 0) AS qty_on_hand
     FROM supply_items si
     LEFT JOIN supply_counts sc ON sc.item_id = si.id AND sc.location = 'mens_health'
     WHERE si.active = true AND si.mckesson_item_id IS NOT NULL
     ORDER BY si.category, si.name`
  );
}

/**
 * Map a supply item to a McKesson item ID.
 */
export async function mapSupplyToMcKesson(
  supplyItemId: number,
  mckItemId: string,
  unitOfMeasure: string = 'EA'
): Promise<void> {
  await query(
    `UPDATE supply_items SET mckesson_item_id = $1, mckesson_unit_of_measure = $2, updated_at = NOW() WHERE id = $3`,
    [mckItemId, unitOfMeasure, supplyItemId]
  );
}

// ─── Utility ───

export function isMcKessonConfigured(): boolean {
  return !!(MCKESSON_CLIENT_ID && MCKESSON_CLIENT_SECRET && MCKESSON_BASE_URL);
}

export function getMcKessonEnvironment(): string {
  return MCKESSON_ENVIRONMENT;
}

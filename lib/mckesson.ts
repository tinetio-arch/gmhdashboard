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
// Bill-To account — used as the path /v1/.../{accountId}. API user must be
// subscribed to this account.
const MCKESSON_ACCOUNT_ID = process.env.MCKESSON_ACCOUNT_ID || '';
// Ship-To account — used in the shipTo.accountId body field. Falls back to
// the bill-to when not set (single-account setups).
const MCKESSON_SHIP_TO_ACCOUNT_ID = process.env.MCKESSON_SHIP_TO_ACCOUNT_ID || MCKESSON_ACCOUNT_ID;
// Scope MUST match credential type. Two gotchas verified against the live
// gateway 2026-05-06:
//   1. McKesson's PDF writes prod scope comma-separated; the gateway actually
//      requires OAuth2 RFC 6749 space-separated form.
//   2. The PDF lists "invoice,order,patient" for production but omits "product".
//      Without "product" in the scope, /v1/products/availability/* returns 403.
//   sandbox creds  → "sandbox"
//   production creds → "invoice order patient product"
const MCKESSON_SCOPE = process.env.MCKESSON_SCOPE
  || (MCKESSON_ENVIRONMENT === 'production' ? 'invoice order patient product' : 'sandbox');
const MCKESSON_ALLOW_PRODUCTION_ORDERS = process.env.MCKESSON_ALLOW_PRODUCTION_ORDERS === 'true';

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

  console.log(`[MCKESSON] Fetching new OAuth2 access token (scope=${MCKESSON_SCOPE})`);

  const basicAuth = Buffer.from(`${MCKESSON_CLIENT_ID}:${MCKESSON_CLIENT_SECRET}`).toString('base64');

  const formBody = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: MCKESSON_SCOPE,
  }).toString();

  const res = await fetch(MCKESSON_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody,
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
    pills?: Array<{ description: string }>;
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

// Date-range query shared by fulfillment, tracking, and invoices.
export interface McKessonDateRangeQuery {
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  shipToId?: number;
  pageOffset?: number;      // min 0
  pageSize?: number;        // 1..100
}

export interface McKessonOrderStatusPage {
  orderStatusList: McKessonOrderStatus[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  totalCount: number;
}

export interface McKessonOrderTrackingPage {
  trackingResponse: McKessonTrackingDetails[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  totalElements: number;
}

// ─── Invoice types (OpenAPI: Invoice Endpoint) ───

export interface McKessonInvoiceIdsPage {
  invoiceId: string[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  totalElements: number;
}

export interface McKessonInvoiceLine {
  invoiceId: number;
  invoiceDate: string;
  manufacturer: string;
  price: number;
  freight: number;
  lineNumber: number;
  productId: string;
  productDescription: string;
  unitOfMeasure: string;
  lineStatus: string;
  quantityOrdered: number;
  quantityShipped: number;
  taxTotal: number;
  subTotal: number;
  netTotal: number;
  discountTotal: number;
}

export interface McKessonInvoice {
  accountId: number;
  orderId: string;
  invoiceId: number;
  invoiceDate: string;
  invoiceDueDate: string;
  orderDate: string;
  status: string;
  account: McKessonAddress;
  shipTo: McKessonAddress;
  lines: McKessonInvoiceLine[];
  purchaseOrderNumber: string;
  taxTotal: number;
  netTotal: number;
  subTotal: number;
  discountTotal: number;
}

// ─── Patient types (OpenAPI: Patient Endpoint) ───

export type McKessonAddressType = 'HOME' | 'LEGAL_ADDRESS' | 'OFFICE' | 'UNKNOWN_TYPE' | 'SHIP_TO';

export interface McKessonAddressRequest {
  addressLine1: string;     // max 50
  city: string;             // max 25
  state: string;
  postalCode: string;       // max 12
  type?: McKessonAddressType;
}

export interface McKessonBasePatientRequest {
  accountId: number;
  firstName: string;        // 1..25
  lastName: string;         // 1..25
  address: McKessonAddressRequest;
}

export interface McKessonAddPatientRequest extends McKessonBasePatientRequest {
  patientId: string;
}

export interface McKessonAddressResponse {
  externalShipToId: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  type: string;
}

export interface McKessonPatientResponse {
  accountId: string;
  patientId: string;
  firstName: string;
  lastName: string;
  address: McKessonAddressResponse;
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

/**
 * POST /v1/products/availability/{accountId}
 *
 * Notes verified empirically against the live gateway 2026-05-06:
 *  - `shipto` is REQUIRED in practice — sending without it returns 500.
 *    The OpenAPI spec marks it optional, but the gateway disagrees.
 *  - `shipto.accountId` is NOT validated against the path accountId; the
 *    gateway accepts any int. Keep them aligned anyway.
 *  - Items array must contain at least one item with a non-null itemId.
 *  - Item IDs are integers (typically 6–7 digits in the 800000+ range).
 *    Unknown IDs return `itemId: "0"` with `status.reason: "Invalid Item"`.
 *    Known-but-discontinued IDs echo the input id and populate unitOfMeasures.
 */
export async function checkItemAvailability(
  accountId: string,
  items: Array<{ itemId: number; quantity: number; unitOfMeasure?: string }>,
  shipToAccountId: string
): Promise<McKessonAvailabilityItem[]> {
  if (!items || items.length === 0) {
    throw new Error('[MCKESSON] checkItemAvailability requires at least one item');
  }
  if (!shipToAccountId) {
    throw new Error('[MCKESSON] checkItemAvailability requires a shipToAccountId (gateway 500s without it)');
  }
  const body = {
    items: items.map(i => ({
      itemId: i.itemId,
      quantity: i.quantity,
      unitOfMeasure: i.unitOfMeasure || 'EA',
    })),
    shipto: { accountId: parseInt(shipToAccountId, 10) },
  };

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
  // Safety: block real-money orders unless explicitly opted in.
  // Sandbox env is always allowed; production requires MCKESSON_ALLOW_PRODUCTION_ORDERS=true.
  if (MCKESSON_ENVIRONMENT === 'production' && !MCKESSON_ALLOW_PRODUCTION_ORDERS) {
    throw new Error('[MCKESSON] Production orders are disabled. Set MCKESSON_ALLOW_PRODUCTION_ORDERS=true in env to enable real ordering.');
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

function buildDateRangeQuery(accountId: string, q: McKessonDateRangeQuery): string {
  const params = new URLSearchParams({
    accountId,
    startDate: q.startDate,
    endDate: q.endDate,
    pageOffset: String(q.pageOffset ?? 0),
    pageSize: String(q.pageSize ?? 50),
  });
  if (q.shipToId !== undefined) params.set('shipToId', String(q.shipToId));
  return params.toString();
}

/**
 * GET /v1/orders/{accountId}/fulfillment — paginated order status summaries by date range.
 */
export async function getOrderStatusSummariesByDate(
  accountId: string,
  q: McKessonDateRangeQuery
): Promise<McKessonOrderStatusPage> {
  return mckFetch<McKessonOrderStatusPage>(
    `/v1/orders/${accountId}/fulfillment?${buildDateRangeQuery(accountId, q)}`
  );
}

/**
 * GET /v1/orders/tracking — paginated order tracking details by date range.
 */
export async function getOrderTrackingByDate(
  accountId: string,
  q: McKessonDateRangeQuery
): Promise<McKessonOrderTrackingPage> {
  return mckFetch<McKessonOrderTrackingPage>(
    `/v1/orders/tracking?${buildDateRangeQuery(accountId, q)}`
  );
}

// ─── Invoices ───

/**
 * GET /v1/invoices — paginated invoice IDs for a date range (max 31-day window per docs).
 */
export async function getInvoiceIds(
  accountId: string,
  q: McKessonDateRangeQuery
): Promise<McKessonInvoiceIdsPage> {
  return mckFetch<McKessonInvoiceIdsPage>(
    `/v1/invoices?${buildDateRangeQuery(accountId, q)}`
  );
}

/**
 * GET /v1/invoices/{accountId}/{orderId}/{invoiceId} — full invoice with line items.
 */
export async function getInvoiceDetails(
  accountId: string,
  orderId: string,
  invoiceId: string
): Promise<McKessonInvoice> {
  return mckFetch<McKessonInvoice>(
    `/v1/invoices/${accountId}/${orderId}/${invoiceId}`
  );
}

// ─── Invoice DB persistence ───

export interface McKessonInvoiceRow {
  id: number;
  invoice_id: string;
  account_id: string;
  ship_to_id: string | null;
  order_id: string | null;
  invoice_date: string | null;
  invoice_due_date: string | null;
  order_date: string | null;
  status: string | null;
  purchase_order_number: string | null;
  sub_total: string | null;
  tax_total: string | null;
  net_total: string | null;
  discount_total: string | null;
  account_data: any;
  ship_to_data: any;
  raw_response: any;
  details_fetched_at: string | null;
  first_seen_at: string;
  date_window_start: string | null;
  date_window_end: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upsert a "skeleton" invoice row from a /v1/invoices list response.
 * Only invoice_id + account/ship-to + window are known at this stage.
 * order_id and details remain NULL until stage 2.
 */
export async function upsertInvoiceSkeleton(opts: {
  invoiceId: string;
  accountId: string;
  shipToId?: string | null;
  windowStart: string;
  windowEnd: string;
}): Promise<{ id: number; inserted: boolean }> {
  const rows = await query<{ id: number; inserted: boolean }>(
    `INSERT INTO mckesson_invoices (invoice_id, account_id, ship_to_id, date_window_start, date_window_end)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (invoice_id) DO UPDATE SET
        ship_to_id = COALESCE(mckesson_invoices.ship_to_id, EXCLUDED.ship_to_id),
        date_window_start = LEAST(mckesson_invoices.date_window_start, EXCLUDED.date_window_start),
        date_window_end = GREATEST(mckesson_invoices.date_window_end, EXCLUDED.date_window_end),
        updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [opts.invoiceId, opts.accountId, opts.shipToId ?? null, opts.windowStart, opts.windowEnd]
  );
  return rows[0];
}

/**
 * Persist a full invoice (after a successful getInvoiceDetails call). Replaces
 * existing line items for the same invoice. Also returns the resulting row id
 * and any line-product mappings detected against supply_items.
 */
export async function persistInvoiceDetails(
  invoiceRowId: number,
  inv: McKessonInvoice,
  rawResponse: unknown
): Promise<{ linesInserted: number; matchedSupplyIds: number[] }> {
  const pool = getPool();
  const client = await pool.connect();
  const matchedSupplyIds: number[] = [];
  let linesInserted = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE mckesson_invoices SET
         order_id              = $2,
         invoice_date          = NULLIF($3, '')::date,
         invoice_due_date      = NULLIF($4, '')::date,
         order_date            = NULLIF($5, '')::date,
         status                = $6,
         purchase_order_number = $7,
         sub_total             = $8,
         tax_total             = $9,
         net_total             = $10,
         discount_total        = $11,
         account_data          = $12,
         ship_to_data          = $13,
         raw_response          = $14,
         details_fetched_at    = NOW(),
         updated_at            = NOW()
       WHERE id = $1`,
      [
        invoiceRowId,
        inv.orderId,
        inv.invoiceDate || '',
        inv.invoiceDueDate || '',
        inv.orderDate || '',
        inv.status,
        inv.purchaseOrderNumber || null,
        inv.subTotal,
        inv.taxTotal,
        inv.netTotal,
        inv.discountTotal,
        JSON.stringify(inv.account || null),
        JSON.stringify(inv.shipTo || null),
        JSON.stringify(rawResponse),
      ]
    );

    // Replace existing lines (idempotent re-fetch)
    await client.query(`DELETE FROM mckesson_invoice_lines WHERE invoice_id = $1`, [invoiceRowId]);

    for (const line of inv.lines || []) {
      // Match line.productId → supply_items.mckesson_item_id
      const m = await client.query<{ id: number }>(
        `SELECT id FROM supply_items WHERE mckesson_item_id = $1 LIMIT 1`,
        [line.productId]
      );
      const matchedId = m.rows[0]?.id ?? null;
      if (matchedId) matchedSupplyIds.push(matchedId);

      await client.query(
        `INSERT INTO mckesson_invoice_lines
          (invoice_id, line_number, product_id, product_description, manufacturer,
           unit_of_measure, quantity_ordered, quantity_shipped, price, freight,
           tax_total, sub_total, net_total, discount_total, line_status,
           line_invoice_date, matched_supply_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULLIF($16,'')::date, $17)`,
        [
          invoiceRowId,
          typeof line.lineNumber === 'string' ? parseInt(line.lineNumber, 10) || null : line.lineNumber ?? null,
          line.productId ?? null,
          line.productDescription ?? null,
          line.manufacturer ?? null,
          line.unitOfMeasure ?? null,
          line.quantityOrdered ?? null,
          line.quantityShipped ?? null,
          line.price ?? null,
          line.freight ?? null,
          line.taxTotal ?? null,
          line.subTotal ?? null,
          line.netTotal ?? null,
          line.discountTotal ?? null,
          line.lineStatus ?? null,
          line.invoiceDate || '',
          matchedId,
        ]
      );
      linesInserted++;

      // Auto-populate supply_items.unit_cost from invoice price (only for
      // matched items, only when source is empty or already 'mckesson invoice'
      // — never overwrite manual entries).
      if (matchedId && line.price != null && line.unitOfMeasure) {
        await client.query(
          `UPDATE supply_items
             SET unit_cost            = $2,
                 unit_cost_uom        = $3,
                 unit_cost_source     = $4,
                 unit_cost_updated_at = NOW(),
                 updated_at           = NOW()
           WHERE id = $1
             AND (unit_cost_source IS NULL OR unit_cost_source LIKE 'mckesson invoice%')`,
          [matchedId, line.price, line.unitOfMeasure, `mckesson invoice ${inv.invoiceId}`]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { linesInserted, matchedSupplyIds };
}

export async function fetchInvoiceRows(opts: {
  limit?: number;
  pendingDetailsOnly?: boolean;
  search?: string;
} = {}): Promise<McKessonInvoiceRow[]> {
  const { limit = 200, pendingDetailsOnly = false, search } = opts;
  const where: string[] = [];
  const params: unknown[] = [];
  if (pendingDetailsOnly) where.push(`details_fetched_at IS NULL`);
  if (search) {
    params.push(`%${search}%`);
    where.push(`(invoice_id ILIKE $${params.length} OR purchase_order_number ILIKE $${params.length} OR order_id ILIKE $${params.length})`);
  }
  params.push(limit);
  const sql = `
    SELECT * FROM mckesson_invoices
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(invoice_date, first_seen_at::date) DESC
    LIMIT $${params.length}`;
  return query<McKessonInvoiceRow>(sql, params);
}

export async function fetchInvoiceById(id: number): Promise<{ invoice: McKessonInvoiceRow | null; lines: any[] }> {
  const inv = await query<McKessonInvoiceRow>(`SELECT * FROM mckesson_invoices WHERE id = $1`, [id]);
  if (inv.length === 0) return { invoice: null, lines: [] };
  const lines = await query<any>(
    `SELECT l.*, si.name AS matched_supply_name, si.category AS matched_supply_category
     FROM mckesson_invoice_lines l
     LEFT JOIN supply_items si ON si.id = l.matched_supply_item_id
     WHERE l.invoice_id = $1
     ORDER BY l.line_number NULLS LAST, l.id`,
    [id]
  );
  return { invoice: inv[0], lines };
}

// ─── Patients ───

/**
 * POST /v1/patients — register a new patient against the configured account.
 * NOTE: This mutates production data. Caller must validate inputs.
 */
export async function addPatient(
  req: McKessonAddPatientRequest
): Promise<McKessonPatientResponse> {
  return mckFetch<McKessonPatientResponse>(
    `/v1/patients`,
    { method: 'POST', body: req }
  );
}

/**
 * PUT /v1/patients/{patientId} — update an existing patient.
 */
export async function updatePatient(
  patientId: string,
  req: McKessonBasePatientRequest
): Promise<McKessonPatientResponse> {
  return mckFetch<McKessonPatientResponse>(
    `/v1/patients/${encodeURIComponent(patientId)}`,
    { method: 'PUT', body: req }
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
  return !!(
    MCKESSON_CLIENT_ID &&
    MCKESSON_CLIENT_SECRET &&
    MCKESSON_BASE_URL &&
    MCKESSON_ACCOUNT_ID
  );
}

export function getMcKessonEnvironment(): string {
  return MCKESSON_ENVIRONMENT;
}

/**
 * Default Bill-To account (URL path on every API call).
 */
export function getMcKessonAccountId(): string {
  return MCKESSON_ACCOUNT_ID;
}

/**
 * Default Ship-To account (body field). Falls back to bill-to if no separate
 * ship-to is configured. Phil's setup: bill=62477188, ship=62477191.
 */
export function getMcKessonShipToAccountId(): string {
  return MCKESSON_SHIP_TO_ACCOUNT_ID;
}

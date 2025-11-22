/**
 * QuickBooks Online API Client
 * Handles authentication and data fetching from QuickBooks Online API
 */

export type QuickBooksConfig = {
  clientId: string;
  clientSecret: string;
  realmId: string; // Company ID
  accessToken?: string;
  refreshToken?: string;
  environment?: 'sandbox' | 'production';
};

export type QuickBooksCustomer = {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  Balance?: number;
  BalanceWithJobs?: number;
};

export type QuickBooksInvoice = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CustomerRef: { value: string; name?: string };
  Balance: number;
  TotalAmt: number;
  CurrencyRef?: { value: string };
  Line?: Array<{
    Amount: number;
    Description?: string;
  }>;
  LinkedTxn?: Array<{
    TxnId: string;
    TxnType: string;
  }>;
};

export type QuickBooksPayment = {
  Id: string;
  TxnDate?: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string };
  DepositToAccountRef?: { value: string };
  PaymentMethodRef?: { value: string; name?: string };
  DocNumber?: string;
};

export type QuickBooksSalesReceipt = {
  Id: string;
  TxnDate?: string;
  CustomerRef?: { value: string; name?: string };
  TotalAmt?: number;
  DocNumber?: string;
  PrivateNote?: string;
  RecurringInfo?: {
    RecurringTxnId?: string;
  };
  PaymentMethodRef?: { value: string; name?: string };
  CreditCardPayment?: {
    CreditChargeResponse?: {
      Status?: string;
    };
  };
};

export type QuickBooksRecurringTransaction = {
  Id: string;
  Name: string;
  Type: 'Invoice' | 'SalesReceipt' | 'Estimate' | 'CreditMemo';
  Active: boolean;
  ScheduleInfo?: {
    StartDate?: string;
    EndDate?: string;
    NextDueDate?: string;
    IntervalType?: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
    NumInterval?: number;
    DaysBefore?: number;
    MaxOccurrences?: number;
    ReminderDaysBefore?: number;
  };
  CustomerRef?: { value: string; name?: string };
  TotalAmt?: number;
  SyncToken?: string;
};

export class QuickBooksClient {
  private config: QuickBooksConfig;
  private baseUrl: string;

  constructor(config: QuickBooksConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'sandbox'
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';
  }

  private async request<T>(
    method: string,
    endpoint: string,
    options?: { body?: unknown; minorVersion?: number }
  ): Promise<T> {
    if (!this.config.accessToken) {
      throw new Error('QuickBooks access token is required. Please authenticate first.');
    }

    const url = new URL(`${this.baseUrl}/v3/company/${this.config.realmId}${endpoint}`);
    if (options?.minorVersion && !url.searchParams.has('minorversion')) {
      url.searchParams.append('minorversion', String(options.minorVersion));
    }
    
    let response = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    // If we get a 401, try refreshing the token once and retry the request
    if (response.status === 401 && this.config.refreshToken) {
      console.log('[QuickBooks] Access token expired during request, refreshing...');
      try {
        const refreshed = await this.refreshAccessToken();
        this.config.accessToken = refreshed.access_token;
        this.config.refreshToken = refreshed.refresh_token;
        
        // Update database with new tokens
        const { query } = await import('./db');
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + (refreshed.expires_in || 3600));
        
        await query(
          `UPDATE quickbooks_oauth_tokens 
           SET access_token = $1, 
               refresh_token = $2, 
               expires_at = $3, 
               updated_at = NOW() 
           WHERE realm_id = $4`,
          [refreshed.access_token, refreshed.refresh_token, expiresAt, this.config.realmId]
        );
        
        console.log('[QuickBooks] Token refreshed successfully, retrying request...');
        
        // Retry the request with the new token
        response = await fetch(url.toString(), {
          method,
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (refreshError) {
        console.error('[QuickBooks] Token refresh failed:', refreshError);
        throw new Error('QuickBooks token expired and refresh failed. Please reconnect.');
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken!,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get all customers with balances
   */
  async getCustomers(): Promise<QuickBooksCustomer[]> {
    const customers: QuickBooksCustomer[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          Customer?: QuickBooksCustomer[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM Customer MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`);

      const queryResponse = response.QueryResponse;
      if (queryResponse.Customer) {
        customers.push(...queryResponse.Customer);
      }

      if (!queryResponse.Customer || queryResponse.Customer.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return customers;
  }

  /**
   * Get customer by ID
   */
  async getCustomer(customerId: string): Promise<QuickBooksCustomer> {
    const response = await this.request<{
      QueryResponse: {
        Customer: QuickBooksCustomer[];
      };
    }>(`GET`, `/query?query=SELECT * FROM Customer WHERE Id = '${customerId}'`);

    if (!response.QueryResponse.Customer || response.QueryResponse.Customer.length === 0) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    return response.QueryResponse.Customer[0];
  }

  /**
   * Get all invoices for a customer
   */
  async getInvoicesForCustomer(customerId: string): Promise<QuickBooksInvoice[]> {
    const invoices: QuickBooksInvoice[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          Invoice?: QuickBooksInvoice[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM Invoice WHERE CustomerRef = '${customerId}' MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`);

      const queryResponse = response.QueryResponse;
      if (queryResponse.Invoice) {
        invoices.push(...queryResponse.Invoice);
      }

      if (!queryResponse.Invoice || queryResponse.Invoice.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return invoices;
  }

  /**
   * Get all open invoices (with balance > 0)
   */
  async getOpenInvoices(): Promise<QuickBooksInvoice[]> {
    const invoices: QuickBooksInvoice[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          Invoice?: QuickBooksInvoice[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`);

      const queryResponse = response.QueryResponse;
      if (queryResponse.Invoice) {
        invoices.push(...queryResponse.Invoice);
      }

      if (!queryResponse.Invoice || queryResponse.Invoice.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return invoices;
  }

  /**
   * Get payments for a customer
   */
  async getPaymentsForCustomer(customerId: string): Promise<QuickBooksPayment[]> {
    const payments: QuickBooksPayment[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          Payment?: QuickBooksPayment[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM Payment WHERE CustomerRef = '${customerId}' MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`);

      const queryResponse = response.QueryResponse;
      if (queryResponse.Payment) {
        payments.push(...queryResponse.Payment);
      }

      if (!queryResponse.Payment || queryResponse.Payment.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return payments;
  }

  async getRecurringSalesReceipts(): Promise<QuickBooksSalesReceipt[]> {
    const receipts: QuickBooksSalesReceipt[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          SalesReceipt?: QuickBooksSalesReceipt[];
          maxResults: number;
          startPosition: number;
        };
      }>(
        `GET`,
        `/query?query=SELECT * FROM SalesReceipt ORDER BY TxnDate DESC MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`,
        { minorVersion: 65 }
      );

      const queryResponse = response.QueryResponse;
      if (queryResponse.SalesReceipt) {
        receipts.push(...queryResponse.SalesReceipt);
      }

      if (!queryResponse.SalesReceipt || queryResponse.SalesReceipt.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return receipts;
  }

  /**
   * Fetch sales receipts optionally filtered by a starting date
   */
  async getSalesReceipts(startDate?: Date): Promise<QuickBooksSalesReceipt[]> {
    const filters: string[] = [];
    if (startDate) {
      filters.push(`TxnDate >= '${startDate.toISOString().split('T')[0]}'`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const query = `SELECT * FROM SalesReceipt ${whereClause} ORDER BY TxnDate DESC`;
    const response = await this.request<{
      QueryResponse: {
        SalesReceipt?: QuickBooksSalesReceipt[];
      };
    }>(
      `GET`,
      `/query?query=${encodeURIComponent(query)}`,
      { minorVersion: 73 }
    );

    return response.QueryResponse.SalesReceipt ?? [];
  }

  /**
   * Helper for fetching recent sales receipts (defaults to 30 days)
   */
  async getRecentSalesReceipts(days = 30): Promise<QuickBooksSalesReceipt[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.getSalesReceipts(since);
  }

  async getSalesReceiptsForCustomer(customerId: string, days = 90): Promise<QuickBooksSalesReceipt[]> {
    const filters: string[] = [`CustomerRef = '${customerId}'`];
    if (days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      filters.push(`TxnDate >= '${since.toISOString().split('T')[0]}'`);
    }
    const query = `SELECT * FROM SalesReceipt WHERE ${filters.join(
      ' AND '
    )} ORDER BY TxnDate DESC`;
    const response = await this.request<{
      QueryResponse: { SalesReceipt?: QuickBooksSalesReceipt[] };
    }>('GET', `/query?query=${encodeURIComponent(query)}`, { minorVersion: 73 });
    return response.QueryResponse.SalesReceipt ?? [];
  }

  /**
   * Returns customers who currently have open payment issues (based on open invoices)
   */
  async getCustomersWithPaymentFailures(): Promise<QuickBooksCustomer[]> {
    const invoices = await this.getOpenInvoices();
    const overdueCustomerIds = new Set(
      invoices
        .filter((invoice) => invoice.Balance > 0)
        .map((invoice) => invoice.CustomerRef.value)
    );

    if (overdueCustomerIds.size === 0) {
      return [];
    }

    const customers = await this.getCustomers();
    return customers.filter((customer) => overdueCustomerIds.has(customer.Id));
  }

  /**
   * Calculate days overdue for an invoice
   */
  calculateDaysOverdue(invoice: QuickBooksInvoice): number {
    if (!invoice.DueDate) return 0;
    
    const dueDate = new Date(invoice.DueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, diffDays);
  }

  /**
   * Determine payment status for an invoice
   */
  getPaymentStatus(invoice: QuickBooksInvoice): 'paid' | 'partial' | 'overdue' | 'open' {
    if (invoice.Balance === 0) return 'paid';
    if (invoice.Balance < invoice.TotalAmt) return 'partial';
    
    const daysOverdue = this.calculateDaysOverdue(invoice);
    if (daysOverdue > 0) return 'overdue';
    
    return 'open';
  }

  /**
   * Get all recurring transactions (templates)
   */
  async getRecurringTransactions(): Promise<QuickBooksRecurringTransaction[]> {
    const transactions: QuickBooksRecurringTransaction[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          RecurringTransaction?: QuickBooksRecurringTransaction[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM RecurringTransaction MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`, {
        minorVersion: 65
      });

      const queryResponse = response.QueryResponse;
      if (queryResponse.RecurringTransaction) {
        transactions.push(...queryResponse.RecurringTransaction);
      }

      if (!queryResponse.RecurringTransaction || queryResponse.RecurringTransaction.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return transactions;
  }

  /**
   * Get recurring transactions for a specific customer
   */
  async getRecurringTransactionsForCustomer(customerId: string): Promise<QuickBooksRecurringTransaction[]> {
    const transactions: QuickBooksRecurringTransaction[] = [];
    let startPosition = 1;
    const maxResults = 100;

    while (true) {
      const response = await this.request<{
        QueryResponse: {
          RecurringTransaction?: QuickBooksRecurringTransaction[];
          maxResults: number;
          startPosition: number;
        };
      }>(`GET`, `/query?query=SELECT * FROM RecurringTransaction WHERE CustomerRef = '${customerId}' MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`, {
        minorVersion: 65
      });

      const queryResponse = response.QueryResponse;
      if (queryResponse.RecurringTransaction) {
        transactions.push(...queryResponse.RecurringTransaction);
      }

      if (!queryResponse.RecurringTransaction || queryResponse.RecurringTransaction.length < maxResults) {
        break;
      }

      startPosition += maxResults;
    }

    return transactions;
  }

  /**
   * Get only active recurring transactions
   */
  async getActiveRecurringTransactions(): Promise<QuickBooksRecurringTransaction[]> {
    const allRecurring = await this.getRecurringTransactions();
    return allRecurring.filter(rt => rt.Active === true);
  }

  /**
   * Get invoices generated from a recurring transaction template
   * Note: This requires querying invoices and matching by template name or other identifier
   */
  async getInvoicesFromRecurringTemplate(recurringTemplateName: string): Promise<QuickBooksInvoice[]> {
    // QuickBooks doesn't directly link invoices to recurring templates,
    // but we can search for invoices that match the pattern
    const allInvoices = await this.getOpenInvoices();
    return allInvoices.filter(inv => 
      inv.DocNumber?.includes(recurringTemplateName) || 
      false // Add other matching logic as needed
    );
  }

  /**
   * Calculate next charge date based on recurring transaction schedule
   */
  calculateNextChargeDate(recurring: QuickBooksRecurringTransaction): Date | null {
    if (!recurring.ScheduleInfo?.NextDueDate) {
      return null;
    }

    return new Date(recurring.ScheduleInfo.NextDueDate);
  }

  /**
   * Check if a recurring transaction is due for next charge
   */
  isRecurringDue(recurring: QuickBooksRecurringTransaction): boolean {
    const nextDue = this.calculateNextChargeDate(recurring);
    if (!nextDue) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    nextDue.setHours(0, 0, 0, 0);

    return nextDue <= today;
  }
}

/**
 * Load OAuth tokens from database
 */
async function loadTokensFromDatabase(realmId?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  realmId: string;
} | null> {
  try {
    const { query } = await import('./db');
    
    console.log('[QuickBooks] loadTokensFromDatabase called with realmId:', realmId);
    console.log('[QuickBooks] process.env.QUICKBOOKS_REALM_ID:', process.env.QUICKBOOKS_REALM_ID);
    
    // Always load the most recent token from database, ignore environment variable
    console.log('[QuickBooks] Loading most recent token from database');
    const recentTokens = await query<{
      realm_id: string;
      access_token: string;
      refresh_token: string;
      expires_at: Date;
    }>(
      `SELECT realm_id, access_token, refresh_token, expires_at 
       FROM quickbooks_oauth_tokens 
       ORDER BY updated_at DESC 
       LIMIT 1`
    );
    
    if (recentTokens.length === 0) {
      console.log('[QuickBooks] No tokens found in database');
      return null;
    }
    
    const token = recentTokens[0];
    console.log('[QuickBooks] Found token for realm ID:', token.realm_id);
    
    // Check if token is expired and handle it
    const expiresAt = new Date(token.expires_at);
    const now = new Date();
    const buffer = 5 * 60 * 1000;
    
    console.log('[QuickBooks] Token expires at:', expiresAt.toISOString(), 'Now:', now.toISOString());
    
    if (expiresAt.getTime() - now.getTime() < buffer) {
      console.log('[QuickBooks] Token expired, attempting refresh...');
      try {
        const refreshed = await refreshQuickBooksToken(token.refresh_token);
        const expiresAtNew = new Date();
        expiresAtNew.setSeconds(expiresAtNew.getSeconds() + (refreshed.expires_in || 3600));
        
        await query(
          `UPDATE quickbooks_oauth_tokens 
           SET access_token = $1, 
               refresh_token = $2, 
               expires_at = $3, 
               updated_at = NOW() 
           WHERE realm_id = $4`,
          [refreshed.access_token, refreshed.refresh_token, expiresAtNew, token.realm_id]
        );
        
        console.log('[QuickBooks] Token refreshed successfully');
        
        return {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          realmId: token.realm_id,
        };
      } catch (refreshError) {
        console.error('[QuickBooks] Failed to refresh token:', refreshError);
        return null;
      }
    }
    
    console.log('[QuickBooks] Using existing valid token');
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      realmId: token.realm_id,
    };
  } catch (error) {
    console.warn('[QuickBooks] Could not load tokens from database:', error);
    return null;
  }
}

/**
 * Refresh QuickBooks access token using refresh token
 */
export async function refreshQuickBooksToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('QuickBooks OAuth credentials not configured');
  }

  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

/**
 * Create a QuickBooks client from environment variables or database
 */
export async function createQuickBooksClient(): Promise<QuickBooksClient | null> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const environment = (process.env.QUICKBOOKS_ENVIRONMENT || 'production') as 'sandbox' | 'production';

  if (!clientId || !clientSecret) {
    console.warn('QuickBooks OAuth credentials not configured');
    return null;
  }

  // Try to load tokens from database first (production)
  const dbTokens = await loadTokensFromDatabase();
  
  if (dbTokens) {
    return new QuickBooksClient({
      clientId,
      clientSecret,
      realmId: dbTokens.realmId,
      accessToken: dbTokens.accessToken,
      refreshToken: dbTokens.refreshToken,
      environment,
    });
  }

  // Fall back to environment variables (development)
  const realmId = process.env.QUICKBOOKS_REALM_ID;
  const accessToken = process.env.QUICKBOOKS_ACCESS_TOKEN;
  const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN;

  if (!realmId || !accessToken || !refreshToken) {
    console.warn('QuickBooks tokens not found. Please complete OAuth flow at /api/auth/quickbooks');
    return null;
  }

  return new QuickBooksClient({
    clientId,
    clientSecret,
    realmId,
    accessToken,
    refreshToken,
    environment,
  });
}


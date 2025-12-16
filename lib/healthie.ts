/**
 * Healthie API Client
 * Handles authentication and data operations with Healthie EMR API
 * 
 * NOTE: This implementation assumes Healthie uses a GraphQL API with API key authentication.
 * You may need to adjust the GraphQL queries/mutations based on the actual Healthie API documentation.
 * If Healthie uses REST instead of GraphQL, modify the `graphql()` method to use REST endpoints.
 * 
 * Healthie API Documentation: https://docs.gethealthie.com/
 */

export type HealthieConfig = {
  apiKey: string;
  apiUrl?: string;
};

export type HealthieClientData = {
  id: string;
  user_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  dob?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  created_at?: string;
  updated_at?: string;
};

export type HealthiePackage = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  billing_frequency?: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  number_of_sessions?: number;
  created_at?: string;
  updated_at?: string;
};

export type HealthieSubscription = {
  id: string;
  client_id: string;
  package_id: string;
  status?: 'active' | 'cancelled' | 'paused';
  start_date?: string;
  next_charge_date?: string;
  amount?: number;
  created_at?: string;
  updated_at?: string;
};

export type CreateClientInput = {
  first_name: string;
  last_name: string;
  email?: string;
  phone_number?: string;
  dob?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type CreatePackageInput = {
  name: string;
  description?: string;
  price: number;
  billing_frequency: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  number_of_sessions?: number;
};

export type AssignPackageInput = {
  client_id: string;
  package_id: string;
  start_date?: string;
};

export type HealthieInvoice = {
  id: string;
  client_id: string;
  invoice_number?: string;
  amount: number;
  status?: 'draft' | 'sent' | 'paid' | 'cancelled';
  due_date?: string;
  created_at?: string;
  updated_at?: string;
};

export type CreateInvoiceInput = {
  client_id: string;
  amount: number;
  description?: string;
  due_date?: string;
  send_email?: boolean;
};

const HEALTHIE_DEBUG_ENABLED = process.env.HEALTHIE_DEBUG === 'true';

export class HealthieClient {
  private config: HealthieConfig;
  private apiUrl: string;

  constructor(config: HealthieConfig) {
    this.config = config;
    this.apiUrl = config.apiUrl || 'https://api.gethealthie.com/graphql';
  }

  private debugLog(...args: unknown[]): void {
    if (HEALTHIE_DEBUG_ENABLED) {
      console.log('[Healthie]', ...args);
    }
  }

  /**
   * Execute a GraphQL query/mutation
   * 
   * Healthie API uses Basic authentication with API key
   * Documentation: https://docs.gethealthie.com/guides/api-concepts/authentication/
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!this.config.apiKey) {
      throw new Error('Healthie API key is required');
    }

    // Healthie uses Basic auth with API key (not Bearer token)
    // Format: Authorization: Basic YOUR_API_KEY_HERE
    // Also requires AuthorizationSource: API header
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.config.apiKey}`,
        'AuthorizationSource': 'API',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Healthie API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    if (result.errors) {
      const errorMessages = result.errors.map((e: any) => e.message).join(', ');
      throw new Error(`Healthie GraphQL error: ${errorMessages}`);
    }

    return result.data as T;
  }

  /**
   * Create a new client in Healthie
   */
  async createClient(input: CreateClientInput): Promise<HealthieClientData> {
    const mutation = `
      mutation CreateClient($input: createClientInput!) {
        createClient(input: $input) {
          client {
            id
            user_id
            first_name
            last_name
            email
            phone_number
            dob
            address
            city
            state
            zip
            created_at
            updated_at
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        createClient: {
          client: HealthieClientData;
        };
      }>(mutation, {
        input: {
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email || null,
          phone_number: input.phone_number || null,
          dob: input.dob || null,
          address: input.address || null,
          city: input.city || null,
          state: input.state || null,
          zip: input.zip || null,
        },
      });

      this.debugLog('Created client:', result.createClient.client.id);
      return result.createClient.client;
    } catch (error) {
      this.debugLog('Error creating client:', error);
      throw error;
    }
  }

  /**
   * Find client by email
   */
  async findClientByEmail(email: string): Promise<HealthieClientData | null> {
    if (!email) {
      return null;
    }

    const query = `
      query FindClientByEmail($email: String!) {
        clients(email: $email) {
          id
          user_id
          first_name
          last_name
          email
          phone_number
          dob
          address
          city
          state
          zip
          created_at
          updated_at
        }
      }
    `;

    try {
      const result = await this.graphql<{
        clients: HealthieClientData[];
      }>(query, { email });

      if (result.clients && result.clients.length > 0) {
        this.debugLog('Found client by email:', result.clients[0].id);
        return result.clients[0];
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find client by phone number
   */
  async findClientByPhone(phone: string): Promise<HealthieClientData | null> {
    if (!phone) {
      return null;
    }

    // Normalize phone number (remove non-digits)
    const normalizedPhone = phone.replace(/\D/g, '');

    const query = `
      query FindClientByPhone($phone: String!) {
        clients(phone_number: $phone) {
          id
          user_id
          first_name
          last_name
          email
          phone_number
          dob
          address
          city
          state
          zip
          created_at
          updated_at
        }
      }
    `;

    try {
      const result = await this.graphql<{
        clients: HealthieClientData[];
      }>(query, { phone: normalizedPhone });

      if (result.clients && result.clients.length > 0) {
        this.debugLog('Found client by phone:', result.clients[0].id);
        return result.clients[0];
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get client by ID
   */
  async getClient(clientId: string): Promise<HealthieClientData> {
    const query = `
      query GetClient($id: ID!) {
        client(id: $id) {
          id
          user_id
          first_name
          last_name
          email
          phone_number
          dob
          address
          city
          state
          zip
          created_at
          updated_at
        }
      }
    `;

    const result = await this.graphql<{
      client: HealthieClientData;
    }>(query, { id: clientId });

    return result.client;
  }

  /**
   * Update client information
   */
  async updateClient(clientId: string, input: Partial<CreateClientInput>): Promise<HealthieClientData> {
    const mutation = `
      mutation UpdateClient($id: ID!, $input: updateClientInput!) {
        updateClient(id: $id, input: $input) {
          client {
            id
            user_id
            first_name
            last_name
            email
            phone_number
            dob
            address
            city
            state
            zip
            created_at
            updated_at
          }
        }
      }
    `;

    const result = await this.graphql<{
      updateClient: {
        client: HealthieClientData;
      };
    }>(mutation, {
      id: clientId,
      input,
    });

    this.debugLog('Updated client:', result.updateClient.client.id);
    return result.updateClient.client;
  }

  /**
   * Create a package (recurring payment plan)
   */
  async createPackage(input: CreatePackageInput): Promise<HealthiePackage> {
    const mutation = `
      mutation CreatePackage($input: createPackageInput!) {
        createPackage(input: $input) {
          package {
            id
            name
            description
            price
            billing_frequency
            number_of_sessions
            created_at
            updated_at
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        createPackage: {
          package: HealthiePackage;
        };
      }>(mutation, {
        input: {
          name: input.name,
          description: input.description || null,
          price: input.price,
          billing_frequency: input.billing_frequency,
          number_of_sessions: input.number_of_sessions || null,
        },
      });

      this.debugLog('Created package:', result.createPackage.package.id);
      return result.createPackage.package;
    } catch (error) {
      this.debugLog('Error creating package:', error);
      throw error;
    }
  }

  /**
   * Get all packages
   */
  async getPackages(): Promise<HealthiePackage[]> {
    const query = `
      query GetPackages {
        packages {
          id
          name
          description
          price
          billing_frequency
          number_of_sessions
          created_at
          updated_at
        }
      }
    `;

    const result = await this.graphql<{
      packages: HealthiePackage[];
    }>(query);

    return result.packages || [];
  }

  /**
   * Get package by ID
   */
  async getPackage(packageId: string): Promise<HealthiePackage> {
    const query = `
      query GetPackage($id: ID!) {
        package(id: $id) {
          id
          name
          description
          price
          billing_frequency
          number_of_sessions
          created_at
          updated_at
        }
      }
    `;

    const result = await this.graphql<{
      package: HealthiePackage;
    }>(query, { id: packageId });

    return result.package;
  }

  /**
   * Assign a package to a client (create subscription)
   */
  async assignPackageToClient(input: AssignPackageInput): Promise<HealthieSubscription> {
    const mutation = `
      mutation AssignPackage($input: assignPackageInput!) {
        assignPackage(input: $input) {
          subscription {
            id
            client_id
            package_id
            status
            start_date
            next_charge_date
            amount
            created_at
            updated_at
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        assignPackage: {
          subscription: HealthieSubscription;
        };
      }>(mutation, {
        input: {
          client_id: input.client_id,
          package_id: input.package_id,
          start_date: input.start_date || new Date().toISOString().split('T')[0],
        },
      });

      this.debugLog('Assigned package to client:', result.assignPackage.subscription.id);
      return result.assignPackage.subscription;
    } catch (error) {
      this.debugLog('Error assigning package:', error);
      throw error;
    }
  }

  /**
   * Get client subscriptions
   */
  async getClientSubscriptions(clientId: string): Promise<HealthieSubscription[]> {
    const query = `
      query GetClientSubscriptions($clientId: ID!) {
        client(id: $clientId) {
          subscriptions {
            id
            client_id
            package_id
            status
            start_date
            next_charge_date
            amount
            created_at
            updated_at
          }
        }
      }
    `;

    const result = await this.graphql<{
      client: {
        subscriptions: HealthieSubscription[];
      };
    }>(query, { clientId });

    return result.client.subscriptions || [];
  }

  /**
   * Create an invoice for a client
   */
  async createInvoice(input: CreateInvoiceInput): Promise<HealthieInvoice> {
    const mutation = `
      mutation CreateInvoice($input: createInvoiceInput!) {
        createInvoice(input: $input) {
          invoice {
            id
            client_id
            invoice_number
            amount
            status
            due_date
            created_at
            updated_at
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        createInvoice: {
          invoice: HealthieInvoice;
        };
      }>(mutation, {
        input: {
          client_id: input.client_id,
          amount: input.amount,
          description: input.description || null,
          due_date: input.due_date || null,
          send_email: input.send_email ?? true,
        },
      });

      this.debugLog('Created invoice:', result.createInvoice.invoice.id);
      return result.createInvoice.invoice;
    } catch (error) {
      this.debugLog('Error creating invoice:', error);
      throw error;
    }
  }

  /**
   * Get client invoices
   */
  async getClientInvoices(clientId: string): Promise<HealthieInvoice[]> {
    const query = `
      query GetClientInvoices($clientId: ID!) {
        client(id: $clientId) {
          invoices {
            id
            client_id
            invoice_number
            amount
            status
            due_date
            created_at
            updated_at
          }
        }
      }
    `;

    const result = await this.graphql<{
      client: {
        invoices: HealthieInvoice[];
      };
    }>(query, { clientId });

    return result.client.invoices || [];
  }

  /**
   * Check if client has saved payment method
   */
  async hasPaymentMethod(clientId: string): Promise<boolean> {
    const query = `
      query GetClientPaymentMethods($clientId: ID!) {
        client(id: $clientId) {
          payment_methods {
            id
            type
            last_four
            is_default
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        client: {
          payment_methods: Array<{
            id: string;
            type: string;
            last_four?: string;
            is_default: boolean;
          }>;
        };
      }>(query, { clientId });

      return result.client.payment_methods && result.client.payment_methods.length > 0;
    } catch (error) {
      this.debugLog('Error checking payment methods:', error);
      return false;
    }
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const query = `
        query TestConnection {
          me {
            id
            email
          }
        }
      `;

      await this.graphql<{
        me: {
          id: string;
          email: string;
        };
      }>(query);

      return true;
    } catch (error) {
      this.debugLog('Connection test failed:', error);
      return false;
    }
  }
}

/**
 * Create a Healthie client from environment variables
 */
export function createHealthieClient(): HealthieClient | null {
  const apiKey = process.env.HEALTHIE_API_KEY;
  const apiUrl = process.env.HEALTHIE_API_URL;

  if (!apiKey) {
    console.warn('Healthie API key not configured');
    return null;
  }

  return new HealthieClient({
    apiKey,
    apiUrl,
  });
}


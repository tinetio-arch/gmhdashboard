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
  trtRegimenMetadataKey?: string;
  lastDispenseMetadataKey?: string;
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

type HealthieUserRecord = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  dob?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type HealthieLocationInput = {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

type UpdateClientPayload = Partial<CreateClientInput> & {
  location?: HealthieLocationInput;
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
  dietitian_id?: string;
  metadata?: string;
  user_group_id?: string;
  additional_record_identifier?: string;
  record_identifier?: string;
  restricted?: boolean;
  dont_send_welcome?: boolean;
  skipped_email?: boolean;
  skip_set_password_state?: boolean;
  gender?: string;
  legal_name?: string;
  ssn?: string;
  timezone?: string;
  other_provider_ids?: string[];
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

export type HealthiePaymentMethod = {
  id: string;
  type: string;
  last_four?: string | null;
  is_default?: boolean | null;
  expires_at?: string | null;
};

export type HealthieMedication = {
  id: string;
  name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  directions?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  normalized_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HealthieAllergy = {
  id: string;
  name?: string | null;
  reaction?: string | null;
  severity?: string | null;
  notes?: string | null;
};

export type HealthiePrescription = {
  id: string;
  product_name?: string | null;
  dosage?: string | null;
  directions?: string | null;
  quantity?: string | null;
  refills?: string | null;
  unit?: string | null;
  route?: string | null;
  days_supply?: number | null;
  date_written?: string | null;
  status?: string | null;
  normalized_status?: string | null;
  pharmacy?: HealthiePharmacy | null;
  prescriber_name?: string | null;
  rx_reference_number?: string | null;
  ndc?: string | null;
  schedule?: string | null;
};

export type HealthiePharmacy = {
  id: string;
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone_number?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

export type CreateChartNoteInput = {
  client_id: string;
  body: string;
  title?: string;
  status?: string;
  author_id?: string;
  template_id?: string;
};

export type HealthieChartNote = {
  id: string;
  title?: string | null;
  status?: string | null;
  body?: string | null;
};

const HEALTHIE_DEBUG_ENABLED = process.env.HEALTHIE_DEBUG === 'true';

export class HealthieClient {
  private config: HealthieConfig;
  private apiUrl: string;
  private userDirectoryPromise: Promise<void> | null = null;
  private userDirectoryByEmail = new Map<string, HealthieClientData>();
  private userDirectoryByPhone = new Map<string, HealthieClientData>();
  private trtRegimenKey: string;
  private lastDispenseKey: string;

  constructor(config: HealthieConfig) {
    this.config = config;
    this.apiUrl = config.apiUrl || 'https://api.gethealthie.com/graphql';
    this.trtRegimenKey = config.trtRegimenMetadataKey || 'trt_regimen';
    this.lastDispenseKey = config.lastDispenseMetadataKey || 'last_dispense_date';
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

  private normalizeEmail(value?: string | null): string | null {
    return value?.trim().toLowerCase() ?? null;
  }

  private normalizePhone(value?: string | null): string | null {
    const digits = value?.replace(/\D/g, '') ?? '';
    return digits || null;
  }

  private parseMetadata(raw?: string | null): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, string>;
      }
    } catch (error) {
      this.debugLog('Failed to parse metadata:', error);
    }
    return {};
  }

  private stringifyMetadata(data: Record<string, unknown>): string {
    return JSON.stringify(data);
  }

  private transformUserRecord(user: HealthieUserRecord): HealthieClientData {
    return {
      id: user.id,
      user_id: user.id,
      first_name: user.first_name ?? undefined,
      last_name: user.last_name ?? undefined,
      email: user.email ?? undefined,
      phone_number: user.phone_number ?? undefined,
      dob: user.dob ?? undefined,
      created_at: user.created_at ?? undefined,
      updated_at: user.updated_at ?? undefined,
    };
  }

  async getUserMetadata(userId: string): Promise<Record<string, string>> {
    const query = `
      query UserMetadata($id: ID!) {
        user(id: $id) {
          id
          metadata
        }
      }
    `;
    const result = await this.graphql<{ user: { id: string; metadata?: string | null } | null }>(query, { id: userId });
    const raw = result.user?.metadata ?? null;
    return this.parseMetadata(raw);
  }

  async updateClientMetadataFields(
    clientId: string,
    updates: Record<string, string | undefined | null>
  ): Promise<void> {
    const updateKeys = Object.keys(updates);
    if (!updateKeys.length) {
      return;
    }

    const existing = await this.getUserMetadata(clientId);
    const merged: Record<string, string> = { ...existing };

    for (const key of updateKeys) {
      const value = updates[key];
      if (value === undefined || value === null || value === '') {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    await this.updateClient(clientId, {
      metadata: this.stringifyMetadata(merged),
    });
  }

  private async fetchUsersPage(params: { offset: number; pageSize: number; keywords?: string }): Promise<HealthieUserRecord[]> {
    const query = `
      query ListUsers($offset: Int!, $pageSize: Int!, $shouldPaginate: Boolean!, $includeSuborgPatients: Boolean!, $keywords: String) {
        users(
          offset: $offset
          page_size: $pageSize
          should_paginate: $shouldPaginate
          include_suborg_patients: $includeSuborgPatients
          keywords: $keywords
        ) {
          id
          first_name
          last_name
          email
          phone_number
          dob
          created_at
          updated_at
        }
      }
    `;

    const variables: Record<string, unknown> = {
      offset: params.offset,
      pageSize: params.pageSize,
      shouldPaginate: true,
      includeSuborgPatients: true,
      keywords: params.keywords ?? null,
    };

    const result = await this.graphql<{ users: HealthieUserRecord[] }>(query, variables);
    return result.users ?? [];
  }

  private async ensureUserDirectory(): Promise<void> {
    if (this.userDirectoryPromise) {
      return this.userDirectoryPromise;
    }

    this.userDirectoryPromise = (async () => {
      this.userDirectoryByEmail.clear();
      this.userDirectoryByPhone.clear();
      const pageSize = 200;
      let offset = 0;

      for (;;) {
        const users = await this.fetchUsersPage({ offset, pageSize });
        if (!users.length) {
          break;
        }

        for (const user of users) {
          const normalizedUser = this.transformUserRecord(user);
          const emailKey = this.normalizeEmail(user.email);
          if (emailKey && !this.userDirectoryByEmail.has(emailKey)) {
            this.userDirectoryByEmail.set(emailKey, normalizedUser);
          }

          const phoneKey = this.normalizePhone(user.phone_number);
          if (phoneKey && !this.userDirectoryByPhone.has(phoneKey)) {
            this.userDirectoryByPhone.set(phoneKey, normalizedUser);
          }
        }

        if (users.length < pageSize) {
          break;
        }

        offset += pageSize;
      }
    })()
      .catch((error) => {
        this.userDirectoryPromise = null;
        throw error;
      });

    await this.userDirectoryPromise;
  }

  /**
   * Create a new client in Healthie
   */
  async createClient(input: CreateClientInput): Promise<HealthieClientData> {
    const mutation = `
      mutation CreateClient($input: createClientInput!) {
        createClient(input: $input) {
          user {
            id
            first_name
            last_name
            email
            phone_number
            dob
            created_at
            updated_at
          }
          messages {
            field
            message
          }
        }
      }
    `;

    const payload: Record<string, unknown> = {
      first_name: input.first_name,
      last_name: input.last_name,
    };
    if (input.email) payload.email = input.email;
    if (input.phone_number) payload.phone_number = input.phone_number;
    if (input.dob) payload.dob = input.dob;
    if (input.dietitian_id) payload.dietitian_id = input.dietitian_id;
    if (input.metadata) payload.metadata = input.metadata;
    if (input.user_group_id) payload.user_group_id = input.user_group_id;
    if (input.additional_record_identifier) payload.additional_record_identifier = input.additional_record_identifier;
    if (input.record_identifier) payload.record_identifier = input.record_identifier;
    if (typeof input.restricted === 'boolean') payload.restricted = input.restricted;
    if (typeof input.dont_send_welcome === 'boolean') payload.dont_send_welcome = input.dont_send_welcome;
    if (typeof input.skipped_email === 'boolean') payload.skipped_email = input.skipped_email;
    if (typeof input.skip_set_password_state === 'boolean') payload.skip_set_password_state = input.skip_set_password_state;
    if (input.gender) payload.gender = input.gender;
    if (input.legal_name) payload.legal_name = input.legal_name;
    if (input.ssn) payload.ssn = input.ssn;
    if (input.timezone) payload.timezone = input.timezone;
    if (input.other_provider_ids?.length) payload.other_provider_ids = input.other_provider_ids;

    try {
      const result = await this.graphql<{
        createClient: {
          user: {
            id: string;
            first_name?: string;
            last_name?: string;
            email?: string;
            phone_number?: string;
            dob?: string;
            created_at?: string;
            updated_at?: string;
          } | null;
          messages?: Array<{ field?: string | null; message?: string | null }> | null;
        };
      }>(mutation, { input: payload });

      const user = result.createClient.user;
      if (!user) {
        const messages = result.createClient.messages ?? [];
        const messageText =
          messages.length > 0
            ? messages.map((m) => `${m.field ?? 'general'}: ${m.message ?? 'unknown error'}`).join('; ')
            : 'unknown error';
        throw new Error(`Healthie createClient did not return a user (${messageText}).`);
      }
      this.debugLog('Created client:', user.id);
      return this.transformUserRecord(user);
    } catch (error) {
      this.debugLog('Error creating client:', error);
      throw error;
    }
  }

  /**
   * Retrieve medications for a user.
   */
  async getMedications(userId: string, options?: { active?: boolean }): Promise<HealthieMedication[]> {
    const query = `
      query Medications($userId: ID!, $active: Boolean) {
        medications(user_id: $userId, active: $active) {
          id
          name
          dosage
          frequency
          route
          directions
          start_date
          end_date
          normalized_status
          created_at
          updated_at
        }
      }
    `;

    const variables: Record<string, unknown> = { userId };
    if (typeof options?.active === 'boolean') {
      variables.active = options.active;
    }

    const result = await this.graphql<{ medications: HealthieMedication[] }>(query, variables);
    return result.medications ?? [];
  }

  /**
   * Retrieve allergies for a user.
   */
  async getAllergies(userId: string): Promise<HealthieAllergy[]> {
    const query = `
      query Allergies($userId: ID!) {
        allergies(user_id: $userId) {
          id
          name
          reaction
          severity
          notes
        }
      }
    `;

    const result = await this.graphql<{ allergies: HealthieAllergy[] }>(query, { userId });
    return result.allergies ?? [];
  }

  /**
   * Retrieve prescriptions for a user.
   */
  async getPrescriptions(userId: string, options?: { status?: string }): Promise<HealthiePrescription[]> {
    const query = `
      query Prescriptions($userId: ID!, $status: String) {
        prescriptions(user_id: $userId, status: $status) {
          id
          product_name
          dosage
          directions
          quantity
          refills
          unit
          route
          days_supply
          date_written
          status
          normalized_status
          rx_reference_number
          ndc
          schedule
          pharmacy {
            id
            name
            line1
            line2
            city
            state
            zip
            phone_number
          }
          prescriber_name
        }
      }
    `;

    const variables: Record<string, unknown> = { userId };
    if (options?.status) {
      variables.status = options.status;
    }

    const result = await this.graphql<{ prescriptions: HealthiePrescription[] }>(query, variables);
    return result.prescriptions ?? [];
  }

  /**
   * Search pharmacies by text.
   */
  async searchPharmacies(term: string, limit = 5): Promise<HealthiePharmacy[]> {
    const query = `
      query Pharmacies($term: String!, $limit: Int) {
        pharmacies(search: $term, limit: $limit) {
          id
          name
          line1
          line2
          city
          state
          zip
          phone_number
          latitude
          longitude
        }
      }
    `;

    const variables: Record<string, unknown> = { term, limit };
    const result = await this.graphql<{ pharmacies: HealthiePharmacy[] }>(query, variables);
    return result.pharmacies ?? [];
  }

  /**
   * Create a chart note entry for a client.
   */
  async createChartNote(input: CreateChartNoteInput): Promise<HealthieChartNote> {
    const mutation = `
      mutation CreateChartNote($input: createChartNoteInput!) {
        createChartNote(input: $input) {
          chart_note {
            id
            title
            status
          }
          errors {
            field
            message
          }
        }
      }
    `;

    const result = await this.graphql<{
      createChartNote: {
        chart_note?: HealthieChartNote | null;
        errors?: Array<{ field?: string | null; message?: string | null }> | null;
      };
    }>(mutation, { input });

    const errors = result.createChartNote?.errors ?? [];
    if (errors.length) {
      const message = errors.map((e) => `${e.field ?? 'base'}: ${e.message ?? 'error'}`).join('; ');
      throw new Error(`Healthie createChartNote failed: ${message}`);
    }

    const chartNote = result.createChartNote?.chart_note;
    if (!chartNote?.id) {
      throw new Error('Healthie createChartNote did not return a chart note ID.');
    }

    return chartNote;
  }

  /**
   * Find client by email
   */
  async findClientByEmail(email: string): Promise<HealthieClientData | null> {
    if (!email) {
      return null;
    }

    await this.ensureUserDirectory();
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      return null;
    }

    return this.userDirectoryByEmail.get(normalized) ?? null;
  }

  /**
   * Find client by phone number
   */
  async findClientByPhone(phone: string): Promise<HealthieClientData | null> {
    if (!phone) {
      return null;
    }

    await this.ensureUserDirectory();
    const normalized = this.normalizePhone(phone);
    if (!normalized) {
      return null;
    }

    return this.userDirectoryByPhone.get(normalized) ?? null;
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
  async updateClient(clientId: string, input: UpdateClientPayload): Promise<HealthieClientData> {
    const mutation = `
      mutation UpdateClient($input: updateClientInput!) {
        updateClient(input: $input) {
          user {
            id
            first_name
            last_name
            email
            phone_number
            dob
            created_at
            updated_at
          }
          messages {
            field
            message
          }
        }
      }
    `;

    const payload: Record<string, unknown> = {};
    if (input.first_name) payload.first_name = input.first_name;
    if (input.last_name) payload.last_name = input.last_name;
    if (input.email) payload.email = input.email;
    if (input.phone_number) payload.phone_number = input.phone_number;
    if (input.dob) payload.dob = input.dob;
    if (input.dietitian_id) payload.dietitian_id = input.dietitian_id;
    if (input.metadata) payload.metadata = input.metadata;
    if (input.user_group_id) payload.user_group_id = input.user_group_id;
    if (input.additional_record_identifier) payload.additional_record_identifier = input.additional_record_identifier;
    if (input.record_identifier) payload.record_identifier = input.record_identifier;
    if (typeof input.restricted === 'boolean') payload.restricted = input.restricted;
    if (typeof input.dont_send_welcome === 'boolean') payload.dont_send_welcome = input.dont_send_welcome;
    if (typeof input.skipped_email === 'boolean') payload.skipped_email = input.skipped_email;
    if (typeof input.skip_set_password_state === 'boolean') payload.skip_set_password_state = input.skip_set_password_state;
    if (input.gender) payload.gender = input.gender;
    if (input.legal_name) payload.legal_name = input.legal_name;
    if (input.ssn) payload.ssn = input.ssn;
    if (input.timezone) payload.timezone = input.timezone;
    if (input.other_provider_ids?.length) payload.other_provider_ids = input.other_provider_ids;
    if (input.location) payload.location = input.location;
    payload.id = clientId;

    const result = await this.graphql<{
      updateClient: {
        user: {
          id: string;
          first_name?: string;
          last_name?: string;
          email?: string;
          phone_number?: string;
          dob?: string;
          created_at?: string;
          updated_at?: string;
        } | null;
        messages?: Array<{ field?: string | null; message?: string | null }> | null;
      };
    }>(mutation, { input: payload });

    const user = result.updateClient.user;
    if (!user) {
      const messages = result.updateClient.messages ?? [];
      const messageText =
        messages.length > 0
          ? messages.map((m) => `${m.field ?? 'general'}: ${m.message ?? 'unknown error'}`).join('; ')
          : 'unknown error';
      throw new Error(`Healthie updateClient did not return a user (${messageText}).`);
    }
    this.debugLog('Updated client:', user.id);
    return this.transformUserRecord(user);
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
   * Retrieve saved payment methods.
   */
  async getPaymentMethods(clientId: string): Promise<HealthiePaymentMethod[]> {
    const query = `
      query GetClientPaymentMethods($clientId: ID!) {
        client(id: $clientId) {
          payment_methods {
            id
            type
            last_four
            is_default
            expires_at
          }
        }
      }
    `;

    const result = await this.graphql<{
      client: {
        payment_methods: Array<{
          id: string;
          type: string;
          last_four?: string | null;
          is_default?: boolean | null;
          expires_at?: string | null;
        }>;
      };
    }>(query, { clientId });

    return result.client.payment_methods ?? [];
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

  getTrtRegimenMetadataKey(): string {
    return this.trtRegimenKey;
  }

  getLastDispenseMetadataKey(): string {
    return this.lastDispenseKey;
  }
}

/**
 * Create a Healthie client from environment variables
 */
export function createHealthieClient(): HealthieClient | null {
  const apiKey = process.env.HEALTHIE_API_KEY;
  const apiUrl = process.env.HEALTHIE_API_URL;
  const trtRegimenMetadataKey = process.env.HEALTHIE_TRT_REGIMEN_META_KEY;
  const lastDispenseMetadataKey = process.env.HEALTHIE_LAST_DISPENSE_META_KEY;

  if (!apiKey) {
    console.warn('Healthie API key not configured');
    return null;
  }

  return new HealthieClient({
    apiKey,
    apiUrl,
    trtRegimenMetadataKey,
    lastDispenseMetadataKey,
  });
}


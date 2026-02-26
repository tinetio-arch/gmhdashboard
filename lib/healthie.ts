/**
  * Healthie API Client
    * Handles authentication and data operations with Healthie EMR API
      * 
 * NOTE: This implementation assumes Healthie uses a GraphQL API with API key authentication.
 * You may need to adjust the GraphQL queries / mutations based on the actual Healthie API documentation.
 * If Healthie uses REST instead of GraphQL, modify the `graphql()` method to use REST endpoints.
 * 
 * Healthie API Documentation: https://docs.gethealthie.com/
 * 
 * RATE LIMITING: All requests go through the centralized healthieRateLimiter (5 req/s)
 * to prevent credential-based lockouts (39+ burst requests → 30-60 min ban).
 */
import { healthieRateLimiter } from './healthieRateLimiter';

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
  user_group_id?: string;
  active?: boolean;
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
  active?: boolean;
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
  offering_name?: string;
  billing_frequency?: string;
  billing_items_count?: number;
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

export type HealthieBillingItem = {
  id: string;
  amount_paid: string | null;
  amount_paid_string: string | null;
  state: string | null;
  created_at: string | null;
  offering_name: string | null;
  payment_medium: string | null;
  shown_description: string | null;
  recipient_name: string | null;
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
   * 
   * RATE LIMITED: All requests pass through healthieRateLimiter (5 req/s)
   * with automatic 429 backoff and single retry.
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!this.config.apiKey) {
      throw new Error('Healthie API key is required');
    }

    const headers = {
      'Authorization': `Basic ${this.config.apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ query, variables });

    // Rate limit: wait for a token before making the request
    await healthieRateLimiter.acquire();

    let response = await fetch(this.apiUrl, { method: 'POST', headers, body });

    // Handle 429 rate limit: backoff and retry once
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      healthieRateLimiter.backoff(backoffMs);
      await healthieRateLimiter.acquire();
      response = await fetch(this.apiUrl, { method: 'POST', headers, body });
    }

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
      user_group_id: (user as any).user_group_id ?? undefined,
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

  private upsertUserDirectoryEntries(users: HealthieUserRecord[]): void {
    for (const user of users) {
      const normalizedUser = this.transformUserRecord(user);
      const emailKey = this.normalizeEmail(user.email);
      if (emailKey) {
        this.userDirectoryByEmail.set(emailKey, normalizedUser);
      }

      const phoneKey = this.normalizePhone(user.phone_number);
      if (phoneKey) {
        this.userDirectoryByPhone.set(phoneKey, normalizedUser);
      }
    }
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

      for (; ;) {
        const users = await this.fetchUsersPage({ offset, pageSize });
        if (!users.length) {
          break;
        }

        this.upsertUserDirectoryEntries(users);

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
      query Medications($patientId: String, $active: Boolean) {
        medications(patient_id: $patientId, active: $active) {
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

    try {
      const variables: Record<string, unknown> = { patientId: userId };
      if (typeof options?.active === 'boolean') {
        variables.active = options.active;
      }

      const result = await this.graphql<{ medications: HealthieMedication[] }>(query, variables);
      return result.medications ?? [];
    } catch (error) {
      this.debugLog('Error fetching medications:', error);
      return [];
    }
  }

  /**
 * Retrieve allergies for a user.
 */
  async getAllergies(userId: string): Promise<HealthieAllergy[]> {
    const query = `
    query AllergySensitivities($patientId: String) {
      allergySensitivities(patient_id: $patientId) {
        id
        name
        reaction
        severity
        notes
      }
    }
  `;

    try {
      const result = await this.graphql<{ allergySensitivities: HealthieAllergy[] }>(query, { patientId: userId });
      return result.allergySensitivities ?? [];
    } catch (error) {
      this.debugLog('Error fetching allergies:', error);
      return [];
    }
  }

  /**
   * Retrieve prescriptions for a user.
   */
  async getPrescriptions(userId: string, options?: { status?: string }): Promise<HealthiePrescription[]> {
    const query = `
      query Prescriptions($patientId: String, $status: String) {
        prescriptions(patient_id: $patientId, status: $status) {
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

    try {
      const variables: Record<string, unknown> = { patientId: userId };
      if (options?.status) {
        variables.status = options.status;
      }

      const result = await this.graphql<{ prescriptions: HealthiePrescription[] }>(query, variables);
      return result.prescriptions ?? [];
    } catch (error) {
      this.debugLog('Error fetching prescriptions:', error);
      return [];
    }
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

    const cached = this.userDirectoryByEmail.get(normalized);
    if (cached) {
      return cached;
    }

    const keywordResults = await this.fetchUsersPage({ offset: 0, pageSize: 50, keywords: email });
    if (keywordResults.length) {
      this.upsertUserDirectoryEntries(keywordResults);
      return this.userDirectoryByEmail.get(normalized) ?? null;
    }

    return null;
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

    const cached = this.userDirectoryByPhone.get(normalized);
    if (cached) {
      return cached;
    }

    const keywordResults = await this.fetchUsersPage({ offset: 0, pageSize: 50, keywords: phone });
    if (keywordResults.length) {
      this.upsertUserDirectoryEntries(keywordResults);
      return this.userDirectoryByPhone.get(normalized) ?? null;
    }

    return null;
  }

  /**
   * Search clients by name using Healthie's keywords search
   * Used for duplicate detection during patient creation
   */
  async searchClientsByName(name: string): Promise<HealthieClientData[]> {
    if (!name || name.trim().length < 2) {
      return [];
    }

    try {
      const results = await this.fetchUsersPage({ offset: 0, pageSize: 20, keywords: name.trim() });
      return results.map(user => this.transformUserRecord(user));
    } catch (error) {
      this.debugLog('Error searching clients by name:', error);
      return [];
    }
  }

  /**
   * Get client by ID
   */
  async getClient(clientId: string): Promise<HealthieClientData> {
    const query = `
      query GetClient($id: ID!) {
        user(id: $id) {
          id
          first_name
          last_name
          email
          phone_number
          dob
          user_group_id
          active
          created_at
          updated_at
        }
      }
    `;

    const result = await this.graphql<{
      user: HealthieClientData;
    }>(query, { id: clientId });

    return result.user;
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
    if (typeof input.active === 'boolean') payload.active = input.active;
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
  query GetClientSubscriptions($id: ID) {
    user(id: $id) {
      recurring_payments {
        id
        is_canceled
        is_paused
        start_at
        amount_to_pay
        next_payment_date
        offering_name
        billing_frequency
        billing_items_count
        created_at
        updated_at
      }
    }
  }
`;

    try {
      const result = await this.graphql<{
        user: {
          recurring_payments: Array<{
            id: string;
            is_canceled?: boolean;
            is_paused?: boolean;
            start_at?: string;
            amount_to_pay?: string;
            next_payment_date?: string;
            offering_name?: string;
            billing_frequency?: string;
            billing_items_count?: number;
            created_at?: string;
            updated_at?: string;
          }>;
        };
      }>(query, { id: clientId });

      return (result.user?.recurring_payments || []).map((rp) => {
        // Map real API fields to our interface for backward compatibility
        const status: 'active' | 'cancelled' | 'paused' | undefined =
          rp.is_canceled ? 'cancelled' : rp.is_paused ? 'paused' : 'active';
        return {
          id: rp.id,
          client_id: clientId,
          package_id: rp.offering_name ?? '',
          status,
          start_date: rp.start_at,
          next_charge_date: rp.next_payment_date,
          amount: rp.amount_to_pay ? parseFloat(rp.amount_to_pay) : undefined,
          offering_name: rp.offering_name,
          billing_frequency: rp.billing_frequency,
          billing_items_count: rp.billing_items_count,
          created_at: rp.created_at,
          updated_at: rp.updated_at,
        };
      });
    } catch (error) {
      this.debugLog('Error fetching subscriptions:', error);
      return [];
    }
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
    query GetClientPaymentMethods($id: ID) {
      user(id: $id) {
        stripe_customer_detail {
          card_brand
          last_four
          exp_month
          exp_year
        }
      }
    }
  `;

    try {
      const result = await this.graphql<{
        user: {
          stripe_customer_detail?: {
            card_brand?: string | null;
            last_four?: string | null;
            exp_month?: string | null;
            exp_year?: string | null;
          } | null;
        };
      }>(query, { id: clientId });

      const detail = result.user?.stripe_customer_detail;
      if (!detail || !detail.last_four) return [];

      return [{
        id: 'stripe-primary',
        type: detail.card_brand ?? 'Card',
        last_four: detail.last_four,
        is_default: true,
        expires_at: detail.exp_month && detail.exp_year ? `${detail.exp_month}/${detail.exp_year}` : null,
      }];
    } catch (error) {
      this.debugLog('Error fetching payment methods:', error);
      return [];
    }
  }

  /**
   * Get billing items for a client (payments, scheduled charges, etc.)
   */
  async getBillingItems(clientId: string, limit = 25): Promise<HealthieBillingItem[]> {
    const query = `
      query GetClientBillingItems($clientId: ID, $pageSize: Int) {
        billingItems(client_id: $clientId, page_size: $pageSize) {
          id
          amount_paid
          amount_paid_string
          state
          created_at
          offering {
            name
          }
          payment_medium
          shown_description
          recipient {
            full_name
          }
        }
      }
    `;

    try {
      console.log(`[Healthie] getBillingItems for clientId=${clientId}, limit=${limit}`);
      const result = await this.graphql<{
        billingItems: Array<{
          id: string;
          amount_paid: string | null;
          amount_paid_string: string | null;
          state: string | null;
          created_at: string | null;
          offering?: { name?: string | null } | null;
          payment_medium: string | null;
          shown_description: string | null;
          recipient?: { full_name?: string | null } | null;
        }>;
      }>(query, { clientId, pageSize: limit });

      const items = (result.billingItems || []).map((b) => ({
        id: b.id,
        amount_paid: b.amount_paid,
        amount_paid_string: b.amount_paid_string,
        state: b.state,
        created_at: b.created_at,
        offering_name: b.offering?.name ?? null,
        payment_medium: b.payment_medium,
        shown_description: b.shown_description,
        recipient_name: b.recipient?.full_name ?? null,
      }));
      console.log(`[Healthie] getBillingItems returned ${items.length} items`);
      return items;
    } catch (error: any) {
      console.error(`[Healthie] getBillingItems ERROR for clientId=${clientId}:`, error.message);
      return [];
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

  /**
   * Get documents for a patient
   */
  async getDocuments(userId: string): Promise<any[]> {
    const query = `
      query GetDocuments($userId: ID!) {
        documents(user_id: $userId) {
          id
          display_name
          file_type
          created_at
        }
      }
    `;

    try {
      const result = await this.graphql<{ documents: any[] }>(query, { userId });
      return result.documents ?? [];
    } catch (e) {
      this.debugLog('Error fetching documents:', e);
      return [];
    }
  }

  /**
   * Get form answer groups (submitted forms) for a patient
   */
  async getFormAnswerGroups(userId: string): Promise<any[]> {
    const query = `
      query GetFormAnswerGroups($userId: ID!) {
        formAnswerGroups(user_id: $userId, finished: true) {
          id
          custom_module_form {
            id
            name
          }
          created_at
        }
      }
    `;

    try {
      const result = await this.graphql<{ formAnswerGroups: any[] }>(query, { userId });
      return result.formAnswerGroups ?? [];
    } catch (e) {
      this.debugLog('Error fetching form answer groups:', e);
      return [];
    }
  }

  /**
   * Calculate patient data richness score
   * Higher score = more data, should be kept as master
   */
  async getPatientDataRichness(userId: string): Promise<{
    score: number;
    details: {
      documents: number;
      forms: number;
      medications: number;
      allergies: number;
      prescriptions: number;
    };
  }> {
    try {
      const [documents, forms, medications, allergies, prescriptions] = await Promise.all([
        this.getDocuments(userId),
        this.getFormAnswerGroups(userId),
        this.getMedications(userId),
        this.getAllergies(userId),
        this.getPrescriptions(userId),
      ]);

      const counts = {
        documents: documents.length,
        forms: forms.length,
        medications: medications.length,
        allergies: allergies.length,
        prescriptions: prescriptions.length,
      };

      // Weight: Documents are most important (user's priority)
      const score =
        counts.documents * 10 +      // Primary criterion
        counts.forms * 5 +            // Forms are valuable
        counts.medications * 3 +      // Clinical data
        counts.prescriptions * 3 +
        counts.allergies * 2;

      return { score, details: counts };
    } catch (e) {
      this.debugLog('Error calculating patient data richness:', e);
      return {
        score: 0,
        details: {
          documents: 0,
          forms: 0,
          medications: 0,
          allergies: 0,
          prescriptions: 0,
        },
      };
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


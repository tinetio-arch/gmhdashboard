/**
 * Go-High-Level (GHL) API Client
 * Handles authentication and data operations with Go-High-Level API
 */

const GHL_DEBUG_ENABLED = process.env.GHL_DEBUG === 'true';

function anonymizeEmail(email?: string | null): string {
  if (!email) return 'n/a';
  const [local, domain] = email.split('@');
  if (!domain) {
    return `${local?.slice(0, 2) ?? ''}***`;
  }
  const safeLocal = local ? `${local.slice(0, 2)}***` : '***';
  return `${safeLocal}@${domain}`;
}

function summarizePayload(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return 'payload=none';
  }
  const payload = body as Record<string, unknown>;
  const topLevelKeys = Object.keys(payload);
  const customFieldCount = Array.isArray((payload as any).customFields)
    ? (payload as any).customFields.length
    : 0;
  return `keys=${topLevelKeys.join(',') || 'none'}; customFields=${customFieldCount}`;
}

function contactSummary(contact: Partial<GHLContact> | null | undefined): string {
  if (!contact) return 'contact=undefined';
  const id =
    (contact as any)?.id ??
    (contact as any)?.contactId ??
    (contact as any)?._id ??
    (contact as any)?.contact_id ??
    'unknown';
  return `id=${id}; email=${anonymizeEmail(contact.email)}`;
}

export type GHLConfig = {
  apiKey: string;
  locationId?: string;
  baseUrl?: string;
};

export type GHLContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  locationId?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  tags?: string[];
  source?: string;
  assignedTo?: string;
  status?: string;
  customFields?: Array<{
    key?: string;
    id?: string;
    field?: string;
    value: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
};

export type GHLTag = {
  id: string;
  name: string;
  color?: string;
};

export type GHLOpportunity = {
  id: string;
  title: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  monetaryValue?: number;
  assignedTo?: string;
  contactId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type GHLContactFilter = {
  field: string;
  operator:
    | 'eq'
    | 'not_eq'
    | 'contains'
    | 'not_contains'
    | 'wildcard'
    | 'not_wildcard'
    | 'match'
    | 'not_match'
    | 'exists'
    | 'not_exists'
    | 'range'
    | 'contains_set'
    | 'contains_not_set'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'nested'
    | 'nested_not'
    | 'has_child'
    | 'has_parent';
  value?: unknown;
};

type GHLContactSearchResponse = {
  contacts?: GHLContact[];
  total?: number;
};

export class GHLClient {
  private config: GHLConfig;
  private baseUrl: string;
  private readonly debugEnabled: boolean;
  private locationAccessBlocked = false;
  private detectedLocationId?: string;

  constructor(config: GHLConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://services.leadconnectorhq.com';
    this.debugEnabled = GHL_DEBUG_ENABLED;
  }

  private debugLog(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.log(...args);
    }
  }

  getLocationId(): string | undefined {
    return this.config.locationId;
  }

  private requireLocationId(action: string): string | undefined {
    // Location ID is optional - GHL API keys are location-scoped
    // If not provided, the API will use the location from the API key
    return this.config.locationId;
  }

  private withLocation(path: string): string {
    if (!this.config.locationId || this.locationAccessBlocked) {
      return path;
    }
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}locationId=${encodeURIComponent(this.config.locationId)}`;
  }

  private withLocationPath(path: string): string {
    const locationId = this.requireLocationId('call this endpoint');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!locationId || this.locationAccessBlocked) {
      return normalizedPath;
    }
    return `/locations/${locationId}${normalizedPath}`;
  }

  private async detectAccessibleLocationId(): Promise<string | undefined> {
    if (this.detectedLocationId && !this.locationAccessBlocked) {
      return this.detectedLocationId;
    }

    try {
      const response = await fetch(`${this.baseUrl}/locations/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
      });

      if (!response.ok) {
        this.debugLog(`[GHL] Location discovery failed: ${response.status} ${response.statusText}`);
        return undefined;
      }

      const payload = await response.json();
      const candidate =
        payload?.data?.[0] ??
        payload?.locations?.[0] ??
        payload?.location ??
        payload?.[0];

      const locationId =
        candidate?.id ??
        candidate?.locationId ??
        candidate?.location_id ??
        candidate?.uid ??
        candidate?.value;

      if (locationId) {
        this.detectedLocationId = String(locationId);
        this.config.locationId = this.detectedLocationId;
        this.locationAccessBlocked = false;
        return this.detectedLocationId;
      }

      this.debugLog('[GHL] Location discovery returned no usable locations.');
    } catch (error) {
      this.debugLog(
        `[GHL] Location discovery encountered an error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return undefined;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    if (!this.config.apiKey) {
      throw new Error('GHL API key is required');
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };

    const executeFetch = async (targetUrl: URL) =>
      fetch(targetUrl.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

    const bodySummary = summarizePayload(body);

    if (method === 'PUT' && endpoint.includes('/contacts/') && this.debugEnabled) {
      this.debugLog(`[GHL] ${method} ${endpoint} (${bodySummary})`);
    }

    let response = await executeFetch(url);
    let responseText = await response.text();

    const locationAccessError =
      !response.ok &&
      response.status === 403 &&
      responseText.toLowerCase().includes('does not have access to this location');

    if (locationAccessError) {
      const refreshedLocationId = await this.detectAccessibleLocationId();

      if (refreshedLocationId) {
        if (url.pathname.includes('/locations/')) {
          url.pathname = url.pathname.replace(/\/locations\/[^/]+/, `/locations/${refreshedLocationId}`);
        }
        if (url.searchParams.has('locationId')) {
          url.searchParams.set('locationId', refreshedLocationId);
        }

        response = await executeFetch(url);
        responseText = await response.text();
      }

      if (
        (!response.ok || response.status === 403) &&
        responseText.toLowerCase().includes('does not have access to this location')
      ) {
        const retryUrl = new URL(url.toString());
        const hadLocationParam = retryUrl.searchParams.has('locationId');
        const hadLocationPath = retryUrl.pathname.includes('/locations/');

        console.warn(
          '[GHL] Location access still denied after refresh. Removing explicit location from subsequent requests.'
        );

        if (hadLocationParam) {
          retryUrl.searchParams.delete('locationId');
        }
        if (hadLocationPath) {
          retryUrl.pathname = retryUrl.pathname.replace(/\/locations\/[^/]+/, '');
          if (!retryUrl.pathname) {
            retryUrl.pathname = '/';
          }
        }

        this.locationAccessBlocked = true;
        this.config.locationId = undefined;

        response = await executeFetch(retryUrl);
        responseText = await response.text();
      }
    }
    
    if (!response.ok) {
      let errorMessage = `GHL API error: ${response.status} ${response.statusText}`;
      let errorDetails = '';
      
      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
        // Include validation errors if present
        if (errorJson.errors) {
          errorDetails = ` Errors: ${JSON.stringify(errorJson.errors)}`;
        }
        if (errorJson.validation) {
          errorDetails = ` Validation: ${JSON.stringify(errorJson.validation)}`;
        }
      } catch {
        errorMessage += ` - ${responseText}`;
      }

      const fullError = `${errorMessage}${errorDetails}`;
      console.error(`[GHL] ${method} ${endpoint} failed: ${fullError} (${bodySummary})`);
      if (body && this.debugEnabled) {
        this.debugLog(`[GHL] Request payload (debug):`, JSON.stringify(body, null, 2));
      }
      throw new Error(fullError);
    }

    let result: T;
    try {
      result = JSON.parse(responseText);
      if (method === 'PUT' && endpoint.includes('/contacts/') && this.debugEnabled) {
        this.debugLog(`[GHL] Response status: ${response.status}`);
        if ((result as any).customFields) {
          this.debugLog(`[GHL] Response customFields count: ${(result as any).customFields.length}`);
        }
      }
    } catch {
      throw new Error(`Failed to parse GHL API response: ${responseText.substring(0, 200)}`);
    }

    return result;
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<GHLContact> {
    return this.request<GHLContact>('GET', this.withLocation(`/contacts/${contactId}`));
  }

  /**
   * Search for contacts by email (case-insensitive)
   */
  async findContactByEmail(email: string): Promise<GHLContact | null> {
    if (!email) {
      return null;
    }

    try {
      // Try exact match first
      let contacts = await this.searchContacts([
        { field: 'email', operator: 'eq', value: email },
      ]);
      
      // If no exact match, try case-insensitive search
      if (contacts.length === 0) {
        contacts = await this.searchContacts([
          { field: 'email', operator: 'contains', value: email.toLowerCase() },
        ]);
      }
      
      if (contacts.length === 0) {
        return null;
      }
      
      // Find the best match (exact email match preferred)
      let contact = contacts.find(c => {
        const cEmail = (c.email || '').toLowerCase();
        return cEmail === email.toLowerCase();
      }) || contacts[0];
      
      // If contact is still wrapped in a 'contact' property, unwrap it
      if (contact && (contact as any).contact && !contact.id) {
        contact = (contact as any).contact;
      }
      
      this.debugLog(`[GHL] Found contact by email: ${contactSummary(contact)}`);
      
      // Extract ID from multiple possible locations
      const contactId = contact.id || 
                       (contact as any).contactId || 
                       (contact as any)._id || 
                       (contact as any).contact_id;
      
      if (contactId && !contact.id) {
        // Set the id field if we found it elsewhere
        contact.id = contactId;
      }
      
      if (!contact.id) {
        console.error(`[GHL] Contact found but missing ID field. Contact structure:`, JSON.stringify(contact, null, 2));
      }
      
      return contact;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for contacts by name (first and last name)
   */
  async findContactByName(firstName: string, lastName: string): Promise<GHLContact | null> {
    if (!firstName && !lastName) {
      return null;
    }

    try {
      const filters: GHLContactFilter[] = [];
      
      if (lastName) {
        filters.push({ field: 'lastName', operator: 'eq', value: lastName });
      }
      if (firstName) {
        filters.push({ field: 'firstName', operator: 'eq', value: firstName });
      }
      
      if (filters.length === 0) {
        return null;
      }

      const contacts = await this.searchContacts(filters);
      
      if (contacts.length === 0) {
        return null;
      }
      
      // Find the best match (both first and last name match preferred)
      let contact = contacts.find(c => {
        const cFirst = (c.firstName || '').toLowerCase().trim();
        const cLast = (c.lastName || '').toLowerCase().trim();
        const matchFirst = !firstName || cFirst === firstName.toLowerCase().trim();
        const matchLast = !lastName || cLast === lastName.toLowerCase().trim();
        return matchFirst && matchLast;
      }) || contacts[0];
      
      // If contact is still wrapped in a 'contact' property, unwrap it
      if (contact && (contact as any).contact && !contact.id) {
        contact = (contact as any).contact;
      }
      
      this.debugLog(`[GHL] Found contact by name: ${contactSummary(contact)}`);
      
      // Extract ID from multiple possible locations
      const contactId = contact.id || 
                       (contact as any).contactId || 
                       (contact as any)._id || 
                       (contact as any).contact_id;
      
      if (contactId && !contact.id) {
        contact.id = contactId;
      }
      
      return contact;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for contacts by phone
   */
  async findContactByPhone(phone: string): Promise<GHLContact | null> {
    if (!phone) {
      return null;
    }

    try {
      // Normalize phone number (remove non-digits)
      const normalizedPhone = phone.replace(/\D/g, '');
      if (!normalizedPhone) {
        return null;
      }

      const contacts = await this.searchContacts([
        { field: 'phone', operator: 'eq', value: normalizedPhone },
      ]);
      
      if (contacts.length === 0) {
        return null;
      }
      
      let contact = contacts[0];
      
      // If contact is still wrapped in a 'contact' property, unwrap it
      if (contact && (contact as any).contact && !contact.id) {
        contact = (contact as any).contact;
      }
      
      this.debugLog(`[GHL] Found contact by phone: ${contactSummary(contact)}`);
      
      // Extract ID from multiple possible locations
      const contactId = contact.id || 
                       (contact as any).contactId || 
                       (contact as any)._id || 
                       (contact as any).contact_id;
      
      if (contactId && !contact.id) {
        // Set the id field if we found it elsewhere
        contact.id = contactId;
      }
      
      if (!contact.id) {
        console.error(`[GHL] Contact found but missing ID field. Contact structure:`, JSON.stringify(contact, null, 2));
      }
      
      return contact;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new contact
   */
  async createContact(contact: Partial<GHLContact>): Promise<GHLContact> {
    return this.request<GHLContact>('POST', this.withLocation('/contacts/'), contact);
  }

  /**
   * Update an existing contact
   */
  async updateContact(contactId: string, updates: Partial<GHLContact>): Promise<GHLContact> {
    // Log the full payload being sent for debugging
    if (updates.customFields && updates.customFields.length > 0) {
      this.debugLog(`[GHL] Updating contact ${contactId} with ${updates.customFields.length} custom fields`);
    }
    const result = await this.request<GHLContact>('PUT', `/contacts/${contactId}`, updates);
    this.debugLog(`[GHL] Successfully updated contact ${contactId}. Response summary: ${contactSummary(result)}`);
    return result;
  }

  /**
   * Send an SMS message within Conversations.
   */
  async sendSms(contactId: string, body: string): Promise<{ id: string }> {
    if (!body || !body.trim()) {
      throw new Error('SMS body is required.');
    }
    return this.request<{ id: string }>(
      'POST',
      this.withLocationPath('/conversations/messages'),
      {
        contactId,
        type: 'SMS',
        message: body,
        body,
      }
    );
  }

  /**
   * Get all tags
   */
  async getTags(): Promise<GHLTag[]> {
    const response = await this.request<{ tags: GHLTag[] }>(
      'GET',
      this.withLocationPath('/tags')
    );
    return response.tags || [];
  }

  /**
   * Create or find a tag by name
   */
  async findOrCreateTag(tagName: string): Promise<GHLTag> {
    const tags = await this.getTags();
    const existingTag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
    
    if (existingTag) {
      return existingTag;
    }

    // Create new tag
    const newTag = await this.request<GHLTag>(
      'POST',
      this.withLocationPath('/tags'),
      { name: tagName }
    );
    return newTag;
  }

  /**
   * Create an opportunity for a contact
   */
  async createOpportunity(opportunity: Partial<GHLOpportunity>): Promise<GHLOpportunity> {
    return this.request<GHLOpportunity>('POST', '/opportunities/', opportunity);
  }

  /**
   * Create an appointment (Calendar API).
   */
  async createAppointment(appointment: {
    contactId: string;
    calendarId: string;
    appointmentTypeId?: string;
    startTime: string;
    endTime?: string;
    notes?: string;
    timeZone?: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'POST',
      this.withLocationPath('/appointments/'),
      {
        contactId: appointment.contactId,
        calendarId: appointment.calendarId,
        appointmentTypeId: appointment.appointmentTypeId,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        notes: appointment.notes,
        timeZone: appointment.timeZone,
      }
    );
  }

  async rescheduleAppointment(appointmentId: string, updates: { startTime?: string; endTime?: string; notes?: string }) {
    return this.request(
      'PUT',
      this.withLocationPath(`/appointments/${appointmentId}`),
      updates
    );
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    await this.request(
      'DELETE',
      this.withLocationPath(`/appointments/${appointmentId}`)
    );
  }

  /**
   * Get opportunities for a contact or location
   * Note: GHL API may require locationId and contactId in query params
   */
  async getOpportunities(filters?: {
    contactId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<GHLOpportunity[]> {
    const locationId = this.requireLocationId('get opportunities');
    if (!locationId) {
      throw new Error('Location ID required to get opportunities');
    }

    const params = new URLSearchParams();
    params.append('locationId', locationId);
    
    if (filters?.contactId) {
      params.append('contactId', filters.contactId);
    }
    if (filters?.status) {
      params.append('status', filters.status);
    }
    if (filters?.startDate) {
      params.append('startDate', filters.startDate);
    }
    if (filters?.endDate) {
      params.append('endDate', filters.endDate);
    }
    if (filters?.limit) {
      params.append('limit', String(filters.limit));
    }

    const endpoint = `/opportunities/?${params.toString()}`;
    const response = await this.request<{ opportunities?: GHLOpportunity[]; opportunity?: GHLOpportunity }>(
      'GET',
      endpoint
    );

    // GHL API may return opportunities in different formats
    if (Array.isArray(response)) {
      return response;
    }
    if (response.opportunities && Array.isArray(response.opportunities)) {
      return response.opportunities;
    }
    if (response.opportunity) {
      return [response.opportunity];
    }
    return [];
  }

  /**
   * Update contact status (e.g., mark as ineligible)
   */
  async updateContactStatus(contactId: string, status: string): Promise<GHLContact> {
    return this.updateContact(contactId, { status });
  }

  /**
   * Add a custom field value to a contact
   */
  async updateCustomField(contactId: string, fieldKey: string, value: string): Promise<GHLContact> {
    const contact = await this.getContact(contactId);
    const customFields = contact.customFields || [];
    
    const fieldIndex = customFields.findIndex(f => f.key === fieldKey);
    if (fieldIndex >= 0) {
      customFields[fieldIndex].value = value;
    } else {
      customFields.push({ key: fieldKey, value });
    }

    return this.updateContact(contactId, { customFields });
  }

  async searchContacts(filters: GHLContactFilter[], pageLimit = 1, page = 1): Promise<GHLContact[]> {
    const locationId = this.requireLocationId('search contacts');
    const response = await this.request<any>('POST', '/contacts/search', {
      locationId,
      page,
      pageLimit,
      filters,
    });

    // GHL API may return contacts in different formats:
    // 1. { contacts: [...] } - array of contacts
    // 2. { contact: {...} } - single contact object (most common for search)
    // 3. Array directly
    // 4. Array of objects with nested { contact: {...} } structure
    
    let contacts: any[] = [];
    
    // First, check if response itself is wrapped in 'contact' property (most common case)
    if (response.contact && !Array.isArray(response.contact)) {
      // Single contact wrapped in 'contact' property
      contacts = [response.contact];
    } else if (Array.isArray(response)) {
      contacts = response;
    } else if (response.contacts && Array.isArray(response.contacts)) {
      contacts = response.contacts;
    } else if (response.id) {
      // Single contact at root
      contacts = [response];
    } else {
      console.error('[GHL] Unexpected search response structure:', JSON.stringify(response, null, 2));
      return [];
    }
    
    // Unwrap nested contact structures: if array items have a 'contact' property, extract it
    const unwrappedContacts = contacts.map((item) => {
      // If the item itself is a contact (has id), return it
      if (item && (item.id || item.contactId)) {
        // Ensure id field is set
        if (!item.id && item.contactId) {
          item.id = item.contactId;
        }
        return item;
      }
      // If the item has a nested 'contact' property, extract it
      if (item && item.contact && (item.contact.id || item.contact.contactId)) {
        const contact = item.contact;
        if (!contact.id && contact.contactId) {
          contact.id = contact.contactId;
        }
        return contact;
      }
      // Otherwise return as-is
      console.warn('[GHL] Contact missing id/contactId:', JSON.stringify(item));
      return item;
    }).filter(item => item && (item.id || item.contactId)); // Filter out invalid contacts
    
    // Final safety check: ensure all contacts have an id field
    const validContacts = unwrappedContacts.map((contact) => {
      if (!contact.id && contact.contactId) {
        contact.id = contact.contactId;
      }
      return contact;
    });
    
    return validContacts;
  }
}

/**
 * Create a GHL client from environment variables
 */
export function createGHLClient(): GHLClient | null {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const baseUrl = process.env.GHL_BASE_URL;

  if (!apiKey) {
    console.warn('GHL API key not configured');
    return null;
  }

  return new GHLClient({
    apiKey,
    locationId,
    baseUrl,
  });
}





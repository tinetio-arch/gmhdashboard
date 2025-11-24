/**
 * Go-High-Level (GHL) API Client
 * Handles authentication and data operations with Go-High-Level API
 */

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
    key: string;
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

  constructor(config: GHLConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://services.leadconnectorhq.com';
  }

  getLocationId(): string | undefined {
    return this.config.locationId;
  }

  private requireLocationId(action: string): string {
    if (!this.config.locationId) {
      throw new Error(`GHL location ID is required to ${action}`);
    }
    return this.config.locationId;
  }

  private withLocation(path: string): string {
    if (!this.config.locationId) {
      return path;
    }
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}locationId=${encodeURIComponent(this.config.locationId)}`;
  }

  private withLocationPath(path: string): string {
    const locationId = this.requireLocationId('call this endpoint');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/locations/${locationId}${normalizedPath}`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    if (!this.config.apiKey) {
      throw new Error('GHL API key is required');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `GHL API error: ${response.status} ${response.statusText}`;
      let errorDetails = '';
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
        // Include validation errors if present
        if (errorJson.errors) {
          errorDetails = ` Errors: ${JSON.stringify(errorJson.errors)}`;
        }
        if (errorJson.validation) {
          errorDetails = ` Validation: ${JSON.stringify(errorJson.validation)}`;
        }
      } catch {
        errorMessage += ` - ${errorText}`;
      }

      const fullError = `${errorMessage}${errorDetails}`;
      console.error(`[GHL] ${method} ${endpoint} failed: ${fullError}`);
      if (body) {
        console.error(`[GHL] Request payload:`, JSON.stringify(body, null, 2));
      }
      throw new Error(fullError);
    }

    return response.json();
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<GHLContact> {
    return this.request<GHLContact>('GET', this.withLocation(`/contacts/${contactId}`));
  }

  /**
   * Search for contacts by email
   */
  async findContactByEmail(email: string): Promise<GHLContact | null> {
    if (!email) {
      return null;
    }

    try {
      const contacts = await this.searchContacts([
        { field: 'email', operator: 'eq', value: email },
      ]);
      return contacts[0] || null;
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
      return contacts[0] || null;
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
    return this.request<GHLContact>('PUT', `/contacts/${contactId}`, updates);
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

  private async searchContacts(filters: GHLContactFilter[], pageLimit = 1, page = 1): Promise<GHLContact[]> {
    const locationId = this.requireLocationId('search contacts');
    const response = await this.request<GHLContactSearchResponse>('POST', '/contacts/search', {
      locationId,
      page,
      pageLimit,
      filters,
    });

    return response.contacts || [];
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





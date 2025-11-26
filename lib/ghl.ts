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

  constructor(config: GHLConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://services.leadconnectorhq.com';
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

    // Log full request for PUT /contacts (updates)
    if (method === 'PUT' && endpoint.includes('/contacts/')) {
      console.log(`[GHL] ${method} ${endpoint}`);
      if (body) {
        const bodyStr = JSON.stringify(body, null, 2);
        console.log(`[GHL] Full request body:`, bodyStr);
        // Specifically log customFields if present
        if ((body as any).customFields) {
          console.log(`[GHL] Custom fields count: ${(body as any).customFields.length}`);
          (body as any).customFields.forEach((field: any, idx: number) => {
            console.log(`[GHL]   Custom field ${idx + 1}:`, JSON.stringify(field));
          });
        }
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    
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
      console.error(`[GHL] ${method} ${endpoint} failed: ${fullError}`);
      if (body) {
        console.error(`[GHL] Request payload:`, JSON.stringify(body, null, 2));
      }
      throw new Error(fullError);
    }

    let result: T;
    try {
      result = JSON.parse(responseText);
      // Log response for PUT /contacts
      if (method === 'PUT' && endpoint.includes('/contacts/')) {
        console.log(`[GHL] Response status: ${response.status}`);
        if ((result as any).customFields) {
          console.log(`[GHL] Response customFields count: ${(result as any).customFields.length}`);
          (result as any).customFields.slice(0, 5).forEach((field: any, idx: number) => {
            console.log(`[GHL]   Response field ${idx + 1}:`, JSON.stringify(field));
          });
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
      
      // Log the contact structure for debugging
      console.log(`[GHL] Found contact by email ${email}:`, JSON.stringify(contact, null, 2));
      
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
      
      console.log(`[GHL] Found contact by name ${firstName} ${lastName}:`, JSON.stringify(contact, null, 2));
      
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
      
      // Log the contact structure for debugging
      console.log(`[GHL] Found contact by phone ${phone}:`, JSON.stringify(contact, null, 2));
      
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
      console.log(`[GHL] Updating contact ${contactId} with ${updates.customFields.length} custom fields:`);
      updates.customFields.forEach((field, idx) => {
        console.log(`[GHL]   Field ${idx + 1}:`, JSON.stringify(field));
      });
    }
    const result = await this.request<GHLContact>('PUT', `/contacts/${contactId}`, updates);
    console.log(`[GHL] Successfully updated contact ${contactId}. Response customFields:`, result.customFields?.slice(0, 3));
    return result;
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





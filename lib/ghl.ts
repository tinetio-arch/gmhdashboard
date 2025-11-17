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

export class GHLClient {
  private config: GHLConfig;
  private baseUrl: string;

  constructor(config: GHLConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://services.leadconnectorhq.com';
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

    if (this.config.locationId) {
      headers['Location-Id'] = this.config.locationId;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `GHL API error: ${response.status} ${response.statusText}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage += ` - ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }

    return response.json();
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<GHLContact> {
    return this.request<GHLContact>('GET', `/contacts/${contactId}`);
  }

  /**
   * Search for contacts by email
   */
  async findContactByEmail(email: string): Promise<GHLContact | null> {
    try {
      const response = await this.request<{ contacts: GHLContact[] }>(
        'GET',
        `/contacts/?email=${encodeURIComponent(email)}`
      );
      return response.contacts?.[0] || null;
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
    try {
      // Normalize phone number (remove non-digits)
      const normalizedPhone = phone.replace(/\D/g, '');
      const response = await this.request<{ contacts: GHLContact[] }>(
        'GET',
        `/contacts/?phone=${encodeURIComponent(normalizedPhone)}`
      );
      return response.contacts?.[0] || null;
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
    return this.request<GHLContact>('POST', '/contacts/', contact);
  }

  /**
   * Update an existing contact
   */
  async updateContact(contactId: string, updates: Partial<GHLContact>): Promise<GHLContact> {
    return this.request<GHLContact>('PATCH', `/contacts/${contactId}`, updates);
  }

  /**
   * Add tags to a contact
   */
  async addTagsToContact(contactId: string, tagIds: string[]): Promise<void> {
    await this.request('PUT', `/contacts/${contactId}/tags`, { tagIds });
  }

  /**
   * Remove tags from a contact
   */
  async removeTagsFromContact(contactId: string, tagIds: string[]): Promise<void> {
    await this.request('DELETE', `/contacts/${contactId}/tags`, { tagIds });
  }

  /**
   * Get all tags
   */
  async getTags(): Promise<GHLTag[]> {
    const response = await this.request<{ tags: GHLTag[] }>('GET', '/tags/');
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
    const newTag = await this.request<GHLTag>('POST', '/tags/', { name: tagName });
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



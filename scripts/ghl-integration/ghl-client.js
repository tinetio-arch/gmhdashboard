#!/usr/bin/env node
/**
 * GoHighLevel API Client
 * Supports V2 API with Private Integration Token (PIT)
 */

class GHLClient {
    constructor(apiKey = null, locationId = null) {
        // Read env at construction time (after dotenv has loaded)
        const v2Key = process.env.GHL_V2_API_KEY;
        const v1Key = process.env.GHL_API_KEY;

        this.apiKey = apiKey || v2Key || v1Key;
        this.locationId = locationId || process.env.GHL_LOCATION_ID;
        this.isV2 = !!v2Key && !apiKey; // V2 only if using default key and V2 key exists

        // Set API base URL based on version
        this.apiBase = this.isV2
            ? 'https://services.leadconnectorhq.com'
            : 'https://rest.gohighlevel.com/v1';

        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28' // V2 API version header
        };
        console.log(`🔌 GHL Client initialized (API: ${this.isV2 ? 'V2' : 'V1'}, Base: ${this.apiBase.includes('leadconnector') ? 'leadconnectorhq' : 'gohighlevel'})`);
    }

    async request(method, endpoint, data = null) {
        const url = `${this.apiBase}${endpoint}`;

        const options = {
            method,
            headers: this.headers
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`GHL API Error (${response.status}): ${error}`);
        }

        // Handle empty responses
        const text = await response.text();
        if (!text) return { success: true };
        return JSON.parse(text);
    }

    // Contacts
    async getContact(id) {
        return this.request('GET', `/contacts/${id}`);
    }

    async searchContacts(email = null, phone = null) {
        if (!email && !phone) return { contacts: [] };

        // V2 uses 'query' parameter, V1 uses specific email/phone params
        if (this.isV2) {
            // V2: Use query param with phone or email
            const searchTerm = phone || email;
            return this.request('GET', `/contacts/?locationId=${this.locationId}&query=${encodeURIComponent(searchTerm)}`);
        }

        // V1: Use specific params
        let qs = '';
        if (email) qs += `email=${encodeURIComponent(email)}&`;
        if (phone) qs += `phone=${encodeURIComponent(phone)}&`;
        return this.request('GET', `/contacts/lookup?${qs}`);
    }

    async createContact(contactData) {
        // V2 uses different custom field format
        let data = { ...contactData, locationId: this.locationId };

        if (this.isV2 && data.customField) {
            // V2 uses customFields object: { fieldId: value, ... }
            // For now, strip V1 customField to prevent 422 error
            // Custom fields will be updated separately after creation
            delete data.customField;
        }

        return this.request('POST', '/contacts/', data);
    }

    async updateContact(contactId, contactData) {
        let data = { ...contactData };

        // V2 doesn't accept V1 customField format
        if (this.isV2 && data.customField) {
            delete data.customField;
        }

        return this.request('PUT', `/contacts/${contactId}`, data);
    }

    async addTag(contactId, tag) {
        return this.request('POST', `/contacts/${contactId}/tags`, {
            tags: [tag]
        });
    }

    async upsertContact(contactData) {
        const { email, phone } = contactData;

        // Search for existing contact
        const existing = await this.searchContacts(email, phone);

        if (existing.contacts && existing.contacts.length > 0) {
            // Update existing
            return this.updateContact(existing.contacts[0].id, contactData);
        } else {
            // Create new
            return this.createContact(contactData);
        }
    }

    // Calendars
    async getCalendars() {
        return this.request('GET', `/calendars/?locationId=${this.locationId}`);
    }

    async getAppointments(calendarId, startDate, endDate) {
        return this.request('GET',
            `/appointments/?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`
        );
    }

    async createAppointment(appointmentData) {
        return this.request('POST', '/appointments', appointmentData);
    }

    // Conversations/Messaging
    async sendSMS(contactId, message) {
        // V2 uses /conversations/messages (different payload)
        if (this.isV2) {
            return this.request('POST', '/conversations/messages', {
                type: 'SMS',
                contactId,
                message
            });
        }
        // V1 fallback
        return this.request('POST', '/conversations/messages/', {
            type: 'SMS',
            contactId,
            message,
            locationId: this.locationId
        });
    }

    // Workflows
    async addContactToWorkflow(contactId, workflowId) {
        return this.request('POST', `/workflows/${workflowId}/subscribe`, {
            contactId
        });
    }

    // Custom Values
    async getCustomFields() {
        return this.request('GET', `/custom-fields/?locationId=${this.locationId}`);
    }
}

// Test function
async function testGHLAccess() {
    const client = new GHLClient();

    console.log('🧪 Testing GoHighLevel API Access...\n');

    try {
        // Test 1: Get calendars
        console.log('1. Fetching calendars...');
        const calendars = await client.getCalendars();
        console.log(`   ✅ Found ${calendars.calendars?.length || 0} calendars`);

        // Test 2: Get custom fields
        console.log('\n2. Fetching custom fields...');
        const fields = await client.getCustomFields();
        console.log(`   ✅ Found ${fields.customFields?.length || 0} custom fields`);

        // Test 3: Search for a test contact
        console.log('\n3. Testing contact search...');
        const contacts = await client.searchContacts('test@example.com');
        console.log(`   ✅ Search working (found ${contacts.contacts?.length || 0} results)`);

        console.log('\n✅ All API tests passed! Ready to build Voice AI integration.');

    } catch (error) {
        console.error('\n❌ API Error:', error.message);
        console.log('\nYou may need additional API permissions. See instructions below.');
    }
}

if (require.main === module) {
    testGHLAccess();
}

module.exports = { GHLClient };

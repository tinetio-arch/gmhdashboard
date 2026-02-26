/**
 * Healthie API Integration Module
 */

import type { HealthieUpdateResult, PatientUpdateFields, ParsedUpdateCommand } from './types';
import { connectSnowflake } from './snowflake';

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

// ============================================================================
// GRAPHQL CLIENT
// ============================================================================
export async function fetchHealthieGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {}
): Promise<T | null> {
    if (!HEALTHIE_API_KEY) {
        console.log('[Healthie] No API key configured');
        return null;
    }

    try {
        const res = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Basic ${HEALTHIE_API_KEY}`,
                authorizationsource: 'API',
            },
            body: JSON.stringify({ query, variables }),
        });

        const json: any = await res.json();
        if (!res.ok || json.errors) {
            console.error('[Healthie] API Error:', JSON.stringify(json.errors || json));
            return null;
        }
        return json.data;
    } catch (e: any) {
        console.error('[Healthie] Fetch error:', e.message);
        return null;
    }
}

// ============================================================================
// READ OPERATIONS
// ============================================================================
export async function findHealthieUser(patientName: string): Promise<any | null> {
    const query = `
    query FindUser($keywords: String!) {
      users(keywords: $keywords, page_size: 5) {
        id
        email
        first_name
        last_name
        phone_number
        gender
        dob
        active_tags { id name }
        locations {
          id
          name
          line1
          line2
          city
          state
          zip
          country
        }
      }
    }
  `;
    const data = await fetchHealthieGraphQL<any>(query, { keywords: patientName });
    return data?.users?.[0] || null;
}

export async function fetchHealthieBillingItems(clientId: string): Promise<any[]> {
    const query = `
    query BillingItemsForClient($client_id: ID!) {
      billingItems(client_id: $client_id, page_size: 50) {
        id
        amount_paid
        state
        created_at
        sender { full_name }
        recipient { full_name }
        offering { name }
      }
    }
  `;
    const data = await fetchHealthieGraphQL<any>(query, { client_id: clientId });
    return data?.billingItems || [];
}

export async function fetchHealthieRequestedPayments(patientName: string, clientId: string): Promise<any[]> {
    const query = `
    query RequestedPayments($keywords: String!) {
      requestedPayments(keywords: $keywords, page_size: 50) {
        id
        price
        status
        created_at
        paid_at
        sender { id full_name }
        recipient { id full_name }
        offering { name }
      }
    }
  `;
    const data = await fetchHealthieGraphQL<any>(query, { keywords: patientName });
    return (data?.requestedPayments || []).filter((rp: any) => rp.recipient?.id === clientId);
}

// ============================================================================
// WRITE OPERATIONS
// ============================================================================
export async function updateHealthiePatient(
    healthieClientId: string,
    fields: PatientUpdateFields
): Promise<HealthieUpdateResult> {
    // Build the location object if any address fields are provided
    let location: any = null;
    if (fields.line1 || fields.line2 || fields.city || fields.state || fields.zip || fields.country) {
        location = {
            line1: fields.line1,
            line2: fields.line2,
            city: fields.city,
            state: fields.state,
            zip: fields.zip,
            country: fields.country || 'US'
        };
    }

    const mutation = `
    mutation UpdateClient($id: ID!, $first_name: String, $last_name: String, $email: String, 
                          $phone_number: String, $dob: String, $gender: String, 
                          $location: ClientLocationInput, $dietitian_id: String, 
                          $timezone: String, $quick_notes: String) {
      updateClient(input: {
        id: $id
        first_name: $first_name
        last_name: $last_name
        email: $email
        phone_number: $phone_number
        dob: $dob
        gender: $gender
        location: $location
        dietitian_id: $dietitian_id
        timezone: $timezone
        quick_notes: $quick_notes
      }) {
        user {
          id
          first_name
          last_name
          email
          phone_number
          dob
          gender
          location {
            line1
            line2
            city
            state
            zip
            country
          }
        }
        messages {
          field
          message
        }
      }
    }
  `;

    const variables: any = {
        id: healthieClientId,
        first_name: fields.first_name,
        last_name: fields.last_name,
        email: fields.email,
        phone_number: fields.phone_number,
        dob: fields.dob,
        gender: fields.gender,
        location: location,
        dietitian_id: fields.dietitian_id,
        timezone: fields.timezone,
        quick_notes: fields.quick_notes
    };

    // Remove undefined values
    Object.keys(variables).forEach(key => {
        if (variables[key] === undefined) delete variables[key];
    });

    console.log('[Healthie] Updating patient:', healthieClientId, 'with fields:', Object.keys(variables).filter(k => k !== 'id'));

    try {
        const result = await fetchHealthieGraphQL<any>(mutation, variables);

        if (!result) {
            return { success: false, errors: [{ field: 'api', message: 'API call failed' }] };
        }

        if (result.updateClient?.messages && result.updateClient.messages.length > 0) {
            return {
                success: false,
                errors: result.updateClient.messages
            };
        }

        return {
            success: true,
            user: result.updateClient?.user
        };
    } catch (e: any) {
        return { success: false, errors: [{ field: 'exception', message: e.message }] };
    }
}

// ============================================================================
// LOOKUP HELPERS
// ============================================================================
export async function findHealthieClientId(patientName: string): Promise<{
    healthieClientId: string | null;
    patientId: string | null;
    fullName: string | null;
}> {
    try {
        const conn = await connectSnowflake();
        const sql = `
      SELECT PATIENT_ID, PATIENT_NAME, HEALTHIE_CLIENT_ID
      FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW
      WHERE PATIENT_NAME ILIKE ?
      LIMIT 1
    `;

        const rows: any[] = await new Promise((resolve, reject) => {
            conn.execute({
                sqlText: sql,
                binds: [`%${patientName}%`],
                complete: (err: any, stmt: any, rows: any) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            });
        });

        conn.destroy(() => { });

        if (rows.length === 0) {
            return { healthieClientId: null, patientId: null, fullName: null };
        }

        return {
            healthieClientId: rows[0].HEALTHIE_CLIENT_ID,
            patientId: rows[0].PATIENT_ID,
            fullName: rows[0].PATIENT_NAME
        };
    } catch (error: any) {
        console.error('[Healthie] Error finding client ID:', error.message);
        return { healthieClientId: null, patientId: null, fullName: null };
    }
}

// ============================================================================
// UPDATE COMMAND PARSING
// ============================================================================
export function parseUpdateCommand(text: string): ParsedUpdateCommand | null {
    const updatePatterns = [
        /(?:update|change|set|modify)\s+(?:patient\s+)?(.+?)(?:'s)?\s+(address|phone|email|name|dob|gender)\s+(?:to|as|:)\s+(.+)/i,
        /(?:update|change|set|modify)\s+(.+?)(?:'s)?\s+(?:patient\s+)?(address|phone|email|name|dob|gender)\s+(?:to|as|:)\s+(.+)/i,
    ];

    for (const pattern of updatePatterns) {
        const match = text.match(pattern);
        if (match) {
            const patientName = match[1].trim();
            const updateType = match[2].toLowerCase() as 'address' | 'phone' | 'email' | 'name' | 'dob' | 'gender';
            const newValue = match[3].trim();

            const fields: PatientUpdateFields = {};

            switch (updateType) {
                case 'address':
                    const addressParts = newValue.match(/^(.+?),\s*(.+?),\s*(\w{2})\s+(\d{5}(?:-\d{4})?)$/);
                    if (addressParts) {
                        fields.line1 = addressParts[1];
                        fields.city = addressParts[2];
                        fields.state = addressParts[3];
                        fields.zip = addressParts[4];
                    } else {
                        fields.line1 = newValue;
                    }
                    break;
                case 'phone':
                    fields.phone_number = newValue.replace(/[^\d+]/g, '');
                    break;
                case 'email':
                    fields.email = newValue;
                    break;
                case 'name':
                    const nameParts = newValue.split(/\s+/);
                    if (nameParts.length >= 2) {
                        fields.first_name = nameParts[0];
                        fields.last_name = nameParts.slice(1).join(' ');
                    }
                    break;
                case 'dob':
                    fields.dob = newValue;
                    break;
                case 'gender':
                    fields.gender = newValue.toLowerCase();
                    break;
            }

            return {
                patientName,
                updateType,
                fields,
                rawText: text
            };
        }
    }

    return null;
}

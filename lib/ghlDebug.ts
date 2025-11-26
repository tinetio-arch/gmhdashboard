/**
 * Debug utility to see raw GHL API responses
 * This helps us understand the actual structure of GHL contact data
 */

import { createGHLClient } from './ghl';
import { query } from './db';

/**
 * Get raw GHL contact response to see actual structure
 */
export async function debugGHLContact(ghlContactId: string): Promise<{
  rawResponse: any;
  contactId: string;
  hasCustomFields: boolean;
  customFieldsStructure: any;
  allKeys: string[];
}> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }

  // Get contact using the client's internal request method
  // We need to see the raw response
  const locationId = (ghlClient as any).locationId;
  const apiKey = (ghlClient as any).apiKey;
  const baseUrl = (ghlClient as any).baseUrl || 'https://services.leadconnectorhq.com';

  const url = `${baseUrl}/contacts/${ghlContactId}`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(locationId ? { 'Version': '2021-07-28' } : {})
  };

  const response = await fetch(url, { headers });
  const rawResponse = await response.json();

  // Extract all possible keys from the response
  const allKeys = Object.keys(rawResponse);
  
  // Check for custom fields in various possible locations
  // Also check for ClinicSync Pro-specific patterns
  const customFieldsStructure = {
    direct: rawResponse.customFields,
    nested: rawResponse.contact?.customFields,
    inData: rawResponse.data?.customFields,
    inContact: rawResponse.contact,
    fullResponse: rawResponse,
    // ClinicSync Pro might store fields differently
    topLevelFinancialFields: Object.keys(rawResponse).filter(key => {
      const keyLower = key.toLowerCase();
      return keyLower.includes('amount') ||
             keyLower.includes('paid') ||
             keyLower.includes('balance') ||
             keyLower.includes('revenue') ||
             keyLower.includes('payment') ||
             keyLower.includes('invoice') ||
             keyLower.includes('visit') ||
             keyLower.includes('roi') ||
             keyLower.includes('owing');
    }).map(key => ({ key, value: rawResponse[key] }))
  };
  
  // Deep search for financial-related fields in nested objects
  const findAllFinancialFields = (obj: any, prefix = ''): Array<{path: string, value: any}> => {
    const fields: Array<{path: string, value: any}> = [];
    if (!obj || typeof obj !== 'object') return fields;
    
    Object.keys(obj).forEach(key => {
      const keyLower = key.toLowerCase();
      const fullPath = prefix ? `${prefix}.${key}` : key;
      
      if (
        keyLower.includes('amount') ||
        keyLower.includes('paid') ||
        keyLower.includes('balance') ||
        keyLower.includes('revenue') ||
        keyLower.includes('payment') ||
        keyLower.includes('invoice') ||
        keyLower.includes('visit') ||
        keyLower.includes('roi') ||
        keyLower.includes('owing')
      ) {
        fields.push({ path: fullPath, value: obj[key] });
      }
      
      // Recursively search nested objects (but limit depth)
      if (typeof obj[key] === 'object' && obj[key] !== null && prefix.split('.').length < 3) {
        fields.push(...findAllFinancialFields(obj[key], fullPath));
      }
    });
    
    return fields;
  };
  
  const deepFinancialFields = findAllFinancialFields(rawResponse);
  
  return {
    rawResponse,
    contactId: ghlContactId,
    hasCustomFields: !!(
      rawResponse.customFields ||
      rawResponse.contact?.customFields ||
      rawResponse.data?.customFields
    ),
    customFieldsStructure: {
      ...customFieldsStructure,
      deepFinancialFields
    },
    allKeys
  };
}

/**
 * Debug multiple Jane patients to see response structure
 */
export async function debugJanePatientsGHL(limit = 5): Promise<Array<{
  patientId: string;
  patientName: string;
  ghlContactId: string | null;
  debug: Awaited<ReturnType<typeof debugGHLContact>> | null;
  error?: string;
}>> {
  const patients = await query<{
    patient_id: string;
    patient_name: string;
    ghl_contact_id: string | null;
  }>(
    `SELECT patient_id, full_name as patient_name, ghl_contact_id
     FROM patients
     WHERE payment_method_key IN ('jane', 'jane_quickbooks')
       AND ghl_contact_id IS NOT NULL
       AND NOT (COALESCE(status_key, '') ILIKE 'inactive%' OR COALESCE(status_key, '') ILIKE 'discharg%')
     LIMIT $1`,
    [limit]
  );

  const results = [];

  for (const patient of patients) {
    if (!patient.ghl_contact_id) {
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        ghlContactId: null,
        debug: null
      });
      continue;
    }

    try {
      const debug = await debugGHLContact(patient.ghl_contact_id);
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        ghlContactId: patient.ghl_contact_id,
        debug
      });
    } catch (error) {
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        ghlContactId: patient.ghl_contact_id,
        debug: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}


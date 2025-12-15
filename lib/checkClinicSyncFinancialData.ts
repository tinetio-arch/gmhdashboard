/**
 * Check what financial data ClinicSync Pro webhooks are already sending us
 * This helps us understand what data ClinicSync Pro has access to
 */

import { query } from './db';

/**
 * Analyze ClinicSync Pro webhook payloads to see what financial data they contain
 */
export async function analyzeClinicSyncFinancialData(limit = 50): Promise<{
  totalWebhooks: number;
  webhooksWithFinancialData: number;
  financialFieldsFound: Set<string>;
  samplePayloads: Array<{
    clinicsyncPatientId: string;
    patientName: string;
    financialFields: Record<string, any>;
    rawPayload: any;
  }>;
  fieldFrequency: Record<string, number>;
}> {
  const webhooks = await query<{
    event_type: string;
    clinicsync_patient_id: string;
    payload: any;
    created_at: string;
  }>(
    `SELECT event_type, clinicsync_patient_id, payload, created_at
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  const financialFieldsFound = new Set<string>();
  const fieldFrequency: Record<string, number> = {};
  const samplePayloads: Array<{
    clinicsyncPatientId: string;
    patientName: string;
    financialFields: Record<string, any>;
    rawPayload: any;
  }> = [];
  
  let webhooksWithFinancialData = 0;

  webhooks.forEach(webhook => {
    const payload = typeof webhook.payload === 'string' 
      ? JSON.parse(webhook.payload) 
      : webhook.payload;
    
    const financialFields: Record<string, any> = {};
    
    // Look for financial-related fields in the payload
    const checkField = (key: string, value: any) => {
      const keyLower = key.toLowerCase();
      if (
        keyLower.includes('amount') ||
        keyLower.includes('paid') ||
        keyLower.includes('balance') ||
        keyLower.includes('revenue') ||
        keyLower.includes('payment') ||
        keyLower.includes('invoice') ||
        keyLower.includes('visit') ||
        keyLower.includes('roi') ||
        keyLower.includes('owing') ||
        keyLower.includes('total') ||
        keyLower.includes('claims') ||
        keyLower.includes('cost') ||
        keyLower.includes('price') ||
        keyLower.includes('fee')
      ) {
        financialFieldsFound.add(key);
        fieldFrequency[key] = (fieldFrequency[key] || 0) + 1;
        financialFields[key] = value;
      }
    };
    
    // Recursively search the payload for financial fields
    const searchObject = (obj: any, prefix = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.keys(obj).forEach(key => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        checkField(fullKey, value);
        
        // Recursively search nested objects (limit depth to 3 levels)
        if (typeof value === 'object' && value !== null && prefix.split('.').length < 3) {
          searchObject(value, fullKey);
        }
      });
    };
    
    searchObject(payload);
    
    if (Object.keys(financialFields).length > 0) {
      webhooksWithFinancialData++;
      
      if (samplePayloads.length < 10) {
        samplePayloads.push({
          clinicsyncPatientId: webhook.clinicsync_patient_id,
          patientName: payload.name || payload.patient_name || payload.first_name + ' ' + payload.last_name || 'Unknown',
          financialFields,
          rawPayload: payload
        });
      }
    }
  });

  return {
    totalWebhooks: webhooks.length,
    webhooksWithFinancialData,
    financialFieldsFound,
    samplePayloads,
    fieldFrequency
  };
}










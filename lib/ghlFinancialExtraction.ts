/**
 * GHL Financial Data Extraction
 * Investigate and extract Jane payment data from GoHighLevel
 */

import { createGHLClient, type GHLClient, type GHLContact, type GHLOpportunity } from './ghl';
import { query } from './db';

export type JanePaymentFromGHL = {
  patientId: string;
  patientName: string;
  ghlContactId: string;
  paymentDate: string | null;
  paymentAmount: number;
  paymentType: string | null;
  source: 'GHL Custom Fields' | 'GHL Opportunities' | 'GHL Webhook';
  rawData?: any;
};

export type FinancialDataExtracted = {
  contactId: string;
  patientId: string | null;
  customFields: Array<{ key: string; value: string }>;
  opportunities: Array<{ id: string; amount: number; date: string }>;
  totalRevenue: number;
};

/**
 * Extract financial data from a GHL contact's custom fields
 * Includes ClinicSync Pro-specific field patterns
 */
function extractFinancialDataFromContact(contact: GHLContact): {
  membershipBalance?: number;
  membershipOwes?: number;
  lastPaymentAmount?: number;
  lastPaymentDate?: string;
  totalPaid?: number;
  totalAmountPaid?: number;
  totalUnpaidBalance?: number;
  paymentHistory?: string;
  revenue?: number;
  roi?: number;
  [key: string]: any;
} {
  const customFields = contact.customFields || [];
  const financial: any = {};
  
  // Also check top-level contact properties (GHL might store fields there)
  const contactObj = contact as any;
  
  customFields.forEach(field => {
    const key = (field.key || field.id || field.field || '').toLowerCase();
    const value = field.value;
    
    // Look for payment/balance/revenue related fields (including ClinicSync Pro patterns)
    if (
      key.includes('payment') || 
      key.includes('revenue') || 
      key.includes('amount') || 
      key.includes('balance') ||
      key.includes('paid') ||
      key.includes('charge') ||
      key.includes('total') ||
      key.includes('roi') ||
      key.includes('visit') ||
      key.includes('invoice') ||
      key.includes('unpaid') ||
      key.includes('owing') ||
      key.includes('claims')
    ) {
      // Try to parse as number
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        financial[key] = numValue;
      } else {
        financial[key] = value;
      }
    }
    
    // Look for date fields
    if (key.includes('date') || key.includes('charge')) {
      financial[key] = value;
    }
  });
  
  // Check top-level contact properties for ClinicSync Pro fields
  // ClinicSync Pro might store fields directly on the contact object
  const topLevelFields = [
    'total_amount_paid', 'totalAmountPaid', 'total_amountpaid',
    'total_unpaid_balance', 'totalUnpaidBalance', 'total_unpaidbalance',
    'total_revenue', 'totalRevenue', 'total_revenue',
    'outstanding_balance', 'outstandingBalance',
    'amount_owing', 'amountOwing',
    'claims_amount_owing', 'claimsAmountOwing',
    'last_payment_amount', 'lastPaymentAmount',
    'last_payment_date', 'lastPaymentDate',
    'appointments_count', 'appointmentsCount', 'total_visits', 'totalVisits',
    'roi', 'return_on_investment', 'returnOnInvestment'
  ];
  
  topLevelFields.forEach(fieldName => {
    if (contactObj[fieldName] !== undefined && contactObj[fieldName] !== null) {
      const value = contactObj[fieldName];
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        financial[fieldName] = numValue;
      } else {
        financial[fieldName] = value;
      }
    }
  });
  
  return financial;
}

/**
 * Get all custom fields from a contact (for investigation)
 */
export async function investigateGHLContact(ghlContactId: string): Promise<{
  contact: GHLContact;
  financialData: ReturnType<typeof extractFinancialDataFromContact>;
  allCustomFields: Array<{ key: string; id: string; field: string; value: string }>;
}> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }
  
  const contact = await ghlClient.getContact(ghlContactId);
  const financialData = extractFinancialDataFromContact(contact);
  
  const allCustomFields = (contact.customFields || []).map(field => ({
    key: field.key || '',
    id: field.id || '',
    field: field.field || '',
    value: field.value || ''
  }));
  
  return {
    contact,
    financialData,
    allCustomFields
  };
}

/**
 * Investigate a sample of Jane patients in GHL
 * This helps us understand what financial data Jane is sending
 */
export async function investigateJanePatientsInGHL(limit = 10): Promise<Array<{
  patientId: string;
  patientName: string;
  ghlContactId: string | null;
  financialData: ReturnType<typeof extractFinancialDataFromContact>;
  allCustomFields: Array<{ key: string; value: string }>;
}>> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }
  
  // Get Jane patients with GHL contact IDs
  const patients = await query<{
    patient_id: string;
    patient_name: string;
    ghl_contact_id: string | null;
  }>(
    `SELECT patient_id, full_name as patient_name, ghl_contact_id
     FROM patients
     WHERE payment_method_key IN ('jane', 'jane_quickbooks')
       AND ghl_contact_id IS NOT NULL
     LIMIT $1`,
    [limit]
  );
  
  const results = [];
  
  for (const patient of patients) {
    if (!patient.ghl_contact_id) continue;
    
    try {
      const contact = await ghlClient.getContact(patient.ghl_contact_id);
      const financialData = extractFinancialDataFromContact(contact);
      // Get all custom fields, including checking if they're stored elsewhere
      const customFieldsArray = contact.customFields || [];
      const allCustomFields = customFieldsArray.map(field => ({
        key: field.key || field.id || field.field || 'unknown',
        value: field.value || ''
      }));
      
      // Also check if custom fields are stored in a different structure
      // ClinicSync Pro might store them differently
      const contactObj = contact as any;
      if (contactObj.customFields && !Array.isArray(contactObj.customFields)) {
        // Custom fields might be an object instead of array
        Object.keys(contactObj.customFields).forEach(key => {
          allCustomFields.push({
            key,
            value: String(contactObj.customFields[key] || '')
          });
        });
      }
      
      // Check for fields stored directly on contact (ClinicSync Pro pattern)
      const potentialFields = Object.keys(contactObj).filter(key => 
        key.toLowerCase().includes('amount') ||
        key.toLowerCase().includes('paid') ||
        key.toLowerCase().includes('balance') ||
        key.toLowerCase().includes('revenue') ||
        key.toLowerCase().includes('payment') ||
        key.toLowerCase().includes('invoice') ||
        key.toLowerCase().includes('visit') ||
        key.toLowerCase().includes('roi')
      );
      
      potentialFields.forEach(key => {
        if (!allCustomFields.find(f => f.key === key)) {
          allCustomFields.push({
            key,
            value: String(contactObj[key] || '')
          });
        }
      });
      
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        ghlContactId: patient.ghl_contact_id,
        financialData,
        allCustomFields
      });
    } catch (error) {
      console.error(`Failed to get GHL contact for patient ${patient.patient_id}:`, error);
    }
  }
  
  return results;
}

/**
 * Check if GHL has opportunities API and query for Jane patients
 */
export async function investigateGHLOpportunities(patientIds: string[]): Promise<Array<{
  patientId: string;
  ghlContactId: string;
  opportunities: GHLOpportunity[];
  totalRevenue: number;
}>> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }
  
  // Get GHL contact IDs for these patients
  const patients = await query<{
    patient_id: string;
    ghl_contact_id: string | null;
  }>(
    `SELECT patient_id, ghl_contact_id
     FROM patients
     WHERE patient_id = ANY($1)
       AND ghl_contact_id IS NOT NULL`,
    [patientIds]
  );
  
  const results = [];
  
  // Get opportunities for last 12 months
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);
  
  for (const patient of patients) {
    if (!patient.ghl_contact_id) continue;
    
    try {
      const opportunities = await ghlClient.getOpportunities({
        contactId: patient.ghl_contact_id,
        status: 'won', // Only get completed/won opportunities
        startDate: startDate.toISOString().split('T')[0],
        limit: 100
      });
      
      const totalRevenue = opportunities.reduce((sum, opp) => {
        return sum + (opp.monetaryValue || 0);
      }, 0);
      
      results.push({
        patientId: patient.patient_id,
        ghlContactId: patient.ghl_contact_id,
        opportunities,
        totalRevenue
      });
    } catch (error) {
      console.error(`Failed to get opportunities for patient ${patient.patient_id}:`, error);
      // Still add the result with empty opportunities
      results.push({
        patientId: patient.patient_id,
        ghlContactId: patient.ghl_contact_id,
        opportunities: [],
        totalRevenue: 0
      });
    }
  }
  
  return results;
}

/**
 * Search GHL for contacts with Jane-related tags or custom fields
 * This helps find all Jane patients in GHL
 */
export async function findJaneContactsInGHL(): Promise<GHLContact[]> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }
  
  // Search for contacts with "Jane" in payment method custom field
  const contacts = await ghlClient.searchContacts([
    { field: 'method_of_payment', operator: 'contains', value: 'Jane' }
  ], 1000, 1);
  
  return contacts;
}

/**
 * Comprehensive deep dive into Jane financial data in GHL
 * This function investigates multiple data sources to understand what Jane is sending
 */
export async function deepDiveJaneFinancialData(limit = 20): Promise<{
  summary: {
    totalPatientsInvestigated: number;
    patientsWithGHLContacts: number;
    patientsWithFinancialData: number;
    patientsWithOpportunities: number;
    totalRevenueFromOpportunities: number;
  };
  customFieldsAnalysis: {
    allFieldKeys: string[];
    financialFieldKeys: string[];
    fieldFrequency: Record<string, number>;
    sampleValues: Record<string, string[]>;
  };
  opportunitiesAnalysis: {
    totalOpportunities: number;
    totalRevenue: number;
    opportunitiesByStatus: Record<string, number>;
    sampleOpportunities: Array<{
      patientId: string;
      patientName: string;
      opportunityId: string;
      amount: number;
      status: string;
      date: string;
    }>;
  };
  patientDetails: Array<{
    patientId: string;
    patientName: string;
    ghlContactId: string | null;
    customFields: Array<{ key: string; value: string }>;
    financialFields: Record<string, any>;
    opportunities: Array<{
      id: string;
      amount: number;
      status: string;
      date: string;
    }>;
    totalRevenueFromOpportunities: number;
  }>;
}> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }

  // Get Jane patients
  const patients = await query<{
    patient_id: string;
    patient_name: string;
    ghl_contact_id: string | null;
  }>(
    `SELECT patient_id, full_name as patient_name, ghl_contact_id
     FROM patients
     WHERE payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(status_key, '') ILIKE 'inactive%' OR COALESCE(status_key, '') ILIKE 'discharg%')
     ORDER BY patient_name
     LIMIT $1`,
    [limit]
  );

  const allFieldKeys = new Set<string>();
  const financialFieldKeys = new Set<string>();
  const fieldFrequency = new Map<string, number>();
  const sampleValues = new Map<string, string[]>();
  const opportunitiesByStatus = new Map<string, number>();
  
  let patientsWithGHLContacts = 0;
  let patientsWithFinancialData = 0;
  let patientsWithOpportunities = 0;
  let totalRevenueFromOpportunities = 0;
  
  const patientDetails = [];
  const sampleOpportunities: Array<{
    patientId: string;
    patientName: string;
    opportunityId: string;
    amount: number;
    status: string;
    date: string;
  }> = [];

  // Get opportunities for last 12 months
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);

  for (const patient of patients) {
    const detail: any = {
      patientId: patient.patient_id,
      patientName: patient.patient_name,
      ghlContactId: patient.ghl_contact_id,
      customFields: [],
      financialFields: {},
      opportunities: [],
      totalRevenueFromOpportunities: 0
    };

    if (!patient.ghl_contact_id) {
      patientDetails.push(detail);
      continue;
    }

    patientsWithGHLContacts++;

    try {
      // Get contact and custom fields
      const contact = await ghlClient.getContact(patient.ghl_contact_id);
      const customFields = contact.customFields || [];
      
      detail.customFields = customFields.map(field => ({
        key: field.key || field.id || field.field || 'unknown',
        value: field.value || ''
      }));

      // Extract financial data
      const financialData = extractFinancialDataFromContact(contact);
      detail.financialFields = financialData;
      
      if (Object.keys(financialData).length > 0) {
        patientsWithFinancialData++;
      }

      // Analyze all custom fields
      customFields.forEach(field => {
        const key = field.key || field.id || field.field || 'unknown';
        allFieldKeys.add(key);
        
        // Track financial-related fields
        const keyLower = key.toLowerCase();
        if (
          keyLower.includes('payment') ||
          keyLower.includes('revenue') ||
          keyLower.includes('amount') ||
          keyLower.includes('balance') ||
          keyLower.includes('paid') ||
          keyLower.includes('charge') ||
          keyLower.includes('total') ||
          keyLower.includes('cost') ||
          keyLower.includes('price') ||
          keyLower.includes('fee')
        ) {
          financialFieldKeys.add(key);
        }
        
        // Count frequency
        fieldFrequency.set(key, (fieldFrequency.get(key) || 0) + 1);
        
        // Store sample values
        if (!sampleValues.has(key)) {
          sampleValues.set(key, []);
        }
        const samples = sampleValues.get(key)!;
        if (samples.length < 3 && field.value) {
          samples.push(field.value);
        }
      });

      // Get opportunities
      try {
        const opportunities = await ghlClient.getOpportunities({
          contactId: patient.ghl_contact_id,
          startDate: startDate.toISOString().split('T')[0],
          limit: 100
        });

        if (opportunities.length > 0) {
          patientsWithOpportunities++;
        }

        opportunities.forEach(opp => {
          const amount = opp.monetaryValue || 0;
          const status = opp.status || 'unknown';
          
          detail.opportunities.push({
            id: opp.id,
            amount,
            status,
            date: opp.createdAt || opp.updatedAt || ''
          });

          detail.totalRevenueFromOpportunities += amount;
          totalRevenueFromOpportunities += amount;

          // Track by status
          opportunitiesByStatus.set(status, (opportunitiesByStatus.get(status) || 0) + 1);

          // Store sample opportunities (up to 10)
          if (sampleOpportunities.length < 10 && amount > 0) {
            sampleOpportunities.push({
              patientId: patient.patient_id,
              patientName: patient.patient_name,
              opportunityId: opp.id,
              amount,
              status,
              date: opp.createdAt || opp.updatedAt || ''
            });
          }
        });
      } catch (oppError) {
        console.error(`Failed to get opportunities for patient ${patient.patient_id}:`, oppError);
        // Continue even if opportunities fail
      }

    } catch (error) {
      console.error(`Failed to investigate patient ${patient.patient_id}:`, error);
    }

    patientDetails.push(detail);
  }

  return {
    summary: {
      totalPatientsInvestigated: patients.length,
      patientsWithGHLContacts,
      patientsWithFinancialData,
      patientsWithOpportunities,
      totalRevenueFromOpportunities
    },
    customFieldsAnalysis: {
      allFieldKeys: Array.from(allFieldKeys).sort(),
      financialFieldKeys: Array.from(financialFieldKeys).sort(),
      fieldFrequency: Object.fromEntries(fieldFrequency),
      sampleValues: Object.fromEntries(
        Array.from(sampleValues.entries()).map(([key, values]) => [
          key,
          values.slice(0, 3) // Limit to 3 samples
        ])
      )
    },
    opportunitiesAnalysis: {
      totalOpportunities: patientDetails.reduce((sum, p) => sum + p.opportunities.length, 0),
      totalRevenue: totalRevenueFromOpportunities,
      opportunitiesByStatus: Object.fromEntries(opportunitiesByStatus),
      sampleOpportunities
    },
    patientDetails
  };
}

/**
 * Extract all financial custom fields from a batch of contacts
 * Useful for understanding what data Jane is sending
 */
export async function extractFinancialFieldsFromContacts(contacts: GHLContact[]): Promise<{
  allFieldKeys: Set<string>;
  fieldFrequency: Map<string, number>;
  sampleValues: Map<string, string[]>;
}> {
  const allFieldKeys = new Set<string>();
  const fieldFrequency = new Map<string, number>();
  const sampleValues = new Map<string, string[]>();
  
  contacts.forEach(contact => {
    const customFields = contact.customFields || [];
    
    customFields.forEach(field => {
      const key = field.key || field.id || field.field || 'unknown';
      allFieldKeys.add(key);
      
      // Count frequency
      fieldFrequency.set(key, (fieldFrequency.get(key) || 0) + 1);
      
      // Store sample values (up to 5 per field)
      if (!sampleValues.has(key)) {
        sampleValues.set(key, []);
      }
      const samples = sampleValues.get(key)!;
      if (samples.length < 5 && field.value) {
        samples.push(field.value);
      }
    });
  });
  
  return {
    allFieldKeys,
    fieldFrequency,
    sampleValues
  };
}


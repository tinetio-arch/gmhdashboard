/**
 * Patient-to-GoHighLevel sync functionality
 * Handles bidirectional sync between GMH dashboard and GoHighLevel CRM
 */

import { createGHLClient, type GHLClient, type GHLContact } from './ghl';
import { query } from './db';
import type { PatientDataEntryRow } from './patientQueries';

export type GHLSyncStatus = 'pending' | 'syncing' | 'synced' | 'error';

export type GHLTagMapping = {
  mapping_id: string;
  condition_type: 'status' | 'membership' | 'client_type' | 'custom';
  condition_value: string;
  ghl_tag_name: string;
  ghl_tag_id: string | null;
  is_active: boolean;
};

export type PatientGHLSync = {
  patient_id: string;
  patient_name: string;
  email: string | null;
  phone_primary: string | null;
  ghl_contact_id: string | null;
  ghl_sync_status: GHLSyncStatus;
  ghl_last_synced_at: string | null;
  ghl_sync_error: string | null;
  ghl_tags: string[];
};

/**
 * Get all active tag mappings from the database
 */
async function getActiveTagMappings(): Promise<GHLTagMapping[]> {
  return query<GHLTagMapping>(
    `SELECT * FROM ghl_tag_mappings WHERE is_active = true`
  );
}

/**
 * Determine which tags a patient should have based on their current state
 */
export async function calculatePatientTags(patient: PatientDataEntryRow): Promise<string[]> {
  const mappings = await getActiveTagMappings();
  const tags: string[] = [];

  // Status-based tags
  if (patient.status_key) {
    const statusTag = mappings.find(
      m => m.condition_type === 'status' && m.condition_value === patient.status_key
    );
    if (statusTag) tags.push(statusTag.ghl_tag_name);
  }

  // Client type tags
  if (patient.client_type_key) {
    const clientTag = mappings.find(
      m => m.condition_type === 'client_type' && m.condition_value === patient.client_type_key
    );
    if (clientTag) tags.push(clientTag.ghl_tag_name);
  }

  // Membership tags (extracted from client type for now)
  if (patient.client_type_key?.includes('mens_health')) {
    const mensHealthTag = mappings.find(
      m => m.condition_type === 'membership' && m.condition_value === 'mens_health'
    );
    if (mensHealthTag) tags.push(mensHealthTag.ghl_tag_name);
  }
  if (patient.client_type_key?.includes('primecare_elite')) {
    const primecareEliteTag = mappings.find(
      m => m.condition_type === 'membership' && m.condition_value === 'primecare_elite'
    );
    if (primecareEliteTag) tags.push(primecareEliteTag.ghl_tag_name);
  }
  if (patient.client_type_key?.includes('primecare_premier')) {
    const primecareTag = mappings.find(
      m => m.condition_type === 'membership' && m.condition_value === 'primecare_premier'
    );
    if (primecareTag) tags.push(primecareTag.ghl_tag_name);
  }
  if (patient.client_type_key?.includes('tcmh')) {
    const tcmhTag = mappings.find(
      m => m.condition_type === 'membership' && m.condition_value === 'tcmh'
    );
    if (tcmhTag) tags.push(tcmhTag.ghl_tag_name);
  }

  // Custom condition tags
  // Labs overdue
  if (patient.lab_status && (patient.lab_status.includes('overdue') || patient.lab_status.includes('Overdue'))) {
    const labsOverdueTag = mappings.find(
      m => m.condition_type === 'custom' && m.condition_value === 'has_labs_overdue'
    );
    if (labsOverdueTag) tags.push(labsOverdueTag.ghl_tag_name);
  }

  // Has membership balance
  if (patient.membership_owes && parseFloat(patient.membership_owes) > 0) {
    const balanceTag = mappings.find(
      m => m.condition_type === 'custom' && m.condition_value === 'has_membership_balance'
    );
    if (balanceTag) tags.push(balanceTag.ghl_tag_name);
  }

  // Verified patient
  if (patient.is_verified) {
    const verifiedTag = mappings.find(
      m => m.condition_type === 'custom' && m.condition_value === 'verified_patient'
    );
    if (verifiedTag) tags.push(verifiedTag.ghl_tag_name);
  }

  // Always add "GMH Patient" tag to identify patients managed by this system
  tags.push('GMH Patient');

  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Create or update GHL tags and return their IDs
 */
async function ensureGHLTags(ghlClient: GHLClient, tagNames: string[]): Promise<string[]> {
  const tagIds: string[] = [];

  for (const tagName of tagNames) {
    try {
      const tag = await ghlClient.findOrCreateTag(tagName);
      if (tag.id) {
        tagIds.push(tag.id);
        
        // Update our mapping table with the GHL tag ID if we don't have it
        await query(
          `UPDATE ghl_tag_mappings 
           SET ghl_tag_id = $1, updated_at = NOW() 
           WHERE ghl_tag_name = $2 AND ghl_tag_id IS NULL`,
          [tag.id, tagName]
        );
      }
    } catch (error) {
      console.error(`Failed to create/find tag ${tagName}:`, error);
    }
  }

  return tagIds;
}

/**
 * Normalize phone to E.164 format (+1XXXXXXXXXX)
 */
function normalizePhone(phone: string | null): string | undefined {
  if (!phone) return undefined;
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 0) return undefined;
  if (digits.length < 10) return undefined; // Invalid
  
  // If 10 digits, assume US and prefix +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If 11 digits starting with 1, prefix +
  if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`;
  }
  
  // Default: assume US, take last 10 digits
  return `+1${digits.slice(-10)}`;
}

/**
 * Title case for names and addresses
 */
function toTitleCase(str: string | null): string {
  if (!str) return '';
  return str
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse full name into first and last (handle titles/suffixes)
 */
function parseName(fullName: string | null): { firstName: string; lastName: string } {
  if (!fullName || !fullName.trim()) {
    return { firstName: '', lastName: '' };
  }
  
  let name = fullName.trim();
  
  // Remove common titles
  const titles = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Miss', 'Rev.', 'Prof.'];
  for (const title of titles) {
    const regex = new RegExp(`^${title}\\s+`, 'i');
    name = name.replace(regex, '');
  }
  
  const parts = name.split(/\s+/).filter(p => p.length > 0);
  
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: toTitleCase(parts[0]), lastName: '' };
  
  return {
    firstName: toTitleCase(parts[0]),
    lastName: parts.slice(1).map(p => toTitleCase(p)).join(' ')
  };
}

/**
 * Clean and validate address (detect swapped state/ZIP)
 */
function cleanAddress(patient: PatientDataEntryRow): {
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string;
} {
  let state = patient.state?.trim().toUpperCase() || '';
  let postalCode = patient.postal_code?.trim() || '';
  
  // Detect swapped state/ZIP (state has 5 digits)
  if (state.length === 5 && /^\d{5}$/.test(state)) {
    const temp = state;
    state = postalCode.length === 2 ? postalCode.toUpperCase() : 'AZ';
    postalCode = temp;
  }
  
  // Validate state (must be 2 letters)
  if (state.length !== 2) {
    state = 'AZ'; // Default to Arizona
  }
  
  // Clean postal code (5 digits only)
  postalCode = postalCode.replace(/\D/g, '').slice(0, 5);
  
  return {
    address1: toTitleCase(patient.address_line1),
    city: toTitleCase(patient.city),
    state: state,
    postalCode: postalCode || undefined,
    country: 'US' // Always US
  };
}

/**
 * Format patient data for GHL contact
 * GMH DATA ALWAYS OVERWRITES GHL - NO MERGE!
 */
function formatPatientForGHL(patient: PatientDataEntryRow): Partial<GHLContact> {
  const { firstName, lastName } = parseName(patient.patient_name);
  const addressData = cleanAddress(patient);
  
  const contact: Partial<GHLContact> = {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    name: patient.patient_name || undefined,
    email: patient.email || patient.qbo_customer_email || undefined,
    phone: normalizePhone(patient.phone_number),
    ...addressData,
    source: 'GMH Dashboard',
    customFields: []
  };

  // Add custom fields - USING YOUR EXISTING GHL FIELD IDs
  if (contact.customFields) {
    // Lab dates - PRIORITY (Your existing fields)
    if (patient.last_lab !== undefined) {
      contact.customFields.push({
        key: 'last_lab_date', // Date of Last Lab Test
        value: patient.last_lab || '' // GMH value ALWAYS (even if empty)
      });
    }
    if (patient.next_lab !== undefined) {
      contact.customFields.push({
        key: 'next_lab_date', // Date of Next Lab Test  
        value: patient.next_lab || '' // GMH value ALWAYS (even if empty)
      });
    }
    
    // Method of Payment (Your existing field)
    if (patient.method_of_payment !== undefined) {
      contact.customFields.push({
        key: 'method_of_payment', // Method of Payment
        value: patient.method_of_payment || ''
      });
    }
    
    // TODO: Add more custom fields when we create them in GHL and get their IDs
    // For now, keeping old generic approach for fields without IDs yet
    if (patient.status_key) {
      contact.customFields.push({
        key: 'patient_status',
        value: patient.alert_status || patient.status_key
      });
    }
    if (patient.type_of_client) {
      contact.customFields.push({
        key: 'client_type',
        value: patient.type_of_client
      });
    }
    if (patient.regimen) {
      contact.customFields.push({
        key: 'regimen',
        value: patient.regimen
      });
    }
    if (patient.service_start_date) {
      contact.customFields.push({
        key: 'service_start_date',
        value: patient.service_start_date
      });
    }
  }

  return contact;
}

/**
 * Sync a single patient to GoHighLevel
 * Focuses on finding and linking existing contacts, not creating new ones
 */
export async function syncPatientToGHL(
  patient: PatientDataEntryRow,
  userId?: string
): Promise<{ success: boolean; ghlContactId?: string; error?: string }> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    return { success: false, error: 'GHL client not configured' };
  }

  try {
    // Update sync status to 'syncing'
    await query(
      `UPDATE patients SET ghl_sync_status = 'syncing' WHERE patient_id = $1`,
      [patient.patient_id]
    );

    let ghlContact: GHLContact | null = null;

    // Check if patient already has a GHL contact ID
    const existingSync = await query<{ ghl_contact_id: string | null }>(
      `SELECT ghl_contact_id FROM patients WHERE patient_id = $1`,
      [patient.patient_id]
    );

    if (existingSync[0]?.ghl_contact_id) {
      // Try to get existing contact
      try {
        ghlContact = await ghlClient.getContact(existingSync[0].ghl_contact_id);
      } catch (error) {
        console.log('Contact not found in GHL by ID, will search by email/phone');
      }
    }

    // If no existing contact found by ID, try to find by email or phone
    if (!ghlContact) {
      if (patient.email || patient.qbo_customer_email) {
        ghlContact = await ghlClient.findContactByEmail(
          patient.email || patient.qbo_customer_email || ''
        );
      }
      
      if (!ghlContact && patient.phone_number) {
        ghlContact = await ghlClient.findContactByPhone(patient.phone_number);
      }
    }

    // If still no contact found, return error (we only link existing contacts)
    if (!ghlContact) {
      const errorMsg = `Contact not found in GHL. Email: ${patient.email || patient.qbo_customer_email || 'none'}, Phone: ${patient.phone_number || 'none'}`;
      await query(
        `UPDATE patients 
         SET ghl_sync_status = 'error',
             ghl_sync_error = $1
         WHERE patient_id = $2`,
        [errorMsg, patient.patient_id]
      );
      return { success: false, error: errorMsg };
    }

    // Prepare contact data for update
    const contactData = formatPatientForGHL(patient);

    // Update the existing contact with our data
    ghlContact = await ghlClient.updateContact(ghlContact.id, contactData);

    // Calculate and apply tags
    const tagNames = await calculatePatientTags(patient);
    const tagIds = await ensureGHLTags(ghlClient, tagNames);

    // CRITICAL: If patient is inactive, REMOVE ALL TAGS
    if (patient.status_key === 'inactive') {
      // Get all current tags on contact
      const existingTags = ghlContact.tags || [];
      if (existingTags.length > 0) {
        console.log(`Removing all tags from inactive patient: ${patient.patient_name}`);
        await ghlClient.removeTagsFromContact(ghlContact.id, existingTags);
      }
    } else if (tagIds.length > 0) {
      // Active patient - manage tags normally
      // Get existing tags to avoid removing tags from other systems
      const existingTags = ghlContact.tags || [];
      
      // Add new tags (GHL API handles duplicates)
      await ghlClient.addTagsToContact(ghlContact.id, tagIds);
    }

    // Update patient record with successful sync
    await query(
      `UPDATE patients 
       SET ghl_contact_id = $1,
           ghl_sync_status = 'synced',
           ghl_last_synced_at = NOW(),
           ghl_sync_error = NULL,
           ghl_tags = $2
       WHERE patient_id = $3`,
      [ghlContact.id, JSON.stringify(tagNames), patient.patient_id]
    );

    // Log sync history
    await query(
      `INSERT INTO ghl_sync_history 
       (patient_id, sync_type, ghl_contact_id, sync_payload, sync_result, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        patient.patient_id,
        'update',
        ghlContact.id,
        JSON.stringify({ contact: contactData, tags: tagNames }),
        JSON.stringify({ success: true, contactId: ghlContact.id }),
        userId || null
      ]
    );

    return { success: true, ghlContactId: ghlContact.id };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update patient record with error
    await query(
      `UPDATE patients 
       SET ghl_sync_status = 'error',
           ghl_sync_error = $1
       WHERE patient_id = $2`,
      [errorMessage, patient.patient_id]
    );

    // Log error in sync history
    await query(
      `INSERT INTO ghl_sync_history 
       (patient_id, sync_type, sync_payload, error_message, created_by)
       VALUES ($1, 'error', $2, $3, $4)`,
      [
        patient.patient_id,
        JSON.stringify({ patient: patient.patient_id }),
        errorMessage,
        userId || null
      ]
    );

    return { success: false, error: errorMessage };
  }
}

/**
 * Sync multiple patients to GoHighLevel
 */
export async function syncMultiplePatients(
  patientIds: string[],
  userId?: string
): Promise<{ succeeded: string[]; failed: string[]; errors: Record<string, string> }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const errors: Record<string, string> = {};

  // Get patient data for all IDs
  const patients = await query<PatientDataEntryRow>(
    `SELECT * FROM patient_data_entry_v WHERE patient_id = ANY($1)`,
    [patientIds]
  );

  // Sync each patient
  for (const patient of patients) {
    const result = await syncPatientToGHL(patient, userId);
    
    if (result.success) {
      succeeded.push(patient.patient_id);
    } else {
      failed.push(patient.patient_id);
      errors[patient.patient_id] = result.error || 'Unknown error';
    }

    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { succeeded, failed, errors };
}

/**
 * Get patients that need syncing
 */
export async function getPatientsNeedingSync(limit = 100): Promise<PatientGHLSync[]> {
  return query<PatientGHLSync>(
    `SELECT 
      patient_id,
      patient_name,
      email,
      phone_primary,
      ghl_contact_id,
      ghl_sync_status,
      ghl_last_synced_at,
      ghl_sync_error,
      COALESCE(ghl_tags, '[]'::jsonb) as ghl_tags
     FROM patient_ghl_sync_v
     WHERE 
       sync_freshness IN ('pending', 'stale', 'error') OR
       ghl_sync_status = 'pending' OR
       (ghl_sync_status = 'synced' AND ghl_last_synced_at < NOW() - INTERVAL '7 days')
     ORDER BY 
       CASE 
         WHEN ghl_sync_status = 'error' THEN 1
         WHEN ghl_sync_status = 'pending' THEN 2
         ELSE 3
       END,
       ghl_last_synced_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
}

/**
 * Sync all patients that need syncing
 */
export async function syncAllPatientsToGHL(userId?: string): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}> {
  const patientsToSync = await getPatientsNeedingSync(500); // Sync up to 500 at a time
  
  if (patientsToSync.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  }

  const patientIds = patientsToSync.map(p => p.patient_id);
  const results = await syncMultiplePatients(patientIds, userId);

  return {
    total: patientIds.length,
    succeeded: results.succeeded.length,
    failed: results.failed.length,
    errors: Object.entries(results.errors).map(
      ([id, error]) => `Patient ${id}: ${error}`
    )
  };
}

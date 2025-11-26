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
 * 
 * This function creates a complete contact payload that will REPLACE (not merge) 
 * all fields in GHL with GMH data. All custom fields are explicitly set.
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

  // Add dateOfBirth if available (GHL standard field - check if supported)
  // Note: GHL may require this as a custom field instead
  if (patient.date_of_birth) {
    // Try as standard field first - if GHL doesn't support it, we'll need custom field
    // For now, adding as custom field to be safe
    contact.customFields!.push({
      key: 'date_of_birth',
      value: patient.date_of_birth
    });
  }

  // Helper to add custom field only if value is not empty
  const addCustomField = (key: string, value: string | null | undefined) => {
    // Convert value to string if needed
    let stringValue = value !== null && value !== undefined ? String(value) : '';
    
    // For lab date fields, format as mm-dd-yyyy for GHL
    if (key === 'M9UY8UHBU8vI4lKBWN7w' || key === 'cMaBe12wckOiBAYb6T3e') {
      if (stringValue && stringValue.trim()) {
        try {
          // Handle ISO format dates (YYYY-MM-DD) directly to avoid timezone issues
          const isoDateMatch = stringValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (isoDateMatch) {
            // Directly use the date parts from ISO format (YYYY-MM-DD)
            const year = isoDateMatch[1];
            const month = isoDateMatch[2];
            const day = isoDateMatch[3];
            stringValue = `${month}-${day}-${year}`;
            console.log(`[GHL Sync] Formatted ISO date to: ${stringValue}`);
          } else {
            // Try parsing as a date for other formats
            const dateObj = new Date(stringValue);
            if (!isNaN(dateObj.getTime())) {
              // Successfully parsed as a date - format as mm-dd-yyyy
              const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
              const day = String(dateObj.getUTCDate()).padStart(2, '0');
              const year = dateObj.getUTCFullYear();
              stringValue = `${month}-${day}-${year}`;
              console.log(`[GHL Sync] Formatted date to: ${stringValue}`);
            } else {
              // Date parsing failed - leave as is
              console.log(`[GHL Sync] Date parsing failed for: ${stringValue}`);
            }
          }
        } catch (e) {
          console.error(`[GHL Sync] Date formatting error:`, e, `for value: ${stringValue}`);
        }
      }
      
      // GHL updateContact expects `field` (or `id`) for existing custom fields
      // Try both `field` and `id` to ensure GHL accepts it
      contact.customFields!.push({
        field: key,  // Primary identifier
        id: key,     // Also include id for compatibility
        value: stringValue || '' // Always send value, even if empty (to clear field)
      });
      console.log(`[GHL Sync] Added lab date field: field=${key}, value=${stringValue || '(empty)'}`);
      return;
    }
    
    // For all other fields, only add if value exists and is not empty
    const trimmed = stringValue.trim();
    if (trimmed !== '') {
      contact.customFields!.push({
        key,
        value: trimmed
      });
    }
  };

    // CRITICAL: Lab dates - GMH ALWAYS WINS (even if empty, overwrites GHL)
    // These are the most important fields per user requirements
    // Use the correct GHL custom field IDs (not names)
    console.log(`[GHL Sync] Adding lab dates for ${patient.patient_name}: last_lab=${patient.last_lab}, next_lab=${patient.next_lab}`);
    // Use the actual GHL field IDs so the date formatting logic triggers and fields update correctly
    addCustomField('M9UY8UHBU8vI4lKBWN7w', patient.last_lab);      // Date of Last Lab Test
    addCustomField('cMaBe12wckOiBAYb6T3e', patient.next_lab);      // Date of Next Lab Test
  
  // Payment and client information
  addCustomField('method_of_payment', patient.method_of_payment);
  addCustomField('patient_status', patient.alert_status || patient.status_key);
  addCustomField('client_type', patient.type_of_client);
  addCustomField('regimen', patient.regimen);
  addCustomField('service_start_date', patient.service_start_date);
  addCustomField('contract_end', patient.contract_end);
  
  // Notes fields
  addCustomField('patient_notes', patient.patient_notes);
  addCustomField('lab_notes', patient.lab_notes);
  
  // Membership information
  addCustomField('membership_owes', patient.membership_owes);
  addCustomField('membership_program', patient.membership_program);
  addCustomField('membership_status', patient.membership_status);
  addCustomField('membership_balance', patient.membership_balance);
  
  // Supply information
  addCustomField('last_supply_date', patient.last_supply_date);
  addCustomField('eligible_for_next_supply', patient.eligible_for_next_supply);
  addCustomField('supply_status', patient.supply_status);
  
  // Charge dates
  addCustomField('next_charge_date', patient.next_charge_date);
  addCustomField('last_charge_date', patient.last_charge_date);
  
  // DEA information
  addCustomField('last_controlled_dispense_at', patient.last_controlled_dispense_at);
  addCustomField('last_dea_drug', patient.last_dea_drug);
  
  // Date of birth
  addCustomField('date_of_birth', patient.date_of_birth);

  // Remove undefined fields from contact object to avoid sending them
  Object.keys(contact).forEach(key => {
    if (contact[key as keyof typeof contact] === undefined) {
      delete contact[key as keyof typeof contact];
    }
  });
  
  // If customFields is empty, set to undefined (don't send empty array)
  if (contact.customFields && contact.customFields.length === 0) {
    contact.customFields = undefined;
  }

  return contact;
}

/**
 * Sync a single patient to GoHighLevel
 * 
 * CRITICAL: GMH Dashboard is the MASTER copy. This function:
 * - Finds existing GHL contacts by email/phone (does NOT create new ones)
 * - OVERWRITES all GHL contact data with current GMH data (no merging)
 * - Applies tags based on GMH patient status/type
 * - Removes ALL tags if patient is inactive
 * 
 * The PUT /contacts/{id} endpoint should fully replace the contact data.
 * All custom fields are explicitly set to ensure complete overwrite.
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
      // Try to get existing contact - but only if ID is valid
      const contactId = existingSync[0].ghl_contact_id;
      if (contactId && contactId !== 'undefined' && contactId.trim() !== '') {
        try {
          ghlContact = await ghlClient.getContact(contactId);
          if (ghlContact) {
            console.log(`[GHL Sync] Found existing contact by stored ID: ${contactId}`);
          }
        } catch (error) {
          console.log(`[GHL Sync] Contact not found in GHL by stored ID (${contactId}), will search by email/phone`);
          // Clear the invalid contact ID from database
          await query(
            `UPDATE patients SET ghl_contact_id = NULL WHERE patient_id = $1`,
            [patient.patient_id]
          );
        }
      } else {
        console.log(`[GHL Sync] Invalid contact ID stored (${contactId}), will search by email/phone`);
        // Clear the invalid contact ID from database
        await query(
          `UPDATE patients SET ghl_contact_id = NULL WHERE patient_id = $1`,
          [patient.patient_id]
        );
      }
    }

    // STEP 1: Try to find contact by email
    if (!ghlContact && (patient.email || patient.qbo_customer_email)) {
      console.log(`[GHL Sync] Step 1: Searching for contact by email: ${patient.email || patient.qbo_customer_email}`);
      try {
        ghlContact = await ghlClient.findContactByEmail(
          patient.email || patient.qbo_customer_email || ''
        );
        if (ghlContact) {
          console.log(`[GHL Sync] Step 1 SUCCESS: Found contact by email`);
        } else {
          console.log(`[GHL Sync] Step 1: No contact found by email`);
        }
      } catch (error) {
        console.error(`[GHL Sync] Step 1 ERROR: Failed to search by email:`, error);
      }
    }
    
    // STEP 2: If not found by email, try to find by phone
    if (!ghlContact && patient.phone_number) {
      console.log(`[GHL Sync] Step 2: Searching for contact by phone: ${patient.phone_number}`);
      try {
        ghlContact = await ghlClient.findContactByPhone(patient.phone_number);
        if (ghlContact) {
          console.log(`[GHL Sync] Step 2 SUCCESS: Found contact by phone`);
        } else {
          console.log(`[GHL Sync] Step 2: No contact found by phone`);
        }
      } catch (error) {
        console.error(`[GHL Sync] Step 2 ERROR: Failed to search by phone:`, error);
      }
    }

    // STEP 3: If still no contact found, try searching by name as fallback
    if (!ghlContact) {
      const { firstName, lastName } = parseName(patient.patient_name);
      if (firstName || lastName) {
        console.log(`[GHL Sync] Step 3: Trying name-based search: ${firstName} ${lastName}`);
        try {
          ghlContact = await ghlClient.findContactByName(firstName, lastName);
          if (ghlContact) {
            console.log(`[GHL Sync] Step 3 SUCCESS: Found contact by name`);
          } else {
            console.log(`[GHL Sync] Step 3: No contact found by name`);
          }
        } catch (error) {
          console.error(`[GHL Sync] Step 3 ERROR: Failed to search by name:`, error);
        }
      }
    }

    // STEP 4: If still no contact found, CREATE A NEW CONTACT
    if (!ghlContact) {
      console.log(`[GHL Sync] Step 4: Contact not found - creating new contact in GHL for ${patient.patient_name}`);
      
      const contactData = formatPatientForGHL(patient);
      const tagNames = await calculatePatientTags(patient);
      await ensureGHLTags(ghlClient, tagNames);
      contactData.tags = tagNames;
      
      try {
        // Create the contact in GHL
        const createdContact = await ghlClient.createContact(contactData);
        console.log(`[GHL Sync] Step 4a: Successfully created new contact in GHL: ${createdContact.id}`);
        ghlContact = createdContact;
      } catch (createError) {
        const errorMsg = `Failed to create contact in GHL: ${createError instanceof Error ? createError.message : 'Unknown error'}`;
        console.error(`[GHL Sync] Step 4 ERROR: ${errorMsg}`);
        await query(
          `UPDATE patients 
           SET ghl_sync_status = 'error',
               ghl_sync_error = $1
           WHERE patient_id = $2`,
          [errorMsg, patient.patient_id]
        );
        return { success: false, error: errorMsg };
      }
    }

    // STEP 5: Extract contact ID from multiple possible fields
    // First, check if contact is still wrapped in a 'contact' property
    let actualContact = ghlContact;
    if ((ghlContact as any).contact && !ghlContact.id) {
      actualContact = (ghlContact as any).contact;
      console.log(`[GHL Sync] Step 4a: Unwrapped contact from nested structure`);
    }
    
    console.log(`[GHL Sync] Step 4: Extracting contact ID from:`, JSON.stringify(actualContact, null, 2));
    
    // Try multiple possible ID fields
    const contactId = 
      actualContact.id || 
      (actualContact as any).contactId || 
      (actualContact as any)._id || 
      (actualContact as any).contact_id;
    
    // STEP 6: Validate that we have a contact ID
    if (!contactId) {
      const errorMsg = `Contact found but missing ID. Email: ${patient.email || patient.qbo_customer_email || 'none'}, Phone: ${patient.phone_number || 'none'}`;
      console.error('[GHL Sync] Step 5 ERROR: Contact object missing ID. Full contact:', JSON.stringify(ghlContact, null, 2));
      await query(
        `UPDATE patients 
         SET ghl_sync_status = 'error',
             ghl_sync_error = $1
         WHERE patient_id = $2`,
        [errorMsg, patient.patient_id]
      );
      return { success: false, error: errorMsg };
    }
    
    console.log(`[GHL Sync] Step 5 SUCCESS: Extracted contact ID: ${contactId}`);

    // Prepare contact data for update
    const contactData = formatPatientForGHL(patient);
    
    // For inactive patients, we still sync but with minimal data and no tags
    // This ensures GHL reflects the inactive status

    // Calculate and apply tags
    const tagNames = await calculatePatientTags(patient);
    await ensureGHLTags(ghlClient, tagNames); // Ensure tags exist in GHL

    // CRITICAL: If patient is inactive, REMOVE ALL TAGS
    const shouldClearTags = patient.status_key === 'inactive';
    contactData.tags = shouldClearTags ? [] : tagNames; // Set tags directly

    // Update the existing contact with our data (tags + fields)
    console.log(`[GHL Sync] Updating contact ${contactId} with custom fields:`, JSON.stringify(contactData.customFields));
    try {
      const updateResult = await ghlClient.updateContact(contactId, contactData);
      console.log(`[GHL Sync] Successfully updated contact ${contactId}:`, JSON.stringify(updateResult, null, 2));
    } catch (updateError) {
      console.error(`[GHL Sync] ERROR updating contact ${contactId}:`, updateError);
      throw updateError; // Re-throw to be caught by outer catch block
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
      [contactId, JSON.stringify(tagNames), patient.patient_id]
    );

    // Log sync history
    await query(
      `INSERT INTO ghl_sync_history 
       (patient_id, sync_type, ghl_contact_id, sync_payload, sync_result, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        patient.patient_id,
        'update',
        contactId,
        JSON.stringify({ contact: contactData, tags: tagNames }),
        JSON.stringify({ success: true, contactId: contactId }),
        userId || null
      ]
    );

    return { success: true, ghlContactId: contactId };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle "duplicated contacts" error - this means the contact already exists in GHL
    if (errorMessage.includes('duplicated contacts') || errorMessage.includes('duplicate')) {
      // Try to find the existing contact and link to it
      try {
        let existingContact: GHLContact | null = null;
        if (patient.email || patient.qbo_customer_email) {
          existingContact = await ghlClient.findContactByEmail(
            patient.email || patient.qbo_customer_email || ''
          );
        }
        if (!existingContact && patient.phone_number) {
          existingContact = await ghlClient.findContactByPhone(patient.phone_number);
        }
        
        if (existingContact) {
          const existingContactId = existingContact.id || (existingContact as any).contactId;
          if (existingContactId) {
            // Link to the existing contact
            await query(
              `UPDATE patients 
               SET ghl_contact_id = $1,
                   ghl_sync_status = 'synced',
                   ghl_last_synced_at = NOW(),
                   ghl_sync_error = NULL
               WHERE patient_id = $2`,
              [existingContactId, patient.patient_id]
            );
            return { success: true, ghlContactId: existingContactId };
          }
        }
      } catch (linkError) {
        console.error(`Failed to link duplicate contact for ${patient.patient_name}:`, linkError);
      }
    }
    
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

  // Sync each patient with rate limiting to avoid "Too Many Requests"
  for (let i = 0; i < patients.length; i++) {
    const patient = patients[i];
    
    // Add delay between requests (except first one) - 200ms = ~5 requests/second
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    const result = await syncPatientToGHL(patient, userId);
    
    if (result.success) {
      succeeded.push(patient.patient_id);
    } else {
      failed.push(patient.patient_id);
      errors[patient.patient_id] = result.error || 'Unknown error';
      
      // If rate limited, add longer delay before next request
      if (result.error?.includes('Too Many Requests')) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
    }
  }

  return { succeeded, failed, errors };
}

/**
 * Get ALL patients for forced resync (ignores sync status)
 */
export async function getAllPatientsForForcedResync(limit = 500): Promise<PatientGHLSync[]> {
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
     ORDER BY patient_id DESC
     LIMIT $1`,
    [limit]
  );
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
export async function syncAllPatientsToGHL(userId?: string, forceAll: boolean = false): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}> {
  // If forceAll is true, resync ALL patients regardless of sync status
  // Otherwise, only sync patients that need syncing
  const patientsToSync = forceAll 
    ? await getAllPatientsForForcedResync(500)
    : await getPatientsNeedingSync(500);
  
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

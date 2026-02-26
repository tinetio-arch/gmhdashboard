/**
 * Patient-to-Healthie EMR Sync Functionality
 * Automatically creates patients in Healthie when created in GMH Dashboard
 * Routes to correct Healthie group based on clinic selection
 */

import { HealthieClient } from './healthie';
import type { CreateClientInput } from './healthie';

const HEALTHIE_DEBUG = process.env.HEALTHIE_DEBUG === 'true';

function debugLog(...args: unknown[]): void {
    if (HEALTHIE_DEBUG) {
        console.log('[HealthieSync]', ...args);
    }
}

export type ClinicType = 'nowprimary.care' | 'nowmenshealth.care';

export type CreatePatientInHealthieInput = {
    patientName: string;
    email?: string | null;
    phoneNumber?: string | null;
    dateOfBirth?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    clinic: ClinicType;
};

export type HealthieSyncResult = {
    success: boolean;
    healthieClientId?: string;
    error?: string;
};

/**
 * Parse patient full name into first and last name
 * Handles various formats: "John Doe", "Dr. John Doe", "John Michael Doe Jr."
 */
function parseName(fullName: string): { firstName: string; lastName: string } {
    const cleaned = fullName.trim();

    // Remove common titles
    const withoutTitle = cleaned
        .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+/i, '')
        .trim();

    // Split by spaces
    const parts = withoutTitle.split(/\s+/);

    if (parts.length === 1) {
        // Single name (use same for first and last)
        return { firstName: parts[0], lastName: parts[0] };
    }

    if (parts.length === 2) {
        // Simple "First Last" format
        return { firstName: parts[0], lastName: parts[1] };
    }

    // Multiple parts - remove common suffixes from last name
    const lastPart = parts[parts.length - 1];
    const isSuffix = /^(Jr\.?|Sr\.?|II|III|IV|V|MD|PhD|DO|NP|PA)$/i.test(lastPart);

    if (isSuffix && parts.length > 2) {
        // "John Doe Jr." → firstName: "John", lastName: "Doe Jr."
        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ');
        return { firstName, lastName };
    }

    // Default: "John Michael Doe" → firstName: "John", lastName: "Michael Doe"
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
}

/**
 * Get Healthie configuration (group ID and provider ID) based on clinic
 */
function getHealthieConfig(clinic: ClinicType): {
    groupId: string;
    providerId: string;
    groupName: string;
    providerName: string;
} {
    if (clinic === 'nowprimary.care') {
        return {
            groupId: process.env.HEALTHIE_PRIMARY_CARE_GROUP_ID || '75523',
            providerId: process.env.HEALTHIE_PRIMARY_CARE_PROVIDER_ID || '12088269',
            groupName: 'NowPrimary.Care',
            providerName: 'Phil Schafer, NP'
        };
    }

    // nowmenshealth.care
    return {
        groupId: process.env.HEALTHIE_MENS_HEALTH_GROUP_ID || '75522',
        providerId: process.env.HEALTHIE_MENS_HEALTH_PROVIDER_ID || '12093125',
        groupName: 'NowMensHealth.Care',
        providerName: 'Aaron Whitten, DO'
    };
}

/**
 * Create a new patient in Healthie EMR
 * 
 * **Healthie Group Assignment**:
 * - NowPrimary.Care (group 75523) → Phil Schafer, NP
 * - NowMensHealth.Care (group 75522) → Aaron Whitten, DO
 * 
 * **Behavior**:
 * - Sends welcome email if email provided
 * - Assigns to correct provider and group
 * - Creates patient record immediately (synchronous)
 * 
 * @param patientData - Patient information from GMH dashboard
 * @returns Promise with success status and Healthie client ID
 */
export async function createPatientInHealthie(
    patientData: CreatePatientInHealthieInput
): Promise<HealthieSyncResult> {
    try {
        debugLog('Creating patient in Healthie:', {
            name: patientData.patientName,
            clinic: patientData.clinic
        });

        // 1. Validate API key
        const apiKey = process.env.HEALTHIE_API_KEY;
        if (!apiKey) {
            throw new Error('HEALTHIE_API_KEY not configured in environment');
        }

        // 2. Get configuration based on clinic
        const config = getHealthieConfig(patientData.clinic);
        debugLog('Using Healthie config:', {
            group: config.groupName,
            provider: config.providerName
        });

        // 3. Parse patient name
        const { firstName, lastName } = parseName(patientData.patientName);
        debugLog('Parsed name:', { firstName, lastName });

        // 4. Check for existing patient to prevent duplicates
        // Search by email, phone, AND name to find any potential match
        const existingId = await findHealthiePatient(
            patientData.email,
            patientData.phoneNumber,
            patientData.patientName  // Also search by name!
        );
        if (existingId) {
            console.log(`[HealthieSync] ✅ Found existing Healthie patient ${existingId}, linking instead of creating new`);
            return {
                success: true,
                healthieClientId: existingId
            };
        }

        // 5. Prepare Healthie client creation input
        const healthieClient = new HealthieClient({ apiKey });

        const createInput: CreateClientInput = {
            first_name: firstName,
            last_name: lastName,
            email: patientData.email || undefined,
            phone_number: patientData.phoneNumber || undefined,
            dob: patientData.dateOfBirth || undefined,
            dietitian_id: config.providerId,  // Assign to provider
            user_group_id: config.groupId,    // Assign to group
            dont_send_welcome: !patientData.email,  // Only send if email exists
            skipped_email: !patientData.email,       // Skip email field if no email
            skip_set_password_state: false,          // Allow patient to set password
        };

        // Add address if provided
        if (patientData.address || patientData.city || patientData.state || patientData.zip) {
            // Healthie expects location object, but createClient doesn't support it directly
            // We'll need to update after creation if address is critical
            // For now, skip address - can be updated later via updateClient
        }

        // 5. Create client in Healthie
        debugLog('Calling Healthie createClient API...');
        const result = await healthieClient.createClient(createInput);

        if (!result?.id) {
            throw new Error('Healthie API did not return a client ID');
        }

        debugLog('✅ Successfully created Healthie client:', result.id);

        return {
            success: true,
            healthieClientId: result.id
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[HealthieSync] ❌ Failed to create patient in Healthie:', errorMessage);

        return {
            success: false,
            error: errorMessage
        };
    }
}

/**
 * Check if a patient already exists in Healthie by email, phone, or name
 * 
 * @param email - Patient email (optional)
 * @param phone - Patient phone (optional)
 * @param name - Patient name (optional) - used as fallback search
 * @returns Healthie client ID if found, null otherwise
 */
export async function findHealthiePatient(
    email?: string | null,
    phone?: string | null,
    name?: string | null
): Promise<string | null> {
    try {
        const apiKey = process.env.HEALTHIE_API_KEY;
        if (!apiKey) {
            return null;
        }

        const healthieClient = new HealthieClient({ apiKey });
        console.log(`[HealthieSync] Checking for existing patient - Email: ${email || 'none'}, Phone: ${phone || 'none'}, Name: ${name || 'none'}`);

        // Try email first (most reliable)
        if (email) {
            const client = await healthieClient.findClientByEmail(email);
            if (client) {
                console.log(`[HealthieSync] ✅ Found existing patient by email: ${client.id}`);
                return client.id;
            }
        }

        // Try phone if email didn't work
        if (phone) {
            const client = await healthieClient.findClientByPhone(phone);
            if (client) {
                console.log(`[HealthieSync] ✅ Found existing patient by phone: ${client.id}`);
                return client.id;
            }
        }

        // Try name search as final fallback - CRITICAL for duplicate prevention
        if (name && name.trim().length >= 2) {
            try {
                const nameMatches = await healthieClient.searchClientsByName(name);
                if (nameMatches.length > 0) {
                    // Check for exact or very close name match
                    const normalizedSearchName = name.toLowerCase().trim();
                    for (const match of nameMatches) {
                        const matchFullName = `${match.first_name || ''} ${match.last_name || ''}`.toLowerCase().trim();
                        if (matchFullName === normalizedSearchName ||
                            matchFullName.includes(normalizedSearchName) ||
                            normalizedSearchName.includes(matchFullName)) {
                            console.log(`[HealthieSync] ✅ Found existing patient by name: ${match.id} (${matchFullName})`);
                            return match.id;
                        }
                    }
                    // If no exact match, return the first result as potential match
                    console.log(`[HealthieSync] ⚠️ Found potential name match: ${nameMatches[0].id}`);
                    return nameMatches[0].id;
                }
            } catch (nameSearchError) {
                console.error('[HealthieSync] Name search failed:', nameSearchError);
            }
        }

        console.log(`[HealthieSync] ❌ No existing patient found for: ${name || email || phone}`);
        return null;
    } catch (error) {
        console.error('[HealthieSync] Error checking for existing patient:', error);
        return null;
    }
}

/**
 * Search for existing patients in Healthie by name, email, or phone
 * Returns all potential matches for duplicate detection during patient creation
 * 
 * @param params - Search parameters (name, email, phone)
 * @returns Array of matching Healthie patients
 */
export async function searchHealthiePatients(params: {
    name?: string;
    email?: string;
    phoneNumber?: string;
}): Promise<Array<{ id: string; full_name: string; email?: string }>> {
    const matches: Array<{ id: string; full_name: string; email?: string }> = [];
    const seenIds = new Set<string>();

    try {
        const apiKey = process.env.HEALTHIE_API_KEY;
        if (!apiKey) {
            return matches;
        }

        const healthieClient = new HealthieClient({ apiKey });
        console.log(`[HealthieSync] searchHealthiePatients - Email: ${params.email || 'none'}, Phone: ${params.phoneNumber || 'none'}, Name: ${params.name || 'none'}`);

        // Search by email (most reliable)
        if (params.email) {
            const client = await healthieClient.findClientByEmail(params.email);
            if (client && !seenIds.has(client.id)) {
                seenIds.add(client.id);
                matches.push({
                    id: client.id,
                    full_name: `${client.first_name} ${client.last_name}`,
                    email: client.email
                });
                console.log(`[HealthieSync] Found by email: ${client.id}`);
            }
        }

        // Search by phone
        if (params.phoneNumber) {
            const client = await healthieClient.findClientByPhone(params.phoneNumber);
            if (client && !seenIds.has(client.id)) {
                seenIds.add(client.id);
                matches.push({
                    id: client.id,
                    full_name: `${client.first_name} ${client.last_name}`,
                    email: client.email
                });
                console.log(`[HealthieSync] Found by phone: ${client.id}`);
            }
        }

        // ALWAYS search by name - not just as fallback!
        // This is critical for catching duplicates when email/phone don't match
        if (params.name && params.name.trim().length >= 2) {
            try {
                const nameResult = await healthieClient.searchClientsByName(params.name);
                if (nameResult && nameResult.length > 0) {
                    for (const client of nameResult.slice(0, 5)) { // Limit to 5 matches
                        if (!seenIds.has(client.id)) {
                            seenIds.add(client.id);
                            matches.push({
                                id: client.id,
                                full_name: `${client.first_name} ${client.last_name}`,
                                email: client.email
                            });
                        }
                    }
                    console.log(`[HealthieSync] Found ${nameResult.length} by name search`);
                }
            } catch (nameSearchError) {
                console.error('[HealthieSync] Name search failed:', nameSearchError);
            }
        }

        console.log(`[HealthieSync] Total matches found: ${matches.length}`);
        return matches;
    } catch (error) {
        console.error('[HealthieSync] Error searching for patients:', error);
        return matches;
    }
}

/**
 * Shared Types for Telegram Bot Modules
 */

// ============================================================================
// CONVERSATION CONTEXT
// ============================================================================
export interface ConversationContext {
    lastQuery: string;
    lastSql: string;
    lastResults: any[];
    timestamp: number;
}

// ============================================================================
// GEMINI AI TYPES
// ============================================================================
export interface GeminiFunctionCall {
    name: string;
    args: Record<string, any>;
}

export interface GeminiToolResponse {
    text?: string;
    functionCall?: GeminiFunctionCall;
}

// ============================================================================
// HEALTHIE TYPES
// ============================================================================
export interface HealthieUpdateResult {
    success: boolean;
    user?: any;
    errors?: Array<{ field: string; message: string }>;
}

export interface PatientUpdateFields {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_number?: string;
    dob?: string;
    gender?: string;
    // Address fields (nested in location)
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    // Other
    dietitian_id?: string;
    timezone?: string;
    quick_notes?: string;
}

export interface ParsedUpdateCommand {
    patientName: string;
    updateType: 'address' | 'phone' | 'email' | 'name' | 'dob' | 'gender' | 'other';
    fields: PatientUpdateFields;
    rawText: string;
}

// ============================================================================
// MISSING DATA LOGGING
// ============================================================================
export interface MissingDataRequest {
    query: string;
    missingElement: string;
    timestamp: string;
    chatId: number;
}

// ============================================================================
// AGENTIC TOOL DEFINITIONS
// ============================================================================
export const AGENTIC_TOOLS = {
    function_declarations: [
        {
            name: "search_patients",
            description: "Search for patients by name, phone number, or email. Returns patient info including IDs.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Patient name, phone, or email to search for" }
                },
                required: ["query"]
            }
        },
        {
            name: "get_patient_labs",
            description: "Get the most recent lab results for a patient from Healthie",
            parameters: {
                type: "object",
                properties: {
                    patient_id: { type: "string", description: "Patient ID or Healthie client ID" }
                },
                required: ["patient_id"]
            }
        },
        {
            name: "send_email",
            description: "Send an email to a patient or staff member",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string", description: "Recipient email address" },
                    subject: { type: "string", description: "Email subject line" },
                    body: { type: "string", description: "Email body content (plain text or HTML)" }
                },
                required: ["to", "subject", "body"]
            }
        },
        {
            name: "create_healthie_task",
            description: "Create a task in Healthie for follow-up actions",
            parameters: {
                type: "object",
                properties: {
                    patient_id: { type: "string", description: "Healthie client ID" },
                    content: { type: "string", description: "Task description" },
                    due_date: { type: "string", description: "Due date in YYYY-MM-DD format (optional)" }
                },
                required: ["patient_id", "content"]
            }
        }
    ]
};

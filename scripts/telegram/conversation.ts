/**
 * Conversation Context and Utility Module
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConversationContext, MissingDataRequest } from './types';

// ============================================================================
// CONVERSATION HISTORY
// ============================================================================
const conversationHistory = new Map<number, ConversationContext>();
const CONTEXT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export function getConversationContext(chatId: number): ConversationContext | null {
    const ctx = conversationHistory.get(chatId);
    if (!ctx) return null;
    if (Date.now() - ctx.timestamp > CONTEXT_EXPIRY_MS) {
        conversationHistory.delete(chatId);
        return null;
    }
    return ctx;
}

export function setConversationContext(chatId: number, query: string, sql: string, results: any[]) {
    conversationHistory.set(chatId, {
        lastQuery: query,
        lastSql: sql,
        lastResults: results,
        timestamp: Date.now()
    });
}

export function clearConversationContext(chatId: number) {
    conversationHistory.delete(chatId);
}

// ============================================================================
// FOLLOW-UP DETECTION
// ============================================================================
export function isFollowUpQuery(text: string): boolean {
    const followUpIndicators = [
        'what about', 'how about', 'and the', 'show me more',
        'filter', 'sort', 'order by', 'group by',
        'of those', 'of them', 'from that', 'from those',
        'drill down', 'break down', 'expand',
        'which ones', 'who are', 'list them',
        'more details', 'more info'
    ];
    const textLower = text.toLowerCase();
    return followUpIndicators.some(ind => textLower.includes(ind));
}

// ============================================================================
// PATIENT NAME EXTRACTION
// ============================================================================
export function extractPatientName(text: string): string | null {
    const patterns = [
        /(?:data|info|information|details|financials?|payments?|billing)\s+(?:on|for|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:'s)?\s+(?:data|info|information|details|financials?|payments?|billing)/i,
        /(?:patient|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        /(?:look up|lookup|find|get|show|give me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            const name = match[1].trim();
            const excludeWords = ['All', 'Complete', 'Full', 'Total', 'Patient', 'Client', 'Financial', 'Billing', 'Payment'];
            if (!excludeWords.some(w => name.toLowerCase() === w.toLowerCase())) {
                return name;
            }
        }
    }
    return null;
}

// ============================================================================
// QUERY TYPE DETECTION
// ============================================================================
export function isFinancialQuery(text: string): boolean {
    const financialKeywords = [
        'financial', 'payment', 'billing', 'invoice', 'paid', 'owes', 'owe',
        'balance', 'revenue', 'charge', 'fee', 'cost', 'money', 'dollar', '$'
    ];
    const textLower = text.toLowerCase();
    return financialKeywords.some(kw => textLower.includes(kw)) ||
        textLower.includes('all data') ||
        textLower.includes('complete data') ||
        textLower.includes('everything');
}

// ============================================================================
// MISSING DATA LOGGING
// ============================================================================
const missingDataLog: MissingDataRequest[] = [];

export function logMissingData(chatId: number, query: string, missingElement: string) {
    missingDataLog.push({
        query,
        missingElement,
        timestamp: new Date().toISOString(),
        chatId
    });
    console.log(`[Bot] 📝 Missing data logged: "${missingElement}" requested in query: "${query}"`);

    // Persist to file periodically
    if (missingDataLog.length % 5 === 0) {
        try {
            const logPath = path.join(__dirname, '../../data/missing-data-requests.json');
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.writeFileSync(logPath, JSON.stringify(missingDataLog, null, 2));
        } catch (e) {
            // Ignore write errors
        }
    }
}

// ============================================================================
// SCHEMA LOADING
// ============================================================================
export function loadDiscoveredSchema(): string {
    try {
        const schemaPath = path.join(__dirname, '../../lib/discoveredSchema.ts');
        if (fs.existsSync(schemaPath)) {
            const content = fs.readFileSync(schemaPath, 'utf-8');
            const match = content.match(/export const DISCOVERED_SCHEMA = `([\s\S]*?)`;/);
            if (match) {
                console.log('[Bot] ✅ Loaded auto-discovered schema from Snowflake');
                return match[1];
            }
        }
    } catch (e) {
        console.log('[Bot] ⚠️ Could not load discovered schema, using fallback');
    }
    return '';
}

// Build schema context - use discovered schema if available
const DISCOVERED_SCHEMA = loadDiscoveredSchema();

export const SCHEMA_CONTEXT = DISCOVERED_SCHEMA || `
You are a SQL expert querying a Snowflake database with comprehensive clinic operational data.

Database: GMH_CLINIC

🌟 PRIMARY VIEW FOR PATIENT INFO:

** GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW **
AVAILABLE FIELDS (only these exist!):
   - PATIENT_ID, PATIENT_NAME, PREFERRED_NAME, EMAIL
   - PHONE_NUMBER, PHONE_SECONDARY
   - ADDRESS_LINE1, ADDRESS_LINE2, CITY, STATE, POSTAL_CODE, COUNTRY
   - DATE_OF_BIRTH, GENDER
   - REGIMEN, ALERT_STATUS, STATUS
   - SERVICE_START_DATE, CONTRACT_END_DATE, DAYS_UNTIL_CONTRACT_ENDS
   - CLIENT_TYPE, PAYMENT_METHOD
   - LAST_LAB_DATE, NEXT_LAB_DATE, LAB_STATUS, DAYS_UNTIL_NEXT_LAB, LAB_ALERT_STATUS
   - HEALTHIE_CLIENT_ID, GHL_CONTACT_ID, GHL_SYNC_STATUS, JANE_ID
   - TOTAL_DISPENSES, TOTAL_ML_DISPENSED, LAST_DISPENSE_DATE, MEDICATIONS
   - DATE_ADDED, SYNCED_AT
   
⚠️ WARNING: PATIENT_360_VIEW does NOT have QB_CUSTOMER_ID! Don't use it.

💰 FINANCIAL TABLES (join to PATIENT_360_VIEW on PATIENT_ID):

1. GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
   - INVOICE_ID, PATIENT_ID, AMOUNT, PAID_AMOUNT, REMAINING_BALANCE, STATUS, INVOICE_DATE

2. GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS (recurring payments from Healthie)
   - BILLING_ITEM_ID, PATIENT_ID, AMOUNT_PAID, STATE, PAYMENT_DATE, SENDER_NAME
   - STATE values: 'succeeded', 'scheduled', 'failed'

3. GMH_CLINIC.FINANCIAL_DATA.QB_PAYMENTS
   - PAYMENT_ID, PATIENT_ID, AMOUNT_PAID, PAYMENT_DATE, DAYS_OVERDUE

4. GMH_CLINIC.FINANCIAL_DATA.PAYMENT_ISSUES
   - ISSUE_ID, PATIENT_ID, ISSUE_TYPE, DESCRIPTION, SEVERITY, STATUS

5. GMH_CLINIC.FINANCIAL_DATA.MEMBERSHIPS
   - MEMBERSHIP_ID, PATIENT_ID, PROGRAM_NAME, FEE_AMOUNT, STATUS

💉 INVENTORY TABLE:

6. GMH_CLINIC.PATIENT_DATA.VIALS (testosterone/controlled substance inventory)
   - VIAL_ID, DEA_DRUG_NAME, DEA_DRUG_CODE, LOT_NUMBER
   - SIZE_ML, REMAINING_VOLUME_ML
   - STATUS ('Active', 'Empty', 'Expired', 'Disposed')
   - LOCATION, DATE_RECEIVED, EXPIRATION_DATE, CREATED_AT, SYNCED_AT

⚠️ CRITICAL RULES:
1. ALWAYS filter by patient name when asked about a specific patient!
2. Use ILIKE '%Name%' for name matching (case-insensitive).
3. Use full table names: GMH_CLINIC.SCHEMA.TABLE
4. NEVER reference QB_CUSTOMER_ID in PATIENT_360_VIEW - it doesn't exist there.
5. Use DATEADD(DAY, -7, CURRENT_DATE()) for date arithmetic.
`;

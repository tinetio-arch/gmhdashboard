#!/usr/bin/env node
/**
 * SMS Chatbot Handler for NowPrimary.Care
 * 
 * ARCHITECTURE: Healthie-First
 * - Patient verification: Healthie (search by phone)
 * - Patient creation: Healthie (createClient)
 * - All data: Healthie
 * - SMS delivery: GHL (via existing sendSMS)
 * 
 * Port: 3003 (proxied via port 3001)
 */

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config({ path: '/home/ec2-user/.env.production' });
const { GHLClient } = require('./ghl-client');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.SMS_CHATBOT_PORT || 3003;
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const HEALTHIE_GROUP_ID = process.env.HEALTHIE_PRIMARY_CARE_GROUP_ID || '75523';
const HEALTHIE_PROVIDER_ID = process.env.HEALTHIE_PRIMARY_CARE_PROVIDER_ID || '12088269';

// Initialize GHL Client (for SMS delivery only)
const ghlClient = new GHLClient();

// In-memory conversation state (consider Redis for production)
const conversationState = new Map();

// Conversation TTL: 30 minutes
const CONVERSATION_TTL_MS = 30 * 60 * 1000;

/**
 * Healthie GraphQL client
 */
async function healthieQuery(query, variables = {}) {
    try {
        const response = await axios.post(HEALTHIE_API_URL,
            { query, variables },
            {
                headers: {
                    'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'AuthorizationSource': 'API'
                },
                timeout: 15000
            }
        );

        if (response.data.errors) {
            console.error('❌ Healthie GraphQL errors:', response.data.errors);
            throw new Error(response.data.errors[0]?.message || 'Healthie API error');
        }

        return response.data.data;
    } catch (error) {
        console.error('❌ Healthie API error:', error.message);
        throw error;
    }
}

/**
 * Normalize phone to 10 digits for Healthie search
 */
function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/\D/g, '');
    // Strip leading 1 from 11-digit US numbers
    if (digits.length === 11 && digits.startsWith('1')) {
        digits = digits.substring(1);
    }
    return digits;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

/**
 * Search for patient in Healthie by phone
 * Healthie's keywords search doesn't work for phone numbers,
 * so we fetch provider's patients and filter client-side
 */
async function findPatientByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;

    console.log(`   🔍 Searching Healthie for phone: ${normalizedPhone}`);

    // Fetch all patients for the provider and filter by phone
    const query = `
        query GetProviderPatients($providerId: String) {
            users(provider_id: $providerId, should_paginate: false) {
                id
                first_name
                last_name
                phone_number
                email
                dob
                dietitian { id first_name last_name }
            }
        }
    `;

    const result = await healthieQuery(query, { providerId: HEALTHIE_PROVIDER_ID });
    const users = result.users || [];

    console.log(`   📋 Found ${users.length} patients for provider`);

    // Find exact phone match
    const exactMatch = users.find(u =>
        normalizePhone(u.phone_number) === normalizedPhone
    );

    if (exactMatch) {
        console.log(`   ✅ Found match: ${exactMatch.first_name} ${exactMatch.last_name} (ID: ${exactMatch.id})`);
        return exactMatch;
    }

    console.log(`   ⚠️ No patient found with phone ${normalizedPhone}`);
    return null;
}

/**
 * Create new patient in Healthie
 */
async function createPatient(data) {
    const mutation = `
        mutation CreatePatient($input: createClientInput!) {
            createClient(input: $input) {
                user {
                    id
                    first_name
                    last_name
                    phone_number
                    email
                }
                messages {
                    field
                    message
                }
            }
        }
    `;

    const result = await healthieQuery(mutation, {
        input: {
            first_name: data.first_name || 'New',
            last_name: data.last_name || 'Patient',
            phone_number: data.phone,
            email: data.email || `sms_${normalizePhone(data.phone)}@nowprimary.care`,
            dob: data.dob || null,
            dietitian_id: HEALTHIE_PROVIDER_ID,
            user_group_id: HEALTHIE_GROUP_ID,
            skipped_email: true // Don't send welcome email for SMS patients
        }
    });

    if (result.createClient?.messages?.length > 0) {
        throw new Error(result.createClient.messages.map(m => m.message).join(', '));
    }

    return result.createClient?.user;
}

/**
 * Verify patient identity by checking name and DOB against Healthie record
 * Returns: { verified: boolean, message: string }
 */
function verifyPatientIdentity(patient, providedName, providedDob) {
    if (!patient) {
        return { verified: false, message: 'No patient record found for this phone number.' };
    }

    // Normalize names for comparison
    const patientFullName = `${patient.first_name} ${patient.last_name}`.toLowerCase().trim();
    const providedFullName = (providedName || '').toLowerCase().trim();

    // Check if name has at least partial match (first or last name)
    const patientFirstName = (patient.first_name || '').toLowerCase().trim();
    const patientLastName = (patient.last_name || '').toLowerCase().trim();

    const nameWords = providedFullName.split(/\s+/);
    const nameMatch = nameWords.some(word =>
        word.length > 2 && (
            patientFirstName.includes(word) ||
            patientLastName.includes(word) ||
            word.includes(patientFirstName) ||
            word.includes(patientLastName)
        )
    );

    if (!nameMatch) {
        console.log(`   ❌ Name mismatch: provided "${providedFullName}" vs record "${patientFullName}"`);
        return {
            verified: false,
            message: `I couldn't verify that name with our records. The name on file for this phone number doesn't match.\n\nIf this is a new phone number, would you like me to create a new patient account for you? Just reply YES to get started, or call us at 928-277-0001 for assistance.`
        };
    }

    // Check DOB if provided
    if (providedDob && patient.dob) {
        // Normalize DOB formats
        const patientDob = patient.dob.split('T')[0]; // "1985-05-12"
        const normalizedProvided = normalizeDob(providedDob);

        if (normalizedProvided && normalizedProvided !== patientDob) {
            console.log(`   ❌ DOB mismatch: provided "${normalizedProvided}" vs record "${patientDob}"`);
            return {
                verified: false,
                message: `The date of birth provided doesn't match our records.\n\nIf this is a new phone number, would you like me to create a new patient account? Reply YES to get started, or call 928-277-0001 for help.`
            };
        }
    }

    console.log(`   ✅ Identity verified for ${patient.first_name} ${patient.last_name}`);
    return { verified: true, message: `Thanks, ${patient.first_name}! I've verified your identity.` };
}

/**
 * Normalize DOB to YYYY-MM-DD format
 */
function normalizeDob(dob) {
    if (!dob) return null;

    // Try to parse various formats
    const cleaned = dob.replace(/[\/\-\.]/g, '/');
    const parts = cleaned.split('/');

    if (parts.length === 3) {
        let [a, b, c] = parts;

        // Determine format: MM/DD/YYYY or YYYY-MM-DD
        if (a.length === 4) {
            // YYYY-MM-DD
            return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
        } else {
            // MM/DD/YYYY or MM/DD/YY
            const year = c.length === 2 ? (parseInt(c) > 50 ? '19' + c : '20' + c) : c;
            return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
        }
    }

    return null;
}

/**
 * Get or create conversation state for a contact
 */
function getConversationState(phone) {
    const key = normalizePhone(phone);
    if (!conversationState.has(key)) {
        conversationState.set(key, {
            phone: key,
            currentIntent: null,
            awaitingInput: null,
            collectedData: {},
            messageHistory: [],
            verified: false,
            healthiePatient: null,
            ghlContactId: null,
            lastActivity: Date.now()
        });
    }
    const state = conversationState.get(key);
    state.lastActivity = Date.now();
    return state;
}

/**
 * Clean up old conversation states
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of conversationState.entries()) {
        if (now - state.lastActivity > CONVERSATION_TTL_MS) {
            conversationState.delete(key);
            console.log(`🧹 Cleaned up stale conversation for ${key}`);
        }
    }
}, 5 * 60 * 1000);

/**
 * System prompt for the AI assistant
 */
const SYSTEM_PROMPT = `You are Jessica, the AI assistant for NOW Primary Care. You help patients via text message.

Your capabilities:
- Schedule appointments (wellness, sick visit, follow-up, lab work, physical)
- Verify patient identity (requires name and date of birth)
- Create new patient accounts
- Process prescription refill requests (NOT testosterone - refer to Men's Health)
- Check patient billing balance and send payment links
- Answer questions about lab results (dates only, never values)
- Refer testosterone/TRT inquiries to NOW Men's Health Care (928-212-2772)

Practice Info:
- Name: NOW Primary Care (formerly Granite Mountain Health Clinic)
- Location: 404 South Montezuma Street, Suite A, Prescott, AZ 86303
- Hours: Monday-Friday 9:00 AM - 5:00 PM
- Part of NOWOptimal Health Network

CRITICAL AVAILABILITY CONSTRAINT:
If a patient asks about scheduling for January 6-12, 2026, you MUST say: "You will need human assistance to book for this week. Please call our front desk at (928) 277-0001."

Rules:
1. Be warm, friendly, and professional
2. Use emojis sparingly (✅, 📅, 💊)
3. Keep responses concise for SMS
4. ALWAYS verify identity (name + DOB) before sharing medical info
5. NEVER share lab values, only dates
6. Route testosterone/TRT to Men's Health immediately

Based on the conversation, determine the user's intent and what information is still needed.

Respond in JSON format:
{
  "intent": "greeting|schedule_appointment|verify_identity|new_patient|prescription_refill|billing_inquiry|lab_results|mens_health_referral|human_request|unknown",
  "response": "Your friendly response to the patient",
  "action": null or { "type": "action_name", "params": {} },
  "awaitingInput": null or "what_you_need_next"
}`;

/**
 * Call AWS Bedrock Claude for intent classification and response generation
 */
async function processWithAI(message, conversationState) {
    // Sanitize message to prevent JSON issues
    const sanitizedMessage = (message || '')
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\\/g, '\\\\')           // Escape backslashes
        .replace(/"/g, '\\"')             // Escape quotes
        .trim();

    const conversationContext = {
        verified: conversationState.verified,
        patientName: conversationState.healthiePatient?.first_name,
        healthiePatientId: conversationState.healthiePatient?.id,
        currentIntent: conversationState.currentIntent,
        awaitingInput: conversationState.awaitingInput,
        collectedData: conversationState.collectedData
    };

    const recentHistory = conversationState.messageHistory.slice(-6)
        .map(msg => `${msg.role === 'user' ? 'Patient' : 'Jessica'}: ${msg.content}`)
        .join('\n');

    const prompt = `${SYSTEM_PROMPT}

Current conversation state:
${JSON.stringify(conversationContext, null, 2)}

Recent conversation:
${recentHistory}

Patient's new message: "${sanitizedMessage}"

Respond in JSON format:
{
  "intent": "greeting|schedule_appointment|verify_identity|new_patient|prescription_refill|billing_inquiry|lab_results|mens_health_referral|human_request|unknown",
  "response": "Your friendly response to the patient",
  "action": null or { "type": "action_name", "params": {} },
  "awaitingInput": null or "what_you_need_next"
}`;

    try {
        const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
        const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

        const payload = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7
        };

        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(payload)
        });

        const response = await bedrock.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiText = responseBody.content[0].text;

        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const aiResponse = JSON.parse(jsonMatch[0]);
            console.log('🤖 Claude Response:', JSON.stringify(aiResponse));
            return aiResponse;
        } else {
            throw new Error('No JSON found in Claude response');
        }

    } catch (error) {
        console.error('❌ Bedrock API error:', error.message);

        // Context-aware error response instead of generic greeting
        const currentIntent = conversationState.currentIntent || 'unknown';
        let errorResponse;

        if (currentIntent === 'new_patient' || conversationState.awaitingInput === 'contact_and_insurance') {
            errorResponse = "I'm sorry, I had trouble processing that. Could you please provide your information again? I need your email address and phone number to complete your registration.";
        } else if (currentIntent === 'schedule_appointment') {
            errorResponse = "I'm sorry, I had a brief issue. Could you please repeat what time/date you'd like for your appointment?";
        } else if (currentIntent === 'verify_identity') {
            errorResponse = "I'm sorry, I had trouble with that. Could you please provide your full name and date of birth again?";
        } else {
            errorResponse = "I apologize, I had a brief technical issue. Could you please repeat your last message?";
        }

        return {
            intent: currentIntent,
            response: errorResponse,
            action: null,
            awaitingInput: conversationState.awaitingInput
        };
    }
}

/**
 * Send SMS response via GHL
 */
async function sendSMS(ghlContactId, message) {
    if (!ghlContactId) {
        console.error('❌ No GHL contact ID to send SMS');
        return false;
    }

    try {
        await ghlClient.sendSMS(ghlContactId, message);
        console.log(`📤 Sent SMS to ${ghlContactId}: ${message.substring(0, 50)}...`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send SMS: ${error.message}`);
        return false;
    }
}

/**
 * Main inbound message handler
 */
app.post('/api/ghl/inbound-message', async (req, res) => {
    try {
        const payload = req.body;

        // Extract fields from GHL payload
        const ghlContactId = payload.customData?.contactId ||
            payload.contact_id ||
            payload.contactId;

        let phone = payload.customData?.phone ||
            payload.phone ||
            payload.contact?.phone;
        if (phone) {
            phone = phone.replace(/\D/g, '');
            if (phone.length === 10) phone = '+1' + phone;
            else if (phone.length === 11 && phone.startsWith('1')) phone = '+' + phone;
        }

        const messageText = payload.customData?.message ||
            payload.message?.body ||
            payload.body ||
            (typeof payload.message === 'string' ? payload.message : null);

        console.log(`\n📨 Inbound SMS from ${phone}`);
        console.log(`   Message: "${messageText}"`);
        console.log(`   GHL Contact: ${ghlContactId}`);

        if (!phone) {
            return res.status(400).json({ error: 'Missing phone number' });
        }

        if (!messageText || messageText.trim() === '' || messageText.trim().toLowerCase() === 'undefined') {
            console.log('⚠️ No valid message content received (empty or "undefined")');
            return res.status(400).json({ error: 'Missing message content' });
        }

        // Get or create conversation state
        const state = getConversationState(phone);
        state.ghlContactId = ghlContactId;

        // HEALTHIE-FIRST: Look up patient in Healthie (but DON'T auto-verify)
        if (!state.healthiePatient) {
            console.log(`🔍 Searching Healthie for patient: ${phone}`);
            const patient = await findPatientByPhone(phone);

            if (patient) {
                console.log(`📋 Found Healthie patient: ${patient.first_name} ${patient.last_name} (ID: ${patient.id})`);
                state.healthiePatient = patient;
                // DO NOT set verified=true here - must verify name/DOB first!
                state.verified = false;
            } else {
                console.log(`⚠️ Patient not found in Healthie - new patient flow`);
            }
        }

        // Add incoming message to history
        state.messageHistory.push({ role: 'user', content: messageText });

        // Process with AI
        const aiResult = await processWithAI(messageText, state);

        // Update state
        state.currentIntent = aiResult.intent;
        state.awaitingInput = aiResult.awaitingInput;

        // HANDLE VERIFICATION ACTION - Check if AI is trying to verify identity
        // Accept multiple action type names the AI might use
        const verifyActionTypes = ['verify_identity', 'verify_patient', 'verify_account', 'verification'];
        const isVerifyAction = verifyActionTypes.includes(aiResult.action?.type);

        if (isVerifyAction) {
            const { name, dob } = aiResult.action.params || {};
            console.log(`🔐 Verifying identity: name="${name}", dob="${dob}"`);

            // MUST have a Healthie patient to verify against
            if (!state.healthiePatient) {
                console.log(`   ❌ VERIFICATION FAILED: No Healthie patient found for this phone`);
                state.verified = false;
                // Override AI response - don't let it say "verified"
                aiResult.response = "I couldn't verify that name with our records. There's no account linked to this phone number. Would you like me to create a new patient account for you? Just reply YES to get started, or call us at 928-277-0001 for assistance.";
                aiResult.awaitingInput = 'new_patient_confirmation';
                aiResult.action = null; // Cancel any further action
            } else {
                const verification = verifyPatientIdentity(state.healthiePatient, name, dob);

                if (verification.verified) {
                    state.verified = true;
                    console.log(`   ✅ VERIFIED: ${state.healthiePatient.first_name}`);
                    // Let AI response through
                } else {
                    state.verified = false;
                    console.log(`   ❌ VERIFICATION FAILED: ${verification.message}`);
                    // Override AI response with verification failure message
                    aiResult.response = verification.message;
                    aiResult.awaitingInput = 'correct_identity';
                    aiResult.action = null; // Cancel any further action
                }
            }
        }

        // VERIFICATION GATE: Block medical actions if NOT verified
        // Use keyword matching instead of exact names since AI can use variants like 
        // 'start_refill_request' vs 'request_prescription_refill'
        const actionType = (aiResult.action?.type || '').toLowerCase();
        const isMedicalAction = actionType && (
            actionType.includes('appointment') ||
            actionType.includes('refill') ||
            actionType.includes('lab') ||
            actionType.includes('balance') ||
            actionType.includes('payment') ||
            actionType.includes('patient_info') ||
            actionType.includes('prescri') ||
            actionType.includes('message_provider') ||
            actionType.includes('send_message') ||
            actionType.includes('results') ||
            actionType.includes('callback')
        );

        if (isMedicalAction && !state.verified) {
            console.log(`🚫 BLOCKED: Medical action "${aiResult.action.type}" requires verification`);

            if (state.healthiePatient) {
                // Patient exists but not verified - request verification
                aiResult.response = "I need to verify your identity before I can access your medical information. Could you please provide your full name and date of birth as they appear on your medical records? This protects your privacy. 🔒";
            } else {
                // No patient found - need to create account
                aiResult.response = "I don't see an existing patient record for this phone number. Would you like me to help you create a new patient account? I'll need your full name, date of birth, and email address.";
            }
            aiResult.action = null;
            aiResult.awaitingInput = 'identity_verification';
        }

        // EXECUTE CREATE PATIENT ACTION
        // Flexible matching: any action with 'patient' or 'registration' in name + email param
        // Note: actionType already declared above in verification gate
        const isPatientCreation = (actionType.includes('patient') || actionType.includes('registration') || actionType.includes('register'))
            && aiResult.action?.params?.email && !state.healthiePatient;
        if (isPatientCreation) {
            const params = aiResult.action.params;

            // Validate email before creating patient
            if (!isValidEmail(params.email)) {
                console.log(`   ❌ Invalid email format: ${params.email}`);
                aiResult.response = `The email "${params.email}" doesn't look right. Could you please provide a valid email address? (e.g., yourname@example.com)`;
                aiResult.action = null;
                aiResult.awaitingInput = 'valid_email';
            } else {
                console.log(`📝 Creating new patient account: ${params.name}`);

                try {
                    // Parse name
                    const nameParts = (params.name || '').trim().split(/\s+/);
                    const firstName = nameParts[0] || 'New';
                    const lastName = nameParts.slice(1).join(' ') || 'Patient';

                    // Normalize DOB to YYYY-MM-DD
                    let dob = params.dob;
                    if (dob && dob.includes('/')) {
                        const parts = dob.split('/');
                        if (parts.length === 3) {
                            const [m, d, y] = parts;
                            const year = y.length === 2 ? (parseInt(y) > 50 ? '19' + y : '20' + y) : y;
                            dob = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                        }
                    }

                    const newPatient = await createPatient({
                        first_name: firstName,
                        last_name: lastName,
                        phone: phone,
                        email: params.email,
                        dob: dob
                    });

                    if (newPatient) {
                        console.log(`   ✅ Created patient in Healthie: ${newPatient.first_name} ${newPatient.last_name} (ID: ${newPatient.id})`);
                        state.healthiePatient = newPatient;
                        state.verified = true; // New patient is automatically verified
                        state.collectedData = params;
                    } else {
                        console.log(`   ⚠️ Patient creation returned null`);
                        aiResult.response = "I had trouble creating your account. Please call us at 928-277-0001 and we'll help you get registered.";
                    }
                } catch (error) {
                    console.error(`   ❌ Failed to create patient: ${error.message}`);
                    aiResult.response = `I had trouble creating your account: ${error.message}. Please call us at 928-277-0001 for assistance.`;
                }
            }
        }

        // Handle special intents
        if (aiResult.intent === 'mens_health_referral') {
            aiResult.response = "For testosterone and men's health services, please contact NOW Men's Health Care:\n\n📞 928-212-2772\n📍 215 N McCormick St, Prescott\n\nThey specialize in TRT and men's hormone optimization!";
        }

        // Add AI response to history
        state.messageHistory.push({ role: 'assistant', content: aiResult.response });

        // Send response via GHL - track success/failure
        const smsDelivered = await sendSMS(ghlContactId, aiResult.response);
        if (!smsDelivered) {
            console.warn(`⚠️ SMS delivery failed for contact ${ghlContactId}`);
        }

        res.json({
            success: true,
            intent: aiResult.intent,
            healthie_patient_id: state.healthiePatient?.id,
            verified: state.verified,
            response_sent: true,
            sms_delivered: smsDelivered
        });

    } catch (error) {
        console.error('❌ Inbound message handler error:', error);
        res.status(500).json({ error: 'Processing failed', message: error.message });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'SMS Chatbot Handler (Healthie-First)',
        port: PORT,
        ai_engine: 'AWS Bedrock Claude',
        auth_source: 'Healthie',
        sms_delivery: 'GHL',
        conversations_active: conversationState.size
    });
});

/**
 * Debug endpoint (requires auth)
 */
app.get('/api/debug/conversations', (req, res) => {
    // Require webhook secret for debug access
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.GHL_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const states = {};
    for (const [key, state] of conversationState.entries()) {
        states[key] = {
            verified: state.verified,
            healthiePatientId: state.healthiePatient?.id,
            patientName: state.healthiePatient?.first_name,
            ghlContactId: state.ghlContactId,
            currentIntent: state.currentIntent,
            messageCount: state.messageHistory.length,
            lastActivity: new Date(state.lastActivity).toISOString()
        };
    }
    res.json(states);
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🤖 SMS Chatbot Handler (Healthie-First) running on port ${PORT}`);
    console.log(`📍 Endpoints:`);
    console.log(`   POST /api/ghl/inbound-message`);
    console.log(`   GET  /health`);
    console.log(`\n✅ Auth Source: Healthie`);
    console.log(`✅ AI Engine: AWS Bedrock Claude`);
    console.log(`✅ SMS Delivery: GHL`);
    console.log(`\n🚀 Ready to receive SMS messages!\n`);
});

module.exports = app;

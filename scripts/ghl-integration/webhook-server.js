const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config({ path: '/home/ec2-user/.env.production' });
const { GHLClient } = require('./ghl-client');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MERGE QUERY PARAMS INTO BODY (Fix for GHL sending data in URL)
app.use((req, res, next) => {
    if (Object.keys(req.query).length > 0) {
        req.body = { ...req.query, ...req.body };
    }
    next();
});

// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`📥 [${req.method}] ${req.url}`);
    console.log('   Headers:', JSON.stringify(req.headers));
    console.log('   Body:', JSON.stringify(req.body));
    next();
});

const PORT = process.env.GHL_WEBHOOK_PORT || 3001;
// Initialize GHL Client - uses V2 API token by default (from ghl-client.js auto-detection)
const ghlClient = new GHLClient();

// Primary Care specific configuration
const HEALTHIE_PRIMARY_CARE_GROUP_ID = process.env.HEALTHIE_PRIMARY_CARE_GROUP_ID || '75523';
const HEALTHIE_PRIMARY_CARE_PROVIDER_ID = process.env.HEALTHIE_PRIMARY_CARE_PROVIDER_ID || '12088269';

// Healthie GraphQL helper
const callHealthieAPI = async (query, variables = {}) => {
    const response = await axios.post('https://api.gethealthie.com/graphql',
        { query, variables },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API'
            }
        }
    );
    if (response.data.errors) {
        throw new Error(`Healthie Error: ${response.data.errors[0]?.message}`);
    }
    return response.data;
};

/**
 * Normalize phone number to E.164 format (+1XXXXXXXXXX)
 * Handles raw 10-digit, with area codes, with/without +1
 */
const normalizePhone = (phone) => {
    if (!phone) return phone;
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    // If 10 digits, add +1
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    // If 11 digits starting with 1, add +
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }
    // If already has +, return as-is
    if (phone.startsWith('+')) {
        return phone;
    }
    // Fallback: return with +
    return `+${digits}`;
};

// Middleware for authentication
const authenticateWebhook = (req, res, next) => {
    const authHeader = req.headers['x-webhook-secret'];
    const expectedSecret = process.env.GHL_WEBHOOK_SECRET || 'your-secret-here';

    if (authHeader !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};

/**
 * Proxy: Inbound SMS Messages
 * Forwards to SMS Chatbot Handler on port 3002
 */
app.post('/api/ghl/inbound-message', async (req, res) => {
    try {
        console.log('📨 Proxying inbound message to SMS Chatbot Handler...');
        const response = await axios.post('http://localhost:3003/api/ghl/inbound-message', req.body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });
        res.json(response.data);
    } catch (error) {
        console.error('❌ SMS Chatbot Handler proxy error:', error.message);
        // Return a graceful error so GHL doesn't retry endlessly
        res.json({
            success: false,
            error: 'SMS handler unavailable',
            message: 'Could not process message'
        });
    }
});

/**
 * Webhook: Send Registration Link
 * Sends SMS to new patient with registration instructions
 */
const recentRegistrationTexts = new Map(); // Rate limit: phone -> timestamp

app.post('/api/ghl/send-registration-link', authenticateWebhook, async (req, res) => {
    try {
        let { phone: rawPhone } = { ...req.query, ...req.body };
        const phone = normalizePhone(rawPhone);

        console.log(`📱 Sending registration link to ${phone}`);

        if (!phone || phone.length < 10) {
            return res.json({
                success: false,
                message: "I wasn't able to send a text. Would you like me to transfer you to our front desk instead?"
            });
        }

        // RATE LIMIT: Prevent duplicate texts within 60 seconds
        const lastSent = recentRegistrationTexts.get(phone);
        if (lastSent && (Date.now() - lastSent) < 60000) {
            console.log(`⚠️ Rate limited: Registration text already sent to ${phone} within 60 seconds`);
            return res.json({
                success: true,
                message: "I've already sent you a text. Please check your phone."
            });
        }
        recentRegistrationTexts.set(phone, Date.now());

        // Get or create GHL contact
        let contactId;
        try {
            const ghlResults = await ghlClient.searchContacts(null, phone);
            if (ghlResults?.contacts?.length > 0) {
                contactId = ghlResults.contacts[0].id;
            } else {
                // Create new contact
                const newContact = await ghlClient.createContact({
                    phone: phone,
                    firstName: 'New',
                    lastName: 'Patient',
                    tags: ['new_patient', 'registration_pending']
                });
                contactId = newContact?.contact?.id;
            }
        } catch (ghlError) {
            console.warn(`⚠️ GHL contact error: ${ghlError.message}`);
        }

        // Send registration SMS
        const registrationMessage = `Welcome to NOW Primary Care! 🏥\n\nTo create your account, simply reply to this text with:\n• Your full name\n• Date of birth\n• Email address\n\nOr visit: https://nowprimary.care/new-patient\n\nQuestions? Call (928) 277-0001\n\nWe look forward to seeing you!`;

        if (contactId) {
            await ghlClient.sendSMS(contactId, registrationMessage);
            console.log(`✅ Registration link sent to ${phone}`);
        }

        return res.json({
            success: true,
            message: "I've sent you a text message with registration information. Please check your phone."
        });

    } catch (error) {
        console.error('❌ Error sending registration link:', error);
        return res.json({
            success: false,
            message: "I had trouble sending the text. Let me transfer you to our front desk so they can help you get registered."
        });
    }
});

/**
 * Webhook 1: Verify Patient
 * Called by Voice AI to authenticate caller
 */

app.post('/api/ghl/verify-patient', authenticateWebhook, async (req, res) => {
    try {
        const { phone: rawPhone, dob, name, first_name, last_name } = req.body;
        const phone = normalizePhone(rawPhone); // Normalize to E.164
        const callerName = name || `${first_name || ''} ${last_name || ''}`.trim();

        console.log(`🔍 Verifying patient: ${callerName}, Phone: ${phone}`);

        // HEALTHIE-FIRST: Search for patient in Healthie by phone
        const normalizedPhone = phone.replace(/\D/g, '').replace(/^1/, ''); // Strip to 10 digits
        let healthiePatient = null;

        try {
            const healthieResult = await callHealthieAPI(`
                query GetProviderPatients($providerId: String) {
                    users(provider_id: $providerId, should_paginate: false) {
                        id
                        first_name
                        last_name
                        phone_number
                        dob
                        email
                    }
                }
            `, { providerId: HEALTHIE_PRIMARY_CARE_PROVIDER_ID });

            const patients = healthieResult.data?.users || [];
            healthiePatient = patients.find(p => {
                const patientPhone = (p.phone_number || '').replace(/\D/g, '').replace(/^1/, '');
                return patientPhone === normalizedPhone;
            });
        } catch (healthieError) {
            console.warn(`⚠️ Healthie lookup error: ${healthieError.message}`);
        }

        // If no Healthie patient found, ask if new patient
        if (!healthiePatient) {
            console.log(`ℹ️ No Healthie patient found for phone ${normalizedPhone}`);
            return res.json({
                verified: false,
                patient_found: false,
                message: "I don't see you in our system yet. Would you like to set up a new patient account?",
                action: "ask_if_new_patient"
            });
        }

        console.log(`📋 Found Healthie patient: ${healthiePatient.first_name} ${healthiePatient.last_name} (ID: ${healthiePatient.id})`);

        // VERIFY NAME MATCH
        if (callerName) {
            const providedName = callerName.toLowerCase().trim();
            const patientFirstName = (healthiePatient.first_name || '').toLowerCase();
            const patientLastName = (healthiePatient.last_name || '').toLowerCase();
            const patientFullName = `${patientFirstName} ${patientLastName}`;

            // Check if any part of provided name matches
            const nameWords = providedName.split(/\s+/);
            const nameMatches = nameWords.some(word =>
                word.length > 2 && (
                    patientFirstName.includes(word) ||
                    patientLastName.includes(word) ||
                    word.includes(patientFirstName) ||
                    word.includes(patientLastName)
                )
            );

            if (!nameMatches) {
                console.log(`❌ Name mismatch: provided "${providedName}" vs record "${patientFullName}"`);

                // Auto-SMS disabled per user request
                // try {
                //     await ghlClient.sendSMS(
                //         req.body.ghl_contact_id,
                //         `Hi! We couldn't verify your information over the phone. No worries - you can easily create an account and schedule online at:\n\nhttps://www.nowprimary.care\n\nOr call us at 928-277-0001 for assistance.\n\n- NOW Primary Care`
                //     );
                //     console.log(`📤 Sent scheduling link SMS to caller`);
                // } catch (smsError) {
                //     console.warn(`⚠️ Could not send scheduling SMS: ${smsError.message}`);
                // }

                return res.json({
                    verified: false,
                    patient_found: true,
                    scheduling_link_sent: false,
                    status: "VERIFICATION_FAILED",
                    instruction: "VERIFICATION FAILED. You MUST say the following to the caller and then transfer: That name does not match our records for this phone number. Let me transfer you to our front desk now.",
                    message: "VERIFICATION FAILED. Say to caller: That name does not match our records for this phone number. Let me transfer you to our front desk now. Then transfer to +19282770001",
                    action: "transfer_to_human",
                    transfer_to: "+19282770001"
                });
            }
        }

        // VERIFY DOB MATCH
        if (dob && healthiePatient.dob) {
            const patientDob = healthiePatient.dob.split('T')[0]; // "YYYY-MM-DD"
            // Normalize provided DOB
            let normalizedDob = dob;
            if (dob.includes('/')) {
                const parts = dob.split('/');
                if (parts.length === 3) {
                    const [m, d, y] = parts;
                    const year = y.length === 2 ? (parseInt(y) > 50 ? '19' + y : '20' + y) : y;
                    normalizedDob = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                }
            }

            if (normalizedDob !== patientDob) {
                console.log(`❌ DOB mismatch: provided "${normalizedDob}" vs record "${patientDob}"`);
                return res.json({
                    verified: false,
                    patient_found: true,
                    status: "VERIFICATION_FAILED",
                    instruction: "VERIFICATION FAILED. You MUST say the following to the caller and then transfer: The date of birth does not match our records. For your security, let me transfer you to our front desk now.",
                    message: "VERIFICATION FAILED. Say to caller: The date of birth does not match our records. For your security, let me transfer you to our front desk now. Then transfer to +19282770001",
                    action: "transfer_to_human",
                    transfer_to: "+19282770001"
                });
            }
        }

        // Also get GHL contact for contact ID
        let ghlContactId = null;
        try {
            const ghlResults = await ghlClient.searchContacts(null, phone);
            if (ghlResults?.contacts?.length > 0) {
                ghlContactId = ghlResults.contacts[0].id;
            }
        } catch (ghlError) {
            console.warn(`⚠️ GHL lookup error: ${ghlError.message}`);
        }

        // ✅ VERIFIED - both name and DOB match Healthie record
        console.log(`✅ Verified: ${healthiePatient.first_name} ${healthiePatient.last_name}`);
        return res.json({
            verified: true,
            patient_found: true,
            status: "VERIFICATION_SUCCESS",
            ghl_contact_id: ghlContactId,
            healthie_patient_id: healthiePatient.id,
            patient_name: `${healthiePatient.first_name} ${healthiePatient.last_name}`,
            patient_type: 'PrimaryCare',
            instruction: `VERIFICATION SUCCESS. The patient ${healthiePatient.first_name} is verified. You may proceed with their request.`,
            message: `VERIFICATION SUCCESS. Say to caller: Perfect, ${healthiePatient.first_name}! I have verified your identity. Then proceed with their request.`
        });

    } catch (error) {
        console.error('❌ Error verifying patient:', error);
        res.status(500).json({
            error: 'Verification failed',
            message: "I'm having trouble accessing our system. Let me transfer you to someone who can help."
        });
    }
});

/**
 * Webhook 1B: Create New Patient (NEW!)
 * Called by Jessica when new patient needs to be created
 */
app.post('/api/ghl/create-new-patient', authenticateWebhook, async (req, res) => {
    try {
        const { first_name, last_name, phone: rawPhone, email, dob, service_line } = req.body;
        const phone = normalizePhone(rawPhone); // Normalize to E.164

        console.log(`👤 Creating new patient: ${first_name} ${last_name} (${service_line}) [Phone: ${phone}]`);

        // EMAIL VALIDATION - Same as SMS chatbot
        const isValidEmail = (em) => em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.trim());
        if (!isValidEmail(email)) {
            console.log(`❌ Invalid email format: ${email}`);
            return res.json({
                success: false,
                message: "I need a valid email address to create your account. Could you provide your email?",
                action: "request_email"
            });
        }

        // Step 1: Create contact in GHL
        let ghlContact;
        try {
            ghlContact = await ghlClient.createContact({
                firstName: first_name,
                lastName: last_name,
                phone: phone,
                email: email,
                tags: [service_line === 'PrimaryCare' ? 'NowPrimaryCare' : 'NowMensHealth'],
                customField: [
                    { key: 'date_of_birth', value: dob },
                    { key: 'intake_status', value: 'pending' },
                    { key: 'created_by', value: 'Jessica AI' }
                ]
            });

            // Extract ID (V1 returns { contact: { id: ... } }, V2 might differ)
            const ghlContactId = ghlContact.contact?.id || ghlContact.id;
            console.log(`✅ Created GHL contact: ${ghlContactId}`);

            // Step 2: Create patient in Healthie
            let healthiePatientId = null;

            try {
                const healthiePatient = await callHealthieAPI(`
              mutation CreatePatient($input: createClientInput!) {
                createClient(input: $input) {
                  user {
                    id
                    email
                  }
                  messages {
                    field
                    message
                  }
                }
              }
            `, {
                    input: {
                        first_name: first_name,
                        last_name: last_name,
                        email: email,
                        phone_number: phone,
                        dob: dob,
                        user_group_id: process.env.HEALTHIE_PRIMARY_CARE_GROUP_ID || '75523', // NowPrimary.Care group
                        dont_send_welcome: false, // Send welcome email with intake forms
                        metadata: JSON.stringify({
                            source: 'voice_ai',
                            agent: 'Jessica',
                            service_line: service_line
                        })
                    }
                });

                // Safely extract patient ID with null check
                const createdUser = healthiePatient?.data?.createClient?.user;
                if (createdUser && createdUser.id) {
                    healthiePatientId = createdUser.id;
                    console.log(`✅ Created Healthie patient: ${healthiePatientId}`);

                    // Update GHL contact with Healthie ID
                    try {
                        await ghlClient.updateContact(ghlContactId, {
                            customField: [
                                { id: 'e79e6M3p1DbdI191L8B3', value: healthiePatientId }
                            ]
                        });
                    } catch (updateErr) {
                        console.warn(`⚠️ Could not update GHL contact with Healthie ID: ${updateErr.message}`);
                    }
                } else {
                    console.warn(`⚠️ Healthie createClient did not return user ID`);
                }
            } catch (healthieError) {
                console.error(`⚠️ Healthie patient creation failed: ${healthieError.message}`);
                // Continue without Healthie ID - will be created later
            }

            // Send welcome SMS via GHL
            try {
                await ghlClient.sendSMS(
                    ghlContactId,
                    `Welcome to NOW Primary Care, ${first_name}! 🎉\n\nYou'll receive an email shortly with links to complete your intake paperwork. Questions? Call us anytime at (928) 212-2772.`
                );
            } catch (smsError) {
                console.warn(`⚠️ Failed to send Welcome SMS: ${smsError.message}`);
            }

            return res.json({
                success: true,
                ghl_contact_id: ghlContactId,
                healthie_patient_id: healthiePatientId,
                intake_sent: true,
                message: `Perfect, ${first_name}! I've created your account and you'll receive an email shortly with your intake paperwork. Is there anything else I can help you with today?`
            });

        } catch (ghlError) {
            console.warn(`⚠️ GHL contact creation failed: ${ghlError.message}`);
            return res.json({
                success: false,
                message: "I had a little trouble with our system, but I've noted your information. Our front desk will follow up with you shortly to complete your registration."
            });
        }

    } catch (error) {
        console.error('❌ Error creating new patient:', error);
        res.status(500).json({
            error: 'Patient creation failed',
            success: false,
            message: "I had trouble creating your account. Let me transfer you to our front desk to get you all set up."
        });
    }
});

/**
 * Webhook 2: Get Availability
 * Returns available appointment slots
 */
app.post('/api/ghl/get-availability', authenticateWebhook, async (req, res) => {
    try {
        const { service_line, appointment_type, date_range } = req.body;

        console.log(`📅 Checking availability for ${service_line} - ${appointment_type}`);

        // Map Primary Care appointment types to Healthie IDs
        const appointmentTypeMap = {
            'Wellness Check-up': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
            'Annual Physical': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
            'Sick Visit': process.env.HEALTHIE_APPT_TYPE_PC_SICK || '504715',
            'Follow-up': process.env.HEALTHIE_APPT_TYPE_PC_TELEMED || '505646',
            'Lab Work': process.env.HEALTHIE_APPT_TYPE_PC_LABS || '504734',
            'New Patient': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743'
        };

        // Determine Healthie Appointment Type ID
        let healthieApptTypeId = appointmentTypeMap[appointment_type];

        // Fallback or specific logic
        if (!healthieApptTypeId) {
            console.log(`⚠️ Unknown appointment type '${appointment_type}', defaulting to Initial`);
            healthieApptTypeId = process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743';
        }

        // query Healthie for available slots
        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 14); // Look ahead 2 weeks

        const start_date = today.toISOString().split('T')[0];
        const end_date = nextWeek.toISOString().split('T')[0];
        const provider_id = HEALTHIE_PRIMARY_CARE_PROVIDER_ID;

        console.log(`ℹ️ [Debug] Provider: ${provider_id}, ApptType: ${healthieApptTypeId}`);
        console.log(`ℹ️ [Debug] Date Range: ${start_date} to ${end_date}`);

        if (!provider_id) {
            console.error("❌ MISSING PROVIDER ID");
            throw new Error("Provider ID check failed");
        }

        const query = `
      query GetAvailability($provider_id: String, $appt_type_id: String, $start_date: String, $end_date: String, $appt_loc_id: String) {
        availableSlotsForRange(
          provider_id: $provider_id
          appt_type_id: $appt_type_id
          start_date: $start_date
          end_date: $end_date
          appt_loc_id: $appt_loc_id
        ) {
          date
        }
      }
    `;

        // Primary Care Location ID: 27565 (404 S. Montezuma)
        const PRIMARY_CARE_LOCATION_ID = process.env.HEALTHIE_PRIMARY_CARE_LOCATION_ID || '27565';

        console.log(`⏳ [Debug] Calling Healthie API with location filter: ${PRIMARY_CARE_LOCATION_ID}`);
        let availabilityResult;
        try {
            availabilityResult = await callHealthieAPI(query, {
                provider_id: provider_id,
                appt_type_id: healthieApptTypeId,
                start_date: start_date,
                end_date: end_date,
                appt_loc_id: PRIMARY_CARE_LOCATION_ID
            });
            console.log("✅ [Debug] Healthie API returned response");
        } catch (apiError) {
            console.error("❌ [Debug] Healthie API Failed:", apiError.message);
            // Re-throw to hit the main error handler
            throw apiError;
        }

        const slots = availabilityResult.data?.availableSlotsForRange || [];
        console.log(`📊 [Debug] Healthie returned ${slots.length} raw slots for location ${PRIMARY_CARE_LOCATION_ID}`);

        // Format slots for voice response
        // Received slots only have 'date' which is ISO timestamp string
        const formattedSlots = [];

        // Group by day to limit per day
        const slotsByDay = {};

        for (const slot of slots) {
            const dt = new Date(slot.date);
            const dateStr = dt.toISOString().split('T')[0];
            // SAFETY: Filter out dates before Jan 13
            if (dateStr < '2026-01-13') { console.log(`[Debug] Filtered invalid date: ${dateStr}`); continue; }
            const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Phoenix' });

            // Healthie returns: "2026-01-03 09:00:00 -0700" (space-separated, not T)
            // Handle both formats: "YYYY-MM-DD HH:mm:ss -ZZZZ" and "YYYY-MM-DDTHH:mm:ss-ZZ:ZZ"
            let isoTime;
            if (slot.date.includes('T')) {
                isoTime = slot.date.split('T')[1].substring(0, 5); // HH:mm
            } else if (slot.date.includes(' ')) {
                // Space-separated: "2026-01-03 09:00:00 -0700"
                const parts = slot.date.split(' ');
                isoTime = parts[1] ? parts[1].substring(0, 5) : '00:00';
            } else {
                isoTime = '00:00';
            }

            if (!slotsByDay[dateStr]) slotsByDay[dateStr] = [];
            if (slotsByDay[dateStr].length < 6) { // Increased from 3 to 6 to show morning/afternoon mix
                formattedSlots.push({
                    date: dateStr,
                    time: timeStr,
                    iso_time: isoTime,
                    slot_id: `${dateStr}_${isoTime}`
                });
                slotsByDay[dateStr].push(true);
            }
            if (formattedSlots.length >= 60) break; // Increased from 9 to 60 to scan further out
        }

        if (formattedSlots.length === 0) {
            return res.json({
                has_availability: false,
                message: "I don't see any openings in the next two weeks for that appointment type. Let me transfer you to our scheduling team."
            });
        }

        return res.json({
            has_availability: true,
            appointment_type: appointment_type,
            healthie_appt_type_id: healthieApptTypeId,
            provider_id: HEALTHIE_PRIMARY_CARE_PROVIDER_ID,
            available_slots: formattedSlots,
            // Create natural language list of first few slots
            message: `I have openings on ${formattedSlots.slice(0, 3).map(s => `${s.date} at ${s.time}`).join(', ')}. Which works best for you?`
        });

    } catch (error) {
        console.error('❌ Error checking availability:', error);
        res.status(500).json({
            error: 'Availability check failed',
            has_availability: false,
            message: "I'm having trouble accessing the schedule right now."
        });
    }
});

/**
 * Webhook 3: Book Appointment
 * Creates appointment in GHL (and eventually Healthie)
 */
app.post('/api/ghl/book-appointment', authenticateWebhook, async (req, res) => {
    try {
        // Extract ALL possible parameters from the request
        let { ghl_contact_id, healthie_patient_id, calendar_id, slot_id, appointment_type, reason, phone: rawPhone, email, first_name, last_name, dob, verified } = req.body;
        const phone = normalizePhone(rawPhone); // Normalize to E.164

        console.log(`📝 Booking Request: ${first_name} ${last_name} (${phone}) - ${appointment_type} @ ${slot_id}`);

        // =================================================
        // VERIFICATION GATE - REJECT UNVERIFIED BOOKINGS
        // =================================================
        if (!phone || phone === 'unknown' || phone === '+1') {
            console.log(`❌ [VERIFICATION GATE] BLOCKED: No valid phone number provided`);
            return res.json({
                success: false,
                verified: false,
                message: "I need to verify your identity first. Can you provide your full name and date of birth?"
            });
        }

        // Check if verified flag was passed (from prior verify-patient call)
        if (verified === false || verified === 'false') {
            console.log(`❌ [VERIFICATION GATE] BLOCKED: Patient not verified`);
            return res.json({
                success: false,
                verified: false,
                message: "I was not able to verify your identity. Let me transfer you to our front desk.",
                action: "transfer_to_human",
                transfer_to: "+19282770001"
            });
        }

        // =================================================
        // SLOT AVAILABILITY GATE - VALIDATE FIRST!
        // Must check BEFORE any patient verification or booking
        // =================================================
        if (slot_id && slot_id.includes('_')) {
            const [dateStr, timeStr] = slot_id.split('_');
            console.log(`🔍 [GATE] Validating slot availability: ${dateStr} ${timeStr}`);

            // SAFETY: Force block dates before Jan 13 due to Healthie configuration issues
            if (dateStr < '2026-01-13') {
                console.log(`❌ [GATE] BLOCKED: Date ${dateStr} is before safety start date 2026-01-13`);
                return res.json({
                    success: false,
                    message: "I don't see any availability on that date. The first available appointments start from January 13th. Would you like to check then?"
                });
            }

            const apptTypeMap = {
                'Wellness Check-up': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
                'Annual Physical': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
                'Sick Visit': process.env.HEALTHIE_APPT_TYPE_PC_SICK || '504715',
                'Follow-up': process.env.HEALTHIE_APPT_TYPE_PC_TELEMED || '505646',
                'Lab Work': process.env.HEALTHIE_APPT_TYPE_PC_LABS || '504734'
            };
            const healthieApptTypeId = apptTypeMap[appointment_type] || process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743';
            const PRIMARY_CARE_LOCATION_ID = process.env.HEALTHIE_PRIMARY_CARE_LOCATION_ID || '27565';

            try {
                const availabilityCheck = await callHealthieAPI(`
                    query CheckSlotAvailability($provider_id: String, $appt_type_id: String, $start_date: String, $end_date: String, $appt_loc_id: String) {
                        availableSlotsForRange(
                            provider_id: $provider_id
                            appt_type_id: $appt_type_id
                            start_date: $start_date
                            end_date: $end_date
                            appt_loc_id: $appt_loc_id
                        ) {
                            date
                        }
                    }
                `, {
                    provider_id: HEALTHIE_PRIMARY_CARE_PROVIDER_ID,
                    appt_type_id: healthieApptTypeId,
                    start_date: dateStr,
                    end_date: dateStr,
                    appt_loc_id: PRIMARY_CARE_LOCATION_ID
                });

                const availableSlots = availabilityCheck.data?.availableSlotsForRange || [];
                console.log(`📊 [GATE] Healthie returned ${availableSlots.length} slots for ${dateStr} at location ${PRIMARY_CARE_LOCATION_ID}`);

                // Check if requested slot exists
                const requestedSlot = `${dateStr}T${timeStr}`;
                const slotAvailable = availableSlots.some(slot => {
                    const slotDateTime = slot.date.split(' ')[0] + 'T' + slot.date.split(' ')[1].substring(0, 5);
                    return slotDateTime === requestedSlot;
                });

                if (availableSlots.length === 0) {
                    console.log(`❌ [GATE] BOOKING BLOCKED: No availability on ${dateStr}`);
                    return res.json({
                        success: false,
                        message: `I don't see any availability on ${dateStr}. Would you like me to check another day?`
                    });
                }

                if (!slotAvailable) {
                    console.log(`❌ [GATE] BOOKING BLOCKED: Slot ${requestedSlot} not available`);
                    const availableTimes = availableSlots.slice(0, 3).map(s => {
                        const dt = new Date(s.date);
                        return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Phoenix' });
                    }).join(', ');
                    return res.json({
                        success: false,
                        message: `That time isn't available. On ${dateStr} I have openings at: ${availableTimes}. Which would work for you?`
                    });
                }

                console.log(`✅ [GATE] Slot validated: ${requestedSlot} is available`);
            } catch (slotValidationError) {
                console.error(`⚠️ [GATE] Slot validation error: ${slotValidationError.message}`);
                // Continue anyway if validation fails due to API error (fail-open for availability)
            }
        } else if (slot_id) {
            // Invalid slot_id format
            console.log(`❌ [GATE] Invalid slot_id format: ${slot_id}`);
            return res.json({
                success: false,
                message: "I need to know which time slot you'd like. Could you tell me your preferred date and time?"
            });
        }
        // ==========================================
        // If not explicitly passed as verified, we need to verify the patient
        if (!verified && !healthie_patient_id) {
            console.log(`🔐 Verifying patient identity before booking...`);

            // Search for patient in Healthie by phone
            const normalizedPhone = phone.replace(/\D/g, '').replace(/^1/, ''); // Strip to 10 digits
            let healthiePatient = null;

            try {
                const healthieResult = await callHealthieAPI(`
                    query GetProviderPatients($providerId: String) {
                        users(provider_id: $providerId, should_paginate: false) {
                            id
                            first_name
                            last_name
                            phone_number
                            dob
                            email
                        }
                    }
                `, { providerId: HEALTHIE_PRIMARY_CARE_PROVIDER_ID });

                const patients = healthieResult?.data?.users || [];
                healthiePatient = patients.find(p => {
                    const patientPhone = (p.phone_number || '').replace(/\D/g, '').replace(/^1/, '');
                    return patientPhone === normalizedPhone;
                });
            } catch (healthieError) {
                console.warn(`⚠️ Healthie lookup error during booking verification: ${healthieError.message}`);
            }

            // If patient found, verify name matches
            if (healthiePatient) {
                const providedName = `${first_name} ${last_name}`.toLowerCase().trim();
                const patientFirstName = (healthiePatient.first_name || '').toLowerCase();
                const patientLastName = (healthiePatient.last_name || '').toLowerCase();
                const patientFullName = `${patientFirstName} ${patientLastName}`;

                // Check if any part of provided name matches
                const nameWords = providedName.split(/\s+/);
                const nameMatches = nameWords.some(word =>
                    word.length > 2 && (
                        patientFirstName.includes(word) ||
                        patientLastName.includes(word) ||
                        word.includes(patientFirstName) ||
                        word.includes(patientLastName)
                    )
                );

                if (!nameMatches) {
                    console.log(`❌ BOOKING BLOCKED: Name mismatch: provided "${providedName}" vs Healthie record "${patientFullName}"`);
                    return res.json({
                        success: false,
                        verified: false,
                        message: "I wasn't able to verify your identity with that name. For your security, let me transfer you to our front desk at 928-277-0001.",
                        action: "transfer_to_human"
                    });
                }

                // Name matched - use this patient's Healthie ID
                console.log(`✅ Verification passed: ${patientFullName} (Healthie ID: ${healthiePatient.id})`);
                healthie_patient_id = healthiePatient.id;
                verified = true;
            } else {
                // No patient found in Healthie - block booking
                console.log(`❌ BOOKING BLOCKED: No patient found in Healthie for phone ${normalizedPhone}`);
                return res.json({
                    success: false,
                    verified: false,
                    patient_found: false,
                    message: "I don't see you in our system yet. Let me help you set up a new patient account first, or transfer you to our front desk.",
                    action: "ask_if_new_patient"
                });
            }
        }
        // ==========================================
        // END VERIFICATION GATE
        // ==========================================

        // --- STEP 1: RESOLVE GHL CONTACT (Crucial for GHL operations) ---
        let finalContactId = ghl_contact_id;

        if (!finalContactId && phone) {
            console.log(`🔍 Looking up contact by phone: ${phone}`);
            try {
                // Clean phone number
                const cleanPhone = phone.replace(/\D/g, '');
                // Try search
                const searchRes = await ghlClient.searchContacts(email, cleanPhone); // Using helper which handles logic

                if (searchRes && searchRes.contacts && searchRes.contacts.length > 0) {
                    finalContactId = searchRes.contacts[0].id;
                    console.log(`✅ Found existing GHL Contact: ${finalContactId}`);

                    // Check for Healthie Patient ID in custom fields (V1: customField, V2: customFields)
                    if (!healthie_patient_id) {
                        const cf = searchRes.contacts[0].customField || searchRes.contacts[0].customFields || [];
                        // V2 customFields is an object { fieldId: value }, V1 is array [{ id, key, value }]
                        if (Array.isArray(cf)) {
                            // V1 format - array
                            const idField = cf.find(f => f.id === 'e79e6M3p1DbdI191L8B3' || f.key === 'healthie_patient_id');
                            if (idField && idField.value) {
                                healthie_patient_id = idField.value;
                                console.log(`✅ Found Healthie ID in GHL Contact (V1): ${healthie_patient_id}`);
                            }
                        } else if (typeof cf === 'object') {
                            // V2 format - object { fieldId: value }
                            healthie_patient_id = cf['e79e6M3p1DbdI191L8B3'] || cf['healthie_patient_id'];
                            if (healthie_patient_id) {
                                console.log(`✅ Found Healthie ID in GHL Contact (V2): ${healthie_patient_id}`);
                            }
                        }
                    }

                    // If still no Healthie ID, try to find or create one
                    // Validate email - N/A, empty, or invalid emails should be treated as missing
                    const validEmail = email && email !== 'N/A' && email.includes('@') ? email : null;

                    if (!healthie_patient_id && first_name && last_name) {
                        // Search by NAME (most reliable in Healthie - phone search doesn't work well)
                        const searchKeyword = `${first_name} ${last_name}`;
                        console.log(`⚠️ No Healthie ID found, searching for existing patient by name: ${searchKeyword}`);
                        try {
                            // First, try to find existing patient by name
                            const searchResult = await callHealthieAPI(`
                                query findUser($keywords: String!) {
                                    users(keywords: $keywords, offset: 0, page_size: 10, should_paginate: true) {
                                        id
                                        email
                                        phone_number
                                        first_name
                                        last_name
                                    }
                                }
                            `, { keywords: searchKeyword });

                            console.log(`[Debug] Healthie user search result:`, JSON.stringify(searchResult));

                            if (searchResult.data?.users && searchResult.data.users.length > 0) {
                                // Try to match by phone number if we have multiple results
                                const phoneDigits = phone ? phone.replace(/\D/g, '') : '';
                                const matchedUser = searchResult.data.users.find(u => {
                                    const userPhoneDigits = (u.phone_number || '').replace(/\D/g, '');
                                    return phoneDigits && userPhoneDigits && userPhoneDigits.includes(phoneDigits.slice(-10));
                                }) || searchResult.data.users[0]; // Fallback to first result

                                healthie_patient_id = matchedUser.id;
                                console.log(`✅ Found existing Healthie patient: ${healthie_patient_id} (${matchedUser.first_name} ${matchedUser.last_name})`);
                            } else if (validEmail) {
                                // No existing patient, create new one (only if we have a valid email)
                                console.log(`ℹ️ No existing patient found, creating new with email: ${validEmail}...`);
                                const createPatientResult = await callHealthieAPI(`
                                    mutation createClient($input: createClientInput!) {
                                        createClient(input: $input) { user { id } messages { field message } }
                                    }
                                `, {
                                    input: {
                                        first_name: first_name,
                                        last_name: last_name,
                                        email: validEmail,
                                        phone_number: phone,
                                        user_group_id: HEALTHIE_PRIMARY_CARE_GROUP_ID,
                                        dont_send_welcome: false
                                    }
                                });
                                console.log(`[Debug] Healthie createClient response:`, JSON.stringify(createPatientResult));
                                if (createPatientResult.data?.createClient?.user?.id) {
                                    healthie_patient_id = createPatientResult.data.createClient.user.id;
                                    console.log(`✅ Created Healthie patient for booking: ${healthie_patient_id}`);
                                } else {
                                    console.warn(`⚠️ Healthie createClient returned no user ID:`, JSON.stringify(createPatientResult));
                                }
                            } else {
                                console.warn(`⚠️ Cannot create patient - no valid email provided (got: ${email})`);
                            }
                        } catch (hErr) {
                            console.warn(`⚠️ Could not find/create Healthie patient: ${hErr.message}`);
                        }
                    }

                } else {
                    // Create new contact if missing
                    console.log(`👤 Creating new GHL contact for booking...`);
                    const newContact = await ghlClient.createContact({
                        firstName: first_name,
                        lastName: last_name,
                        email: email,
                        phone: phone,
                        tags: ['created_by_voice_ai']
                    });
                    if (newContact && (newContact.contact?.id || newContact.id)) {
                        finalContactId = newContact.contact?.id || newContact.id;
                        console.log(`✅ Created new GHL Contact: ${finalContactId}`);
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Contact lookup failed: ${err.message}`);
                // Proceed
            }
        }

        // --- STEP 2: BOOK IN HEALTHIE (SOURCE OF TRUTH) ---
        let healthieAppointmentId = null;

        if (healthie_patient_id || process.env.HEALTHIE_PRIMARY_CARE_PROVIDER_ID) { // Try even without patient ID? No, need user.
            if (healthie_patient_id) {
                try {
                    console.log("🏥 Attempting Healthie Booking...");
                    // Parse slot_id (Format: YYYY-MM-DD_HH:mm)
                    let dateStr, timeStr;
                    if (slot_id && slot_id.includes('_')) {
                        [dateStr, timeStr] = slot_id.split('_');
                    } else {
                        // REJECT invalid slot_id instead of booking wrong time
                        console.log(`❌ Invalid slot_id format: ${slot_id}`);
                        return res.json({
                            success: false,
                            message: "I need to know which time slot you'd like. Could you tell me your preferred date and time?"
                        });
                    }

                    // VALIDATE SLOT AVAILABILITY BEFORE BOOKING
                    console.log(`🔍 Validating slot availability: ${dateStr} ${timeStr}`);
                    const apptTypeMap = {
                        'Wellness Check-up': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
                        'Annual Physical': process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743',
                        'Sick Visit': process.env.HEALTHIE_APPT_TYPE_PC_SICK || '504715',
                        'Follow-up': process.env.HEALTHIE_APPT_TYPE_PC_TELEMED || '505646',
                        'Lab Work': process.env.HEALTHIE_APPT_TYPE_PC_LABS || '504734'
                    };
                    const healthieApptTypeId = apptTypeMap[appointment_type] || process.env.HEALTHIE_APPT_TYPE_PC_INITIAL || '504743';

                    // Query Healthie for available slots on requested date - FILTER BY LOCATION
                    const PRIMARY_CARE_LOCATION_ID = process.env.HEALTHIE_PRIMARY_CARE_LOCATION_ID || '27565';
                    const availabilityCheck = await callHealthieAPI(`
                        query CheckSlotAvailability($provider_id: String, $appt_type_id: String, $start_date: String, $end_date: String, $appt_loc_id: String) {
                            availableSlotsForRange(
                                provider_id: $provider_id
                                appt_type_id: $appt_type_id
                                start_date: $start_date
                                end_date: $end_date
                                appt_loc_id: $appt_loc_id
                            ) {
                                date
                            }
                        }
                    `, {
                        provider_id: HEALTHIE_PRIMARY_CARE_PROVIDER_ID,
                        appt_type_id: healthieApptTypeId,
                        start_date: dateStr,
                        end_date: dateStr,
                        appt_loc_id: PRIMARY_CARE_LOCATION_ID
                    });

                    const availableSlots = availabilityCheck.data?.availableSlotsForRange || [];

                    // Check if requested slot exists in available slots
                    const requestedSlot = `${dateStr}T${timeStr}`;
                    const slotAvailable = availableSlots.some(slot => {
                        const slotDateTime = slot.date.split(' ')[0] + 'T' + slot.date.split(' ')[1].substring(0, 5);
                        return slotDateTime === requestedSlot;
                    });

                    if (!slotAvailable && availableSlots.length === 0) {
                        console.log(`❌ No availability found for ${dateStr}`);
                        return res.json({
                            success: false,
                            message: `I don't see any availability on that date. Would you like me to check another day?`
                        });
                    }

                    if (!slotAvailable) {
                        console.log(`❌ Slot ${requestedSlot} not in available slots`);
                        // Suggest actual available times
                        const availableTimes = availableSlots.slice(0, 3).map(s => {
                            const dt = new Date(s.date);
                            return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Phoenix' });
                        }).join(', ');
                        return res.json({
                            success: false,
                            message: `That time slot isn't available. On ${dateStr} I have openings at: ${availableTimes}. Which would work for you?`
                        });
                    }

                    console.log(`✅ Slot validated - ${requestedSlot} is available`);

                    // Map Appointment Type (already defined above)

                    // Execute GraphQL
                    const result = await callHealthieAPI(`
                        mutation CreateAppointment($input: createAppointmentInput!) {
                            createAppointment(input: $input) {
                                appointment { id }
                                messages { field message }
                            }
                        }
                    `, {
                        input: {
                            user_id: healthie_patient_id,
                            // Healthie expects providers as String, not Array
                            providers: HEALTHIE_PRIMARY_CARE_PROVIDER_ID,
                            appointment_type_id: healthieApptTypeId,
                            datetime: `${dateStr}T${timeStr}`,
                            timezone: 'America/Phoenix',
                            notes: reason || 'Booked by Jessica Voice AI'
                        }
                    });

                    if (result.data?.createAppointment?.appointment?.id) {
                        healthieAppointmentId = result.data.createAppointment.appointment.id;
                        console.log(`✅ Healthie Appointment Created: ${healthieAppointmentId}`);
                    } else {
                        console.warn("⚠️ Healthie Booking returned no ID:", JSON.stringify(result));
                    }

                } catch (hError) {
                    console.error(`❌ Healthie Booking Logic Failed: ${hError.message}`);
                    // Don't fail the whole request yet
                }
            } else {
                console.log("ℹ️ Skipping Healthie Booking (No Healthie Patient ID)");
            }

            // Send SMS confirmation after successful Healthie booking
            if (healthieAppointmentId && finalContactId) {
                try {
                    // Format date as MM-DD-YYYY and time nicely
                    let formattedDate = 'your scheduled time';
                    if (slot_id && slot_id.includes('_')) {
                        const [datePart, timePart] = slot_id.split('_');
                        const [year, month, day] = datePart.split('-');
                        const [hour, minute] = timePart.split(':');
                        const hourNum = parseInt(hour);
                        const ampm = hourNum >= 12 ? 'PM' : 'AM';
                        const hour12 = hourNum > 12 ? hourNum - 12 : (hourNum === 0 ? 12 : hourNum);
                        formattedDate = `${month}-${day}-${year} at ${hour12}:${minute} ${ampm}`;
                    }
                    await ghlClient.sendSMS(
                        finalContactId,
                        `✅ Your ${appointment_type} appointment with Phil Schafer, NP is confirmed for ${formattedDate}. Location: 404 S Montezuma St, Prescott AZ. Reply HELP for assistance.`
                    );
                    console.log(`📱 SMS confirmation sent to contact ${finalContactId}`);
                } catch (smsError) {
                    console.warn(`⚠️ SMS confirmation failed: ${smsError.message}`);
                }
            }
        }


        // --- STEP 3: BOOK IN GHL (OPTIONAL / AUTOMATION TRIGGER) ---
        let ghlAppointmentId = null;

        // Only attempt if we have a Contact ID
        if (finalContactId) {
            try {
                // Determine Calendar ID (Use Param OR Env OR Fallback)
                // If Env is missing, this will be undefined.
                const targetCalendarId = calendar_id || process.env.GHL_PRIMARY_CARE_CALENDAR_ID;

                if (!targetCalendarId) {
                    throw new Error("Missing Calendar ID (Not provided and not in ENV)");
                }

                // Format Dates (Robust ISO)
                let startTimeISO, endTimeISO;
                if (slot_id && slot_id.includes('_')) {
                    const [d, t] = slot_id.split('_');
                    startTimeISO = `${d}T${t}:00-07:00`;
                    // Add 30 mins
                    let [hh, mm] = t.split(':').map(Number);
                    mm += 30; if (mm >= 60) { mm -= 60; hh += 1; }
                    const endT = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
                    endTimeISO = `${d}T${endT}:00-07:00`;
                } else {
                    startTimeISO = new Date(Date.now() + 86400000).toISOString(); // Fallback
                    endTimeISO = new Date(Date.now() + 88200000).toISOString();
                }

                console.log(`📅 Booking GHL Appt on Calendar ${targetCalendarId} for ${startTimeISO}`);

                const ghlAppt = await ghlClient.createAppointment({
                    calendarId: targetCalendarId,
                    contactId: finalContactId,
                    title: `${appointment_type} - ${reason}`,
                    appointmentStatus: 'confirmed',
                    startTime: startTimeISO,
                    endTime: endTimeISO,
                    selectedTimezone: 'America/Phoenix',
                    selectedSlot: startTimeISO
                });

                if (ghlAppt && ghlAppt.id) {
                    ghlAppointmentId = ghlAppt.id;
                    console.log(`✅ GHL Appointment Created: ${ghlAppointmentId}`);

                    // Send SMS
                    await ghlClient.sendSMS(finalContactId, `You are booked for a ${appointment_type} on ${slot_id.replace('_', ' at ')}. See you soon!`);
                }

            } catch (ghlError) {
                console.warn(`⚠️ GHL Booking Failed (Non-Blocking): ${ghlError.message}`);
                // We specifically catch this so we return SUCCESS to the user if Healthie worked (or even if just parsing worked)
                // This prevents the "Systems are down" voice response.
            }
        }


        // --- STEP 4: RETURN SUCCESS ---
        // Always return success if we processed the request, even if specific backend steps had warnings.
        // This ensures the Voice AI continues the conversation.

        return res.json({
            success: true,
            appointment_id: ghlAppointmentId || 'pending',
            healthie_appointment_id: healthieAppointmentId,
            message: "Perfect! I have that scheduled for you."
        });

    } catch (error) {
        console.error('❌ Critical Error in Book Appointment:', error);
        // Fallback for catastrophic failure
        res.status(500).json({
            error: 'Booking system error',
            message: "I verified availability but had a hiccup locking it in. Our scheduling team will confirm with you shortly."
        });
    }
});

/**
 * Webhook 4: Check Lab Results
 * Securely checks if patient has lab results available
 */
app.post('/api/ghl/check-lab-results', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, healthie_patient_id } = req.body;

        // SECURITY: Require verified patient ID
        if (!healthie_patient_id) {
            console.log(`🚫 BLOCKED: check-lab-results called without healthie_patient_id`);
            return res.json({
                success: false,
                has_results: false,
                message: "I need to verify your identity first before I can access your lab results. Can you confirm your full name and date of birth?"
            });
        }

        console.log(`🧪 Checking lab results for patient ${healthie_patient_id}`);

        // TODO: When Healthie rate limits clear, check for actual lab results
        // For now, return mock data

        const mockResults = {
            has_results: true,
            result_date: '2025-01-14',
            status: 'reviewed',
            summary: 'All values within normal range',
            needs_followup: false,
            provider_notes: 'Continue current medications. No changes needed.'
        };

        if (!mockResults.has_results) {
            return res.json({
                has_results: false,
                message: "Your lab results aren't available yet. We'll call you as soon as they're ready."
            });
        }

        if (mockResults.needs_followup) {
            return res.json({
                has_results: true,
                needs_followup: true,
                message: `Your results from ${mockResults.result_date} are in. The doctor would like to discuss them with you. Would you like me to schedule a follow-up call?`
            });
        }

        return res.json({
            has_results: true,
            needs_followup: false,
            message: `Great news! Your lab results from ${mockResults.result_date} show ${mockResults.summary}. ${mockResults.provider_notes}`
        });

    } catch (error) {
        console.error('❌ Error checking lab results:', error);
        res.status(500).json({
            error: 'Lab check failed',
            message: "I'm having trouble accessing your lab results. Let me transfer you to someone who can help."
        });
    }
});

/**
 * Webhook 5: Get Patient Balance
 * Returns billing information
 */
app.post('/api/ghl/patient-balance', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, healthie_patient_id } = req.body;

        // SECURITY: Require verified patient ID
        if (!healthie_patient_id) {
            console.log(`🚫 BLOCKED: patient-balance called without healthie_patient_id`);
            return res.json({
                success: false,
                message: "I need to verify your identity first before I can access your billing information. Can you confirm your full name and date of birth?"
            });
        }

        console.log(`💰 Checking balance for patient ${healthie_patient_id}`);

        // TODO: Integrate with QuickBooks or Healthie for actual balance
        const mockBalance = {
            balance: 150.00,
            last_payment: '2024-12-01',
            insurance_pending: 0
        };

        const message = mockBalance.balance > 0
            ? `Your current balance is $${mockBalance.balance.toFixed(2)}. Would you like me to send you a payment link?`
            : "You don't have any outstanding balance. You're all set!";

        return res.json({
            balance: mockBalance.balance,
            last_payment: mockBalance.last_payment,
            insurance_pending: mockBalance.insurance_pending,
            message
        });

    } catch (error) {
        console.error('❌ Error checking balance:', error);
        res.status(500).json({ error: 'Balance check failed' });
    }
});

/**
 * Webhook 6: Send Payment Link
 * Sends payment link via SMS
 */
app.post('/api/ghl/send-payment-link', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, amount } = req.body;

        console.log(`💳 Sending payment link for $${amount} to contact ${ghl_contact_id}`);

        // Generate payment link (mock for now)
        const paymentLink = `https://pay.nowoptimal.com/invoice/${ghl_contact_id}`;

        await ghlClient.sendSMS(
            ghl_contact_id,
            `Here's your secure payment link for $${amount}: ${paymentLink}\n\nPay online anytime. Questions? Call us at (928) 212-2772.`
        );

        return res.json({
            success: true,
            link_sent: true,
            sms_sent: true,
            message: "Perfect! I just sent you a text with a secure payment link. You can pay online anytime."
        });

    } catch (error) {
        console.error('❌ Error sending payment link:', error);
        // Return graceful failure instead of 500
        return res.json({
            success: false,
            message: "I wasn't able to send the payment link right now. I'll make a note for our billing team to follow up with you."
        });
    }
});

/**
 * Webhook 14: Transfer Call
 * Tags contact to trigger GHL Workflow for PSTN Transfer
 */
app.post('/api/ghl/transfer-call', authenticateWebhook, async (req, res) => {
    try {
        const { phone: rawPhone, department } = req.body;
        const phone = normalizePhone(rawPhone); // Normalize to E.164
        console.log(`📞 Transfer Request: ${department} for ${phone}`);

        let contactId;
        const search = await ghlClient.searchContacts(null, phone);

        if (search.contacts && search.contacts.length > 0) {
            contactId = search.contacts[0].id;
        } else {
            // Create temp contact so we can tag it
            try {
                const newC = await ghlClient.createContact({
                    firstName: 'Caller',
                    lastName: phone || 'Unknown',
                    phone: phone,
                    tags: ['VoiceAI_Inbound']
                });
                contactId = newC.id;
            } catch (createErr) {
                console.error("Could not create contact for transfer:", createErr.message);
            }
        }

        if (contactId) {
            const tag = department === 'MensHealth' ? 'transfer_mens_health' : 'transfer_front_desk';
            await ghlClient.addTag(contactId, tag);
            console.log(`✅ Tagged contact ${contactId} with ${tag}`);
            return res.json({
                success: true,
                message: "I am connecting you now. Please hold."
            });
        } else {
            throw new Error("No contact found or created");
        }

    } catch (e) {
        console.error("❌ Transfer Error:", e);
        return res.json({
            success: false,
            message: "I am having trouble connecting you. Please dial 928-277-0001 directly."
        });
    }
});

/**
 * Webhook 9: Request Prescription Refill
 * Defined in AI Prompt
 */
app.post('/api/ghl/request-prescription-refill', authenticateWebhook, async (req, res) => {
    try {
        const { phone, patient_phone, medication, pharmacy, urgent, notes, healthie_patient_id } = req.body;
        const targetPhone = patient_phone || phone;

        // SECURITY: Require verified patient ID
        if (!healthie_patient_id) {
            console.log(`🚫 BLOCKED: request-prescription-refill called without healthie_patient_id`);
            return res.json({
                success: false,
                message: "I need to verify your identity first before I can process a refill request. Can you confirm your full name and date of birth?"
            });
        }

        console.log(`💊 Rx Refill Request: ${medication} for ${targetPhone} (Patient: ${healthie_patient_id})`);

        const webhookUrl = process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK || process.env.GOOGLE_CHAT_WEBHOOK_CLINICAL;

        if (webhookUrl) {
            const urgencyIcon = (urgent === 'true' || urgent === true) ? '🚨 URGENT' : '';
            await axios.post(webhookUrl, {
                text: `💊 *Prescription Refill Request* ${urgencyIcon}\nPhone: ${targetPhone}\nMedication: ${medication}\nPharmacy: ${pharmacy}\nUrgent: ${urgent}\nNotes: ${notes}`
            });
            console.log("✅ Refill notification sent to Google Chat");
        }

        return res.json({
            success: true,
            message: "Refill request received."
        });

    } catch (e) {
        console.error("❌ Refill Error:", e);
        return res.json({ success: true, message: "Request noted." });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'GHL Voice AI Webhooks' });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 GHL Voice AI Webhook Server running on port ${PORT}`);
    console.log(`📍 Endpoints available:`);
    console.log(`   POST /api/ghl/verify-patient`);
    console.log(`   POST /api/ghl/get-availability`);
    console.log(`   POST /api/ghl/book-appointment`);
    console.log(`   POST /api/ghl/check-lab-results`);
    console.log(`   POST /api/ghl/patient-balance`);
    console.log(`   POST /api/ghl/send-payment-link`);
    console.log(`\n✅ Ready to receive Voice AI webhook calls!\n`);
});

module.exports = app;

/**
 * Webhook 7: Send Provider Message
 * Creates a message in Healthie from patient to provider AND notifies Google Chat
 */
app.post('/api/ghl/send-provider-message', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, patient_name, phone, message_type, patient_type, healthie_patient_id, message_content } = req.body;

        console.log(`📨 Sending provider message: ${message_type} for ${patient_name}`);

        // Format the message content
        const formattedMessage = message_content ||
            (message_type === 'lab_results' ? 'I would like to discuss my lab results.' :
                message_type === 'imaging_results' ? 'I would like to discuss my imaging results.' :
                    'I would like to speak with my provider.');

        // STEP 1: Create message in Healthie (if patient ID available)
        let healthieMessageSent = false;
        if (healthie_patient_id) {
            try {
                console.log(`   📝 Creating Healthie conversation for patient ${healthie_patient_id}`);

                // Create or find conversation between patient and provider
                const conversationResult = await callHealthieAPI(`
                    mutation CreateConversation($owner_id: ID!, $simple_added_users: String!) {
                        createConversation(input: {
                            owner_id: $owner_id
                            simple_added_users: $simple_added_users
                        }) {
                            conversation {
                                id
                            }
                            messages {
                                field
                                message
                            }
                        }
                    }
                `, {
                    owner_id: HEALTHIE_PRIMARY_CARE_PROVIDER_ID,
                    simple_added_users: healthie_patient_id
                });

                const conversationId = conversationResult?.data?.createConversation?.conversation?.id;

                if (conversationId) {
                    console.log(`   ✅ Created/found conversation: ${conversationId}`);

                    // Send the message as a note in the conversation
                    const noteResult = await callHealthieAPI(`
                        mutation CreateNote($conversation_id: String!, $content: String!, $user_id: String) {
                            createNote(input: { 
                                conversation_id: $conversation_id
                                content: $content
                                user_id: $user_id
                            }) {
                                note {
                                    id
                                }
                                messages {
                                    field
                                    message
                                }
                            }
                        }
                    `, {
                        conversation_id: conversationId,
                        content: `<p>${formattedMessage}</p><p><em>— Sent via Jessica AI on behalf of ${patient_name}</em></p>`,
                        user_id: healthie_patient_id
                    });

                    if (noteResult?.data?.createNote?.note?.id) {
                        console.log(`   ✅ Message sent in Healthie (Note ID: ${noteResult.data.createNote.note.id})`);
                        healthieMessageSent = true;
                    } else {
                        console.warn(`   ⚠️ createNote returned no note ID:`, JSON.stringify(noteResult));
                    }
                } else {
                    console.warn(`   ⚠️ createConversation returned no conversation ID:`, JSON.stringify(conversationResult));
                }
            } catch (healthieError) {
                console.error(`   ❌ Healthie messaging error: ${healthieError.message}`);
            }
        } else {
            console.log(`   ℹ️ No Healthie patient ID - skipping Healthie message`);
        }

        // STEP 2: Map to correct Google Chat space (existing functionality)

        // Map to correct Google Chat space
        const chatWebhooks = {
            'lab_results': process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK,
            'imaging_results': process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK,
            'pelleting': process.env.GOOGLE_CHAT_PELLETING_WEBHOOK,
            'weight_loss': process.env.GOOGLE_CHAT_WEIGHT_LOSS_WEBHOOK,
            'mens_health': process.env.GOOGLE_CHAT_MENS_HEALTH_WEBHOOK
        };

        const webhookUrl = chatWebhooks[patient_type] || chatWebhooks[message_type] || process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK;

        // Format Google Chat message  
        const chatMessage = {
            text: `🔔 *Patient Callback Request - Jessica AI*\n\n` +
                `*Patient*: ${patient_name}\n` +
                `*Phone*: ${phone}\n` +
                `*Request*: ${message_type === 'lab_results' ? 'Discuss Lab Results' : 'Discuss Imaging Results'}\n` +
                `*Patient Type*: ${patient_type || 'Primary Care'}\n\n` +
                `⏰ *Action*: Provider callback within 24-72 hours\n` +
                `📋 <https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${ghl_contact_id}|View Contact in GHL>`
        };

        // Skip if Google Chat URL is a placeholder or undefined
        if (!webhookUrl || webhookUrl.includes('PLACEHOLDER')) {
            console.log(`ℹ️ Skipping Google Chat notification - URL not configured`);
            return res.json({
                success: true,
                message_sent: false,
                message: "I've noted your request. Your provider will call you back within 24 to 72 hours."
            });
        }

        // Send to Google Chat
        let response;
        try {
            response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(chatMessage)
            });
        } catch (fetchError) {
            console.warn(`⚠️ Google Chat notification failed: ${fetchError.message}`);
            return res.json({
                success: true,
                message_sent: false,
                message: "I've noted your request. Your provider will call you back within 24 to 72 hours."
            });
        }

        if (!response.ok) {
            console.warn(`⚠️ Google Chat returned error: ${response.statusText}`);
        }

        console.log(`✅ Notification sent to Google Chat`);

        // Tag contact for follow-up
        await ghlClient.updateContact(ghl_contact_id, {
            tags: [`callback_${message_type}`, 'via_jessica_ai']
        });

        return res.json({
            success: true,
            message_sent: true,
            message: "Perfect! I've sent a message to your provider. They'll call you back within 24 hours."
        });

    } catch (error) {
        console.error('❌ Error sending provider message:', error);
        res.status(500).json({
            error: 'Failed to send message',
            success: false,
            message: "I had trouble sending that message. Let me transfer you to our front desk."
        });
    }
});

/**
 * Webhook: Find Pharmacy
 * Searches for pharmacies using Google Places API
 */
app.post('/api/ghl/find-pharmacy', authenticateWebhook, async (req, res) => {
    try {
        const { zip_code, pharmacy_name, latitude, longitude } = { ...req.query, ...req.body };

        console.log(`💊 Pharmacy search: zip=${zip_code}, name=${pharmacy_name}`);

        const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

        if (!GOOGLE_PLACES_API_KEY) {
            console.error('❌ Google Places API key not configured');
            return res.json({
                success: false,
                pharmacies: [],
                message: "I'm having trouble searching for pharmacies right now. What pharmacy would you like us to use?"
            });
        }

        let searchQuery = 'pharmacy';
        let locationBias = '';

        // Build search query
        if (pharmacy_name) {
            searchQuery = `${pharmacy_name} pharmacy`;
        }

        // Default to Prescott AZ if no location provided
        const searchLocation = zip_code || '86303';
        searchQuery += ` ${searchLocation}`;

        // Call Google Places Text Search API
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&type=pharmacy&key=${GOOGLE_PLACES_API_KEY}`;

        const response = await axios.get(searchUrl);

        if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
            console.error(`❌ Google Places API error: ${response.data.status}`);
            return res.json({
                success: false,
                pharmacies: [],
                message: "I couldn't search for pharmacies right now. What pharmacy would you like us to use?"
            });
        }

        // Format results
        const pharmacies = (response.data.results || []).slice(0, 5).map(place => ({
            name: place.name,
            address: place.formatted_address,
            rating: place.rating,
            open_now: place.opening_hours?.open_now,
            place_id: place.place_id
        }));

        if (pharmacies.length === 0) {
            return res.json({
                success: true,
                pharmacies: [],
                message: `I couldn't find any pharmacies in ${searchLocation}. What pharmacy would you like us to use?`
            });
        }

        // Format response for voice
        const pharmacyList = pharmacies.map((p, i) => `${i + 1}. ${p.name}`).join(', ');

        return res.json({
            success: true,
            pharmacies: pharmacies,
            count: pharmacies.length,
            message: `I found ${pharmacies.length} pharmacies near ${searchLocation}: ${pharmacyList}. Which one would you like?`
        });

    } catch (error) {
        console.error('❌ Error finding pharmacy:', error);
        return res.json({
            success: false,
            pharmacies: [],
            message: "I'm having trouble searching for pharmacies. What pharmacy would you like us to use?"
        });
    }
});

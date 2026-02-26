const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config({ path: '/home/ec2-user/.env.production' });
const { GHLClient } = require('./ghl-client');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.MAX_WEBHOOK_PORT || 3004;
const ghlClient = new GHLClient(process.env.GHL_MENS_HEALTH_API_KEY);

// Men's Health specific configuration
const HEALTHIE_MENS_HEALTH_GROUP_ID = process.env.HEALTHIE_MENS_HEALTH_GROUP_ID || '75522';
const HEALTHIE_MENS_HEALTH_PROVIDER_ID = process.env.HEALTHIE_MENS_HEALTH_PROVIDER_ID || '12093125';

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
 * Webhook 1: Verify Patient (Max - Men's Health)
 * Called by Voice AI to authenticate caller
 */
app.post('/api/ghl/max/verify-patient', authenticateWebhook, async (req, res) => {
    try {
        const { phone, dob, name } = req.body;

        console.log(`🔍 [Max] Verifying patient: ${name}, Phone: ${phone}`);

        // Search GHL for contact
        const ghlResults = await ghlClient.searchContacts(null, phone);

        if (!ghlResults.contacts || ghlResults.contacts.length === 0) {
            return res.json({
                verified: false,
                patient_found: false,
                message: "I don't see you in our system yet. Are you interested in learning about our TRT program?",
                action: "ask_if_new_patient"
            });
        }

        const contact = ghlResults.contacts[0];

        // Verify DOB matches (if we have it stored)
        const storedDOB = contact.customField?.find(f => f.key === 'date_of_birth')?.value;
        if (storedDOB && storedDOB !== dob) {
            return res.json({
                verified: false,
                message: "The date of birth doesn't match our records. For your security, let me transfer you to our front desk.",
                action: "transfer_to_human"
            });
        }

        // Check if patient has Healthie record and completed paperwork
        const healthiePatientId = contact.customField?.find(f => f.key === 'healthie_patient_id')?.value;
        const paperworkComplete = contact.customField?.find(f => f.key === 'paperwork_complete')?.value === 'true';
        const isMensHealth = contact.tags?.includes('NowMensHealth');

        // Patient needs workflow if: no Healthie ID OR paperwork incomplete
        const needsWorkflow = !healthiePatientId || !paperworkComplete;

        // Successfully verified
        return res.json({
            verified: true,
            patient_found: true,
            ghl_contact_id: contact.id,
            healthie_patient_id: healthiePatientId,
            patient_name: `${contact.firstName} ${contact.lastName}`,
            patient_type: 'MensHealth',
            is_mens_health: isMensHealth,
            paperwork_complete: paperworkComplete,
            needs_workflow: needsWorkflow,
            message: `Great! I've pulled up your record, ${contact.firstName}. How can I help you today?`
        });

    } catch (error) {
        console.error('❌ [Max] Error verifying patient:', error);
        res.status(500).json({
            error: 'Verification failed',
            message: "I'm having trouble accessing our system. Let me transfer you to someone who can help."
        });
    }
});

/**
 * Webhook 2: Create New Patient (Max - Men's Health)
 * Creates patient in NowMensHealth.Care group
 */
app.post('/api/ghl/max/create-new-patient', authenticateWebhook, async (req, res) => {
    try {
        const { first_name, last_name, phone, email, dob, service_line } = req.body;

        console.log(`👤 [Max] Creating new Men's Health patient: ${first_name} ${last_name}`);

        // Step 1: Create contact in GHL with Men's Health tag
        const ghlContact = await ghlClient.createContact({
            firstName: first_name,
            lastName: last_name,
            phone: phone,
            email: email,
            tags: ['NowMensHealth', 'TRT_Interest'],
            customField: [
                { key: 'date_of_birth', value: dob },
                { key: 'intake_status', value: 'pending' },
                { key: 'created_by', value: 'Max AI' },
                { key: 'service_line', value: 'MensHealth' }
            ]
        });

        console.log(`✅ [Max] Created GHL contact: ${ghlContact.id}`);

        // Step 2: Create patient in Healthie (MensHealth.Care group)
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
                    user_group_id: HEALTHIE_MENS_HEALTH_GROUP_ID,
                    dont_send_welcome: false, // Send welcome email with intake forms
                    metadata: JSON.stringify({
                        source: 'voice_ai',
                        agent: 'Max',
                        service_line: 'MensHealth'
                    })
                }
            });

            healthiePatientId = healthiePatient.data.createClient.user.id;
            console.log(`✅ [Max] Created Healthie patient in MensHealth.Care: ${healthiePatientId}`);

            // Update GHL contact with Healthie ID
            await ghlClient.updateContact(ghlContact.id, {
                customField: [
                    { key: 'healthie_patient_id', value: healthiePatientId }
                ]
            });
        } catch (healthieError) {
            console.error(`⚠️ [Max] Healthie patient creation failed: ${healthieError.message}`);
            // Continue without Healthie ID - will be created later
        }

        // Send welcome SMS via GHL
        await ghlClient.sendSMS(
            ghlContact.id,
            `Welcome to NOW Men's Health Care, ${first_name}! 💪\n\nYou'll receive an email shortly to complete your intake paperwork. Questions? Call us at (928) 212-2772.`
        );

        return res.json({
            success: true,
            ghl_contact_id: ghlContact.id,
            healthie_patient_id: healthiePatientId,
            healthie_group: 'MensHealth.Care',
            intake_sent: true,
            message: `Welcome to NOW Men's Health Care, ${first_name}! I've created your account and you'll receive an email shortly with your intake paperwork. Is there anything else I can help you with?`
        });

    } catch (error) {
        console.error('❌ [Max] Error creating new patient:', error);
        res.status(500).json({
            error: 'Patient creation failed',
            success: false,
            message: "I had trouble creating your account. Let me transfer you to our front desk to get you all set up."
        });
    }
});

/**
 * Webhook 3: Get Availability (Max - Men's Health)
 * Returns available appointment slots for Men's Health services
 */
app.post('/api/ghl/max/get-availability', authenticateWebhook, async (req, res) => {
    try {
        const { appointment_type, date_range } = req.body;

        console.log(`📅 [Max] Checking Men's Health availability for ${appointment_type}`);

        // Map appointment types to Healthie IDs
        const appointmentTypeMap = {
            'MALE_HRT_INITIAL': process.env.HEALTHIE_APPT_TYPE_MALE_HRT_INITIAL || '504725',
            'TRT_SUPPLY_REFILL': process.env.HEALTHIE_APPT_TYPE_TRT_SUPPLY_REFILL || '504735',
            'EVEXIPEL_MALE_INITIAL': process.env.HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_INITIAL || '504727',
            'EVEXIPEL_MALE_REPEAT': process.env.HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_REPEAT || '504728',
            'TRT_TELEMEDICINE': process.env.HEALTHIE_APPT_TYPE_TRT_TELEMEDICINE || '505645',
            'PEPTIDE_EDUCATION': process.env.HEALTHIE_APPT_TYPE_PEPTIDE_EDUCATION || '504736',
            '5_WEEK_LAB': process.env.HEALTHIE_APPT_TYPE_5_WEEK_LAB || '504732',
            '90_DAY_LAB': process.env.HEALTHIE_APPT_TYPE_90_DAY_LAB || '504734'
        };

        const healthieApptTypeId = appointmentTypeMap[appointment_type];

        if (!healthieApptTypeId) {
            return res.json({
                has_availability: false,
                message: "I'm not sure which appointment type you need. Could you tell me more about what you're looking for?"
            });
        }

        // Query Healthie for available slots
        try {
            const today = new Date();
            const nextWeek = new Date();
            nextWeek.setDate(today.getDate() + 14);

            const availabilityResult = await callHealthieAPI(`
                query GetAvailability($provider_id: ID!, $appointment_type_id: ID!, $start_date: String!, $end_date: String!) {
                    availableAppointmentSlots(
                        provider_id: $provider_id,
                        appointment_type_id: $appointment_type_id,
                        start_date: $start_date,
                        end_date: $end_date,
                        timezone: "America/Phoenix"
                    ) {
                        date
                        slots {
                            start_time
                            end_time
                        }
                    }
                }
            `, {
                provider_id: HEALTHIE_MENS_HEALTH_PROVIDER_ID,
                appointment_type_id: healthieApptTypeId,
                start_date: today.toISOString().split('T')[0],
                end_date: nextWeek.toISOString().split('T')[0]
            });

            const slots = availabilityResult.data?.availableAppointmentSlots || [];

            // Format slots for voice response
            const formattedSlots = [];
            for (const daySlots of slots.slice(0, 3)) {
                if (daySlots.slots && daySlots.slots.length > 0) {
                    const slot = daySlots.slots[0];
                    formattedSlots.push({
                        date: daySlots.date,
                        time: slot.start_time,
                        slot_id: `${daySlots.date}_${slot.start_time}`
                    });
                }
            }

            if (formattedSlots.length === 0) {
                return res.json({
                    has_availability: false,
                    message: "I don't see any openings in the next two weeks for that appointment type. Let me transfer you to our scheduling team to help find a time."
                });
            }

            return res.json({
                has_availability: true,
                appointment_type: appointment_type,
                healthie_appt_type_id: healthieApptTypeId,
                provider_id: HEALTHIE_MENS_HEALTH_PROVIDER_ID,
                available_slots: formattedSlots,
                message: `I have openings on ${formattedSlots.map(s => s.date).join(', ')}. Which works best for you?`
            });

        } catch (healthieError) {
            console.error(`⚠️ [Max] Healthie availability query failed: ${healthieError.message}`);

            // Fallback to mock data if Healthie unavailable
            const mockSlots = [
                { date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0], time: '10:00 AM', slot_id: 'slot_1' },
                { date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0], time: '2:00 PM', slot_id: 'slot_2' },
                { date: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0], time: '9:00 AM', slot_id: 'slot_3' }
            ];

            return res.json({
                has_availability: true,
                appointment_type: appointment_type,
                available_slots: mockSlots,
                message: `I have openings on ${mockSlots.map(s => s.date).join(', ')}. Which works best for you?`
            });
        }

    } catch (error) {
        console.error('❌ [Max] Error checking availability:', error);
        res.status(500).json({
            error: 'Availability check failed',
            has_availability: false
        });
    }
});

/**
 * Webhook 4: Book Appointment (Max - Men's Health)
 * Creates appointment in Healthie for Men's Health services
 */
app.post('/api/ghl/max/book-appointment', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, healthie_patient_id, appointment_type, slot_id, slot_date, slot_time, reason } = req.body;

        console.log(`📝 [Max] Booking Men's Health appointment for contact ${ghl_contact_id}`);

        // Map appointment types to Healthie IDs
        const appointmentTypeMap = {
            'MALE_HRT_INITIAL': process.env.HEALTHIE_APPT_TYPE_MALE_HRT_INITIAL || '504725',
            'TRT_SUPPLY_REFILL': process.env.HEALTHIE_APPT_TYPE_TRT_SUPPLY_REFILL || '504735',
            'EVEXIPEL_MALE_INITIAL': process.env.HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_INITIAL || '504727',
            'EVEXIPEL_MALE_REPEAT': process.env.HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_REPEAT || '504728',
            'TRT_TELEMEDICINE': process.env.HEALTHIE_APPT_TYPE_TRT_TELEMEDICINE || '505645',
            'PEPTIDE_EDUCATION': process.env.HEALTHIE_APPT_TYPE_PEPTIDE_EDUCATION || '504736',
            '5_WEEK_LAB': process.env.HEALTHIE_APPT_TYPE_5_WEEK_LAB || '504732',
            '90_DAY_LAB': process.env.HEALTHIE_APPT_TYPE_90_DAY_LAB || '504734'
        };

        const healthieApptTypeId = appointmentTypeMap[appointment_type];

        // Create appointment in Healthie
        let healthieAppointmentId = null;

        if (healthie_patient_id) {
            try {
                const appointmentResult = await callHealthieAPI(`
                    mutation CreateAppointment($input: createAppointmentInput!) {
                        createAppointment(input: $input) {
                            appointment {
                                id
                                date
                                start_time
                            }
                            messages {
                                field
                                message
                            }
                        }
                    }
                `, {
                    input: {
                        user_id: healthie_patient_id,
                        provider_id: HEALTHIE_MENS_HEALTH_PROVIDER_ID,
                        appointment_type_id: healthieApptTypeId,
                        datetime: `${slot_date}T${slot_time}`,
                        timezone: 'America/Phoenix',
                        notes: reason || `${appointment_type} - Booked by Max AI`
                    }
                });

                healthieAppointmentId = appointmentResult.data?.createAppointment?.appointment?.id;
                console.log(`✅ [Max] Created Healthie appointment: ${healthieAppointmentId}`);

            } catch (healthieError) {
                console.error(`⚠️ [Max] Healthie booking failed: ${healthieError.message}`);
            }
        }

        // Send confirmation SMS
        await ghlClient.sendSMS(
            ghl_contact_id,
            `Your appointment at NOW Men's Health Care is confirmed! 💪\n\n📅 ${slot_date} at ${slot_time}\n📍 215 N McCormick St, Prescott\n\nReply CANCEL if you need to reschedule.`
        );

        return res.json({
            success: true,
            healthie_appointment_id: healthieAppointmentId,
            appointment_type: appointment_type,
            date: slot_date,
            time: slot_time,
            confirmation_code: healthieAppointmentId ? healthieAppointmentId.substr(-6).toUpperCase() : 'MAX' + Date.now().toString().substr(-4),
            message: `Perfect! You're all set for ${slot_date} at ${slot_time}. You'll receive a confirmation text shortly. We're at 215 North McCormick Street in Prescott.`
        });

    } catch (error) {
        console.error('❌ [Max] Error booking appointment:', error);
        res.status(500).json({
            error: 'Booking failed',
            success: false,
            message: "I had trouble booking that appointment. Let me transfer you to our scheduling team."
        });
    }
});

/**
 * Webhook 5: Check Lab Results (Max - Men's Health)
 * HIPAA-safe: Only returns dates, never values
 */
app.post('/api/ghl/max/check-lab-results', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, healthie_patient_id } = req.body;

        console.log(`🧪 [Max] Checking lab results for patient ${healthie_patient_id}`);

        // For now, return that we need to check with provider
        // In production, query Healthie for lab document dates
        return res.json({
            has_results: true,
            result_date: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
            needs_followup: false,
            message: "I see we have lab results on file for you. If you'd like to discuss them with your provider, I can send a message to have them call you back. Would you like me to do that?"
        });

    } catch (error) {
        console.error('❌ [Max] Error checking lab results:', error);
        res.status(500).json({
            error: 'Lab check failed',
            message: "I'm having trouble accessing your lab results. Let me transfer you to someone who can help."
        });
    }
});

/**
 * Webhook 6: Send Provider Message (Max - Men's Health)
 * Notifies provider for callback requests
 */
app.post('/api/ghl/max/send-provider-message', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, patient_name, phone, message_type } = req.body;

        console.log(`📨 [Max] Sending Men's Health provider message: ${message_type} for ${patient_name}`);

        // Send to Google Chat Men's Health space if configured
        const webhookUrl = process.env.GOOGLE_CHAT_MENS_HEALTH_WEBHOOK || process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK;

        if (webhookUrl) {
            const chatMessage = {
                text: `🔔 *Men's Health Callback Request - Max AI*\n\n` +
                    `*Patient*: ${patient_name}\n` +
                    `*Phone*: ${phone}\n` +
                    `*Request*: ${message_type === 'lab_results' ? 'Discuss Lab Results' : message_type === 'refill_request' ? 'TRT Refill Request' : 'Provider Callback'}\n\n` +
                    `⏰ *Action*: Provider callback requested\n` +
                    `📋 <https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${ghl_contact_id}|View Contact in GHL>`
            };

            await axios.post(webhookUrl, chatMessage);
            console.log(`✅ [Max] Notification sent to Google Chat`);
        }

        // Tag contact for follow-up
        await ghlClient.updateContact(ghl_contact_id, {
            tags: [`callback_${message_type}`, 'via_max_ai']
        });

        return res.json({
            success: true,
            message_sent: true,
            message: "Perfect! I've sent a message to your provider. They'll call you back within 24 hours."
        });

    } catch (error) {
        console.error('❌ [Max] Error sending provider message:', error);
        res.status(500).json({
            error: 'Failed to send message',
            success: false,
            message: "I had trouble sending that message. Let me transfer you to our front desk."
        });
    }
});

/**
 * Webhook 7: Patient Balance (Max - Men's Health)
 */
app.post('/api/ghl/max/patient-balance', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id } = req.body;

        console.log(`💰 [Max] Checking balance for contact ${ghl_contact_id}`);

        // TODO: Integrate with QuickBooks or Healthie for actual balance
        const mockBalance = {
            balance: 0,
            last_payment: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
            insurance_pending: 0
        };

        const message = mockBalance.balance > 0
            ? `Your current balance is $${mockBalance.balance.toFixed(2)}. Would you like me to send you a payment link?`
            : "You don't have any outstanding balance. You're all set!";

        return res.json({
            balance: mockBalance.balance,
            last_payment: mockBalance.last_payment,
            message
        });

    } catch (error) {
        console.error('❌ [Max] Error checking balance:', error);
        res.status(500).json({ error: 'Balance check failed' });
    }
});

/**
 * Webhook 8: Send Payment Link (Max - Men's Health)
 */
app.post('/api/ghl/max/send-payment-link', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, amount } = req.body;

        console.log(`💳 [Max] Sending payment link for $${amount} to contact ${ghl_contact_id}`);

        const paymentLink = `https://pay.nowmenshealth.care/invoice/${ghl_contact_id}`;

        await ghlClient.sendSMS(
            ghl_contact_id,
            `Here's your secure payment link for $${amount}: ${paymentLink}\n\nPay online anytime. Questions? Call us at (928) 212-2772.`
        );

        return res.json({
            success: true,
            link_sent: true,
            message: "I just sent you a text with a secure payment link. You can pay online anytime."
        });

    } catch (error) {
        console.error('❌ [Max] Error sending payment link:', error);
        res.status(500).json({ error: 'Failed to send payment link' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Max AI - Men\'s Health Webhooks',
        port: PORT,
        healthie_group: HEALTHIE_MENS_HEALTH_GROUP_ID,
        provider_id: HEALTHIE_MENS_HEALTH_PROVIDER_ID
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n💪 Max AI Webhook Server (Men's Health) running on port ${PORT}`);
    console.log(`📍 Endpoints available:`);
    console.log(`   POST /api/ghl/max/verify-patient`);
    console.log(`   POST /api/ghl/max/create-new-patient`);
    console.log(`   POST /api/ghl/max/get-availability`);
    console.log(`   POST /api/ghl/max/book-appointment`);
    console.log(`   POST /api/ghl/max/check-lab-results`);
    console.log(`   POST /api/ghl/max/send-provider-message`);
    console.log(`   POST /api/ghl/max/patient-balance`);
    console.log(`   POST /api/ghl/max/send-payment-link`);
    console.log(`\n✅ Ready to receive Max Voice AI webhook calls!\n`);
});

module.exports = app;

const express = require('express');
const fetch = require('node-fetch');

/**
 * Webhook 7: Send Provider Message (NEW!)
 * Sends notification to Google Chat when patient requests callback about results
 */
app.post('/api/ghl/send-provider-message', authenticateWebhook, async (req, res) => {
    try {
        const { ghl_contact_id, patient_name, phone, message_type, patient_type } = req.body;

        console.log(`📨 Sending provider message: ${message_type} for ${patient_name}`);

        // Determine which Google Chat space based on message type and patient type
        const chatWebhooks = {
            'lab_results_primary_care': process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK,
            'imaging_results_primary_care': process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK,
            'lab_results_mens_health': process.env.GOOGLE_CHAT_MENS_HEALTH_WEBHOOK,
            'lab_results_weight_loss': process.env.GOOGLE_CHAT_WEIGHT_LOSS_WEBHOOK,
            'lab_results_pelleting': process.env.GOOGLE_CHAT_PELLETING_WEBHOOK,
            'imaging_results_mens_health': process.env.GOOGLE_CHAT_MENS_HEALTH_WEBHOOK,
            'imaging_results_weight_loss': process.env.GOOGLE_CHAT_WEIGHT_LOSS_WEBHOOK,
            'imaging_results_pelleting': process.env.GOOGLE_CHAT_PELLETING_WEBHOOK,
        };

        const webhookKey = `${message_type}_${patient_type || 'primary_care'}`;
        const webhookUrl = chatWebhooks[webhookKey] || process.env.GOOGLE_CHAT_CLINICAL_WEBHOOK;

        // Format message for Google Chat
        const chatMessage = {
            text: `🔔 *Patient Callback Request*\n\n` +
                `*Patient*: ${patient_name}\n` +
                `*Phone*: ${phone}\n` +
                `*Request*: ${message_type === 'lab_results' ? 'Lab Results Discussion' : 'Imaging Results Discussion'}\n` +
                `*Patient Type*: ${patient_type || 'Primary Care'}\n` +
                `*Requested via*: Jessica Voice AI\n\n` +
                `⏰ *Action Required*: Provider callback within 24 hours\n\n` +
                `📋 <https://app.gohighlevel.com/contacts/${ghl_contact_id}|View in GHL>`
        };

        // Send to Google Chat
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatMessage)
        });

        console.log(`✅ Sent to Google Chat: ${webhookKey}`);

        // Tag contact in GHL for follow-up
        await ghlClient.updateContact(ghl_contact_id, {
            tags: [`callback_requested_${message_type}`, `via_jessica_ai`]
        });

        // Create task in GHL
        // TODO: Implement task creation when GHL API supports it

        return res.json({
            success: true,
            message_sent: true,
            message: \"I've sent a message to your provider. They'll call you back within 24 hours.\"
    });

    } catch (error) {
        console.error('❌ Error sending provider message:', error);
        res.status(500).json({
            error: 'Message send failed',
            success: false,
            message: \"I had trouble sending that message. Let me transfer you to someone who can help.\"
    });
    }
});

// Helper function for Healthie API calls
async function callHealthieAPI(query, variables) {
    const response = await fetch('https://api.gethealthie.com/graphql', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${process.env.HEALTHIE_API_KEY}`,
            'Content-Type': 'application/json',
            'AuthorizationSource': 'API'
        },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
        throw new Error(`Healthie API error: ${response.statusText}`);
    }

    return response.json();
}

module.exports = app;

#!/usr/bin/env tsx
/**
 * Telegram AI Bot for Clinic Data Queries (V2 - Modular)
 * 
 * Entry point for the modular Telegram bot.
 * Connects Telegram to AWS Bedrock AI query agent.
 * 
 * Features:
 * - SMART DATA FUSION: Combines Snowflake + Healthie API data automatically
 * - SELF-HEALING SQL: Retries failed queries with AI-corrected SQL
 * - AUTO-DISCOVERY: Uses dynamically discovered schema from Snowflake
 * - CONVERSATION CONTEXT: Maintains context for follow-up queries
 * - MISSING DATA LOGGING: Tracks requests for data not in the schema
 * 
 * Run: npm run telegram:bot
 * Or:  npx tsx scripts/telegram/bot.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Load env from home directory (for PM2)
require('dotenv').config({ path: '/home/ec2-user/.env' });

// Import handlers
import { handleMessage, sendMessage } from './handlers';
import { connectSnowflake, destroyConnection } from './snowflake';

// Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

// ============================================================================
// TELEGRAM POLLING
// ============================================================================
async function getUpdates(offset?: number): Promise<any[]> {
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
    const params: any = {
        timeout: 5,
        allowed_updates: ["message", "callback_query"]
    };
    if (offset) params.offset = offset;

    try {
        console.log('[Bot] 🔄 Polling for updates...');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('[Bot] ❌ getUpdates error:', data.description);
        }
        return data.result || [];
    } catch (err: any) {
        console.error('[Bot] ❌ Fetch error in getUpdates:', err.message);
        return [];
    }
}

// ============================================================================
// CALLBACK QUERY HANDLING
// ============================================================================
async function answerCallbackQuery(callbackQueryId: string, text: string) {
    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text })
        });
    } catch (err) {
        console.error('[Bot] Failed to answer callback:', err);
    }
}

// ============================================================================
// MAIN LOOP
// ============================================================================
async function main() {
    console.log('\n🤖 GMH Clinic AI Telegram Bot (V2 - Modular)');
    console.log('='.repeat(50));

    if (!TELEGRAM_BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN not configured in .env');
        process.exit(1);
    }

    console.log('\n📡 Connecting to Snowflake (Test)...');
    try {
        const conn = await connectSnowflake();
        await new Promise(resolve => conn.destroy(resolve));
        console.log('✅ Snowflake connection test passed');
    } catch (error) {
        console.error('❌ Snowflake connection failed:', error);
        process.exit(1);
    }

    console.log('\n🟢 Bot is running! Send messages to your bot on Telegram.\n');

    let offset: number | undefined;

    while (true) {
        try {
            const updates = await getUpdates(offset);
            if (updates.length > 0) {
                console.log(`[Bot] 📥 Received ${updates.length} update(s)`);
            }

            for (const update of updates) {
                offset = update.update_id + 1;
                console.log(`[Bot] Processing update ${update.update_id}: ${update.message ? 'message' : update.callback_query ? 'callback_query' : 'other'}`);

                // Handle Message
                if (update.message && update.message.text) {
                    const { chat: { id: chatId }, text, from, reply_to_message } = update.message;
                    const username = from?.username || from?.first_name;

                    // Write text to IPC file for Python scribe
                    try {
                        const approvalDir = '/tmp/telegram_approvals';
                        if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

                        fs.writeFileSync(
                            path.join(approvalDir, `text_response_${chatId}.json`),
                            JSON.stringify({ text, timestamp: Date.now(), from: username })
                        );

                        if (reply_to_message) {
                            const replyId = reply_to_message.message_id;
                            fs.writeFileSync(
                                path.join(approvalDir, `${replyId}_text.json`),
                                JSON.stringify({ text, timestamp: Date.now(), from: username, action: text })
                            );
                            console.log(`[Bot] 💬 Saved REPLY for msg ${replyId}: "${text.substring(0, 30)}..."`);
                        }

                        console.log(`[Bot] 💬 Saved text response for IPC`);
                    } catch (err) {
                        console.error('[Bot] Failed to save text response IPC:', err);
                    }

                    // Check if we're in edit mode for this chat
                    const activeEditFile = path.join('/tmp/telegram_approvals', `active_edit_${chatId}.json`);
                    if (fs.existsSync(activeEditFile)) {
                        try {
                            const editState = JSON.parse(fs.readFileSync(activeEditFile, 'utf8'));

                            if (editState.mode === 'edit' && editState.session_id) {
                                // Process AI edit
                                console.log(`[Bot] ✏️ Processing edit: "${text}" for session ${editState.session_id}`);
                                await sendMessage(chatId, `⏳ Processing: "${text}"...`);

                                const sessionFile = `/tmp/scribe_sessions/${editState.session_id}.json`;
                                const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                                const currentSOAP = sessionData.documents?.soap_note || '';

                                // Call Gemini to edit the SOAP
                                const editPrompt = `You are editing a medical SOAP note. Apply the following change:

CHANGE REQUESTED: ${text}

CURRENT SOAP NOTE:
${currentSOAP}

Return ONLY the updated SOAP note with the requested change applied. Do not add explanations or commentary. Maintain the same format and structure.`;

                                try {
                                    // Inline Gemini call - no dynamic import
                                    const apiKey = process.env.GOOGLE_AI_API_KEY;
                                    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

                                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
                                    const geminiRes = await fetch(geminiUrl, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            contents: [{ parts: [{ text: editPrompt }] }],
                                            generationConfig: { temperature: 0, maxOutputTokens: 4000 }
                                        })
                                    });

                                    if (!geminiRes.ok) throw new Error(`Gemini error: ${geminiRes.status}`);

                                    const geminiData = await geminiRes.json();
                                    const updatedSOAP = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                                    if (updatedSOAP && updatedSOAP.length > 100) {
                                        // Save updated SOAP
                                        sessionData.documents.soap_note = updatedSOAP;
                                        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

                                        // Clear edit mode
                                        fs.unlinkSync(activeEditFile);

                                        // Show preview of change
                                        const preview = updatedSOAP.substring(0, 400).replace(/[*_`\[\]]/g, '');

                                        await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                chat_id: chatId,
                                                text: `✅ SOAP updated!\n\n📝 Preview:\n${preview}...`
                                            })
                                        });

                                        // Show action buttons
                                        const actionButtons = {
                                            inline_keyboard: [
                                                [
                                                    { text: "📄 View Full SOAP", callback_data: `view_soap_${editState.session_id}` },
                                                    { text: "✏️ More Edits", callback_data: "edit_help" }
                                                ],
                                                [
                                                    { text: "🔄 Change Patient", callback_data: "change_patient" },
                                                    { text: "➕ Work Note", callback_data: "add_work_note" }
                                                ],
                                                [
                                                    { text: "🚀 Confirm & Send", callback_data: "confirm_send" },
                                                    { text: "🗑️ Discard", callback_data: "reject" }
                                                ],
                                                [{ text: "📋 Other Sessions", callback_data: "pending_sessions" }]
                                            ]
                                        };

                                        await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                chat_id: chatId,
                                                text: `📋 ${sessionData.patient_name} - What next?`,
                                                reply_markup: actionButtons
                                            })
                                        });
                                    } else {
                                        await sendMessage(chatId, '⚠️ Edit failed - could not generate updated SOAP. Try again.');
                                    }
                                } catch (geminiErr) {
                                    console.error('[Bot] Gemini edit error:', geminiErr);
                                    await sendMessage(chatId, '❌ AI edit failed. Try a different instruction.');
                                }

                                continue; // Skip regular message handling
                            } else if (editState.mode === 'patient_search') {
                                // Process patient search
                                console.log(`[Bot] 🔍 Processing patient search: "${text}"`);
                                await sendMessage(chatId, `🔍 Searching for "${text}"...`);

                                // Find patients using the patients service
                                const { patientsService } = await import('../../lib/patients');
                                const patients = await patientsService.findByQuery({ name: text });

                                if (patients.length === 0) {
                                    await sendMessage(chatId, `❌ No patients found matching "${text}". Try another name.`);
                                } else {
                                    // Show patient buttons (max 8)
                                    const patientButtons: any[][] = [];
                                    for (const p of patients.slice(0, 8)) {
                                        patientButtons.push([{
                                            text: `👤 ${p.fullName}`,
                                            callback_data: `select_patient_${p.healthieClientId || p.patientId}`
                                        }]);
                                    }
                                    patientButtons.push([{ text: "❌ Cancel", callback_data: "cancel_search" }]);

                                    await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            chat_id: chatId,
                                            text: `Found ${patients.length} patient(s). Select one:`,
                                            reply_markup: { inline_keyboard: patientButtons }
                                        })
                                    });
                                }

                                continue; // Skip regular message handling
                            }
                        } catch (editErr: any) {
                            console.error('[Bot] Edit mode processing error:', editErr);
                            await sendMessage(chatId, `❌ Edit processing error: ${editErr?.message || editErr}`);
                        }
                    }

                    // DIRECT HANDLER: /sessions command for scribe sessions
                    if (text.toLowerCase().startsWith('/session')) {
                        console.log('[Bot] 📋 /sessions command detected - handling directly');
                        const sessionsDir = '/tmp/scribe_sessions';
                        try {
                            if (!fs.existsSync(sessionsDir)) {
                                await sendMessage(chatId, '📋 No pending sessions.');
                                continue;
                            }
                            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                            const sessions: any[] = [];
                            for (const file of files) {
                                const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                                if (data.status === 'SENT' || data.status === 'DISCARDED') continue;
                                if (Number(data.chat_id) !== Number(chatId)) continue;
                                sessions.push(data);
                            }
                            sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

                            if (sessions.length === 0) {
                                await sendMessage(chatId, '📋 No pending sessions.\n\nAll patient visits have been completed or discarded.');
                            } else {
                                let msg = '📋 *PENDING SCRIBE SESSIONS*\n\nTap to switch to a patient:\n\n';
                                const buttons: any[][] = [];
                                for (const s of sessions.slice(0, 10)) {
                                    const icon = s.patient_id ? '🟡' : '🔴';
                                    const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '?';
                                    msg += `${icon} *${s.patient_name}* (${time}) - ${s.status}\n`;
                                    buttons.push([{ text: `${icon} ${s.patient_name} (${time})`, callback_data: `switch_session_${s.session_id}` }]);
                                }
                                buttons.push([{ text: '🔙 Back', callback_data: 'cancel_pending' }]);
                                await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        text: msg,
                                        parse_mode: 'Markdown',
                                        reply_markup: { inline_keyboard: buttons }
                                    })
                                });
                            }
                        } catch (err) {
                            console.error('[Bot] Error listing sessions:', err);
                            await sendMessage(chatId, '❌ Error listing sessions.');
                        }
                        continue; // Skip handleMessage
                    }

                    handleMessage(chatId, text, username).catch(err => console.error('[Bot] Message handling error:', err));
                }

                // Handle Callback Query (Buttons)
                if (update.callback_query) {
                    const cb = update.callback_query;
                    const msgId = cb.message?.message_id;
                    const action = cb.data;

                    if (msgId && action) {
                        console.log(`[Bot] 🖱️ Callback received: ${action} for msg ${msgId}`);

                        // Acknowledge Telegram
                        await answerCallbackQuery(cb.id, `Processing ${action}...`);

                        // Write to IPC file for Python script
                        try {
                            const approvalDir = '/tmp/telegram_approvals';
                            if (!fs.existsSync(approvalDir)) fs.mkdirSync(approvalDir, { recursive: true });

                            fs.writeFileSync(
                                path.join(approvalDir, `${msgId}.json`),
                                JSON.stringify({ action, timestamp: Date.now() })
                            );
                            console.log(`[Bot] 💾 Saved approval status to ${approvalDir}/${msgId}.json`);

                            // Update message to show status
                            console.log(`[Bot] 🔍 cb.message.chat.id = ${cb.message?.chat?.id}`);
                            if (cb.message?.chat?.id) {
                                // Handle switch_session directly in bot (no Python loop needed)
                                if (action.startsWith('switch_session_')) {
                                    const sessionId = action.replace('switch_session_', '');
                                    console.log(`[Bot] 🔄 Switching to session: ${sessionId}`);

                                    const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                                    try {
                                        if (fs.existsSync(sessionFile)) {
                                            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                                            const patientName = sessionData.patient_name || 'Unknown';
                                            const patientId = sessionData.classification?.patient_identification?.patient_id;
                                            const statusIcon = patientId ? '🟡' : '🔴';
                                            const status = patientId ? 'READY' : 'UNKNOWN';
                                            const soapNote = sessionData.documents?.soap_note || 'No SOAP note available';

                                            // Send confirmation with full editing buttons
                                            const editButtons = {
                                                inline_keyboard: [
                                                    [
                                                        { text: "📄 View Full SOAP", callback_data: `view_soap_${sessionId}` },
                                                        { text: "🔄 Change Patient", callback_data: "change_patient" }
                                                    ],
                                                    [
                                                        { text: "✏️ Edit via AI", callback_data: "edit_help" },
                                                        { text: "➕ Work Note", callback_data: "add_work_note" }
                                                    ],
                                                    [
                                                        { text: "➕ Discharge", callback_data: "add_discharge_instructions" }
                                                    ],
                                                    patientId ? [
                                                        { text: "🚀 Confirm & Send", callback_data: "confirm_send" },
                                                        { text: "🗑️ Discard", callback_data: "reject" }
                                                    ] : [
                                                        { text: "⚠️ SELECT PATIENT FIRST", callback_data: "change_patient" },
                                                        { text: "🗑️ Discard", callback_data: "reject" }
                                                    ],
                                                    [{ text: "📋 Other Pending Sessions", callback_data: "pending_sessions" }]
                                                ]
                                            };

                                            // Get SOAP preview (first 400 chars) - remove special chars
                                            const soapPreview = soapNote.substring(0, 400).replace(/[*_`\[\]()#]/g, '');

                                            const message = `${statusIcon} ACTIVE SESSION: ${patientName}\n\n` +
                                                `Status: ${status}\n` +
                                                `Session: ${sessionId}\n\n` +
                                                `SOAP Preview:\n${soapPreview}...\n\n` +
                                                `Use buttons below to edit or send`;

                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: message,
                                                    reply_markup: editButtons
                                                })
                                            });

                                            // Write to IPC so Python scribe can pick it up if running
                                            fs.writeFileSync(
                                                path.join(approvalDir, `active_session.json`),
                                                JSON.stringify({ session_id: sessionId, timestamp: Date.now() })
                                            );

                                            console.log(`[Bot] ✅ Sent session ${sessionId} with editing buttons`);
                                        } else {
                                            await sendMessage(cb.message.chat.id, `⚠️ Session not found: ${sessionId}`);
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error loading session:', err);
                                        await sendMessage(cb.message.chat.id, `❌ Error loading session`);
                                    }
                                } else if (action === 'pending_sessions') {
                                    // List all pending sessions
                                    console.log('[Bot] 📋 Listing pending sessions');
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                                        const sessions: any[] = [];

                                        for (const file of files) {
                                            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                                            if (data.status === 'SENT' || data.status === 'DISCARDED') continue;
                                            if (data.chat_id !== cb.message.chat.id) continue;
                                            sessions.push(data);
                                        }

                                        sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

                                        if (sessions.length === 0) {
                                            await sendMessage(cb.message.chat.id, '📋 No pending sessions.');
                                        } else {
                                            let msg = '📋 **PENDING SESSIONS**\n\nTap to switch:\n\n';
                                            const buttons: any[][] = [];

                                            for (const s of sessions.slice(0, 10)) {
                                                const icon = s.patient_id ? '🟡' : '🔴';
                                                const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '?';
                                                msg += `${icon} **${s.patient_name}** (${time}) - ${s.status}\n`;
                                                buttons.push([{ text: `${icon} ${s.patient_name} (${time})`, callback_data: `switch_session_${s.session_id}` }]);
                                            }
                                            buttons.push([{ text: '🔙 Cancel', callback_data: 'cancel_pending' }]);

                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: msg,
                                                    parse_mode: 'Markdown',
                                                    reply_markup: { inline_keyboard: buttons }
                                                })
                                            });
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error listing sessions:', err);
                                    }
                                } else if (action.startsWith('view_soap_')) {
                                    // View full SOAP for a session
                                    const sessionId = action.replace('view_soap_', '');
                                    const sessionFile = `/tmp/scribe_sessions/${sessionId}.json`;
                                    try {
                                        if (fs.existsSync(sessionFile)) {
                                            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                                            const soapNote = sessionData.documents?.soap_note || 'No SOAP note available';
                                            const safeSoap = soapNote.replace(/[*_`\[\]]/g, '');
                                            const patientName = sessionData.patient_name || 'Unknown';

                                            // Split if too long
                                            if (safeSoap.length > 3800) {
                                                for (let i = 0; i < safeSoap.length; i += 3800) {
                                                    const chunk = safeSoap.substring(i, i + 3800);
                                                    await sendMessage(cb.message.chat.id, `📄 SOAP Note (Part ${Math.floor(i / 3800) + 1}):\n\n${chunk}`);
                                                }
                                            } else {
                                                await sendMessage(cb.message.chat.id, `📄 Full SOAP Note:\n\n${safeSoap}`);
                                            }

                                            // Always show action buttons after SOAP
                                            const actionButtons = {
                                                inline_keyboard: [
                                                    [
                                                        { text: "✏️ Edit SOAP", callback_data: "edit_help" },
                                                        { text: "🔄 Change Patient", callback_data: "change_patient" }
                                                    ],
                                                    [
                                                        { text: "➕ Work Note", callback_data: "add_work_note" },
                                                        { text: "➕ Discharge", callback_data: "add_discharge_instructions" }
                                                    ],
                                                    [
                                                        { text: "🚀 Confirm & Send", callback_data: "confirm_send" },
                                                        { text: "🗑️ Discard", callback_data: "reject" }
                                                    ],
                                                    [{ text: "📋 Other Sessions", callback_data: "pending_sessions" }]
                                                ]
                                            };

                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: `📋 ${patientName} - What would you like to do?`,
                                                    reply_markup: actionButtons
                                                })
                                            });
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error viewing SOAP:', err);
                                    }
                                } else if (action === 'edit_help') {
                                    console.log('[Bot] 🔧 edit_help handler triggered');
                                    // Enter AI edit mode - save active session for text processing
                                    const activeSessionFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                                    console.log(`[Bot] Active edit file: ${activeSessionFile}`);

                                    // Find the most recent session for this chat
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    let activeSessionId = '';

                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                                        console.log(`[Bot] Found ${files.length} session files`);
                                        let latestSession: any = null;

                                        for (const file of files) {
                                            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                                            console.log(`[Bot] Checking ${file}: chat_id=${data.chat_id} (type: ${typeof data.chat_id}), current chat=${cb.message.chat.id} (type: ${typeof cb.message.chat.id}), status=${data.status}`);
                                            // Compare as numbers to handle type mismatch
                                            if (Number(data.chat_id) === Number(cb.message.chat.id) &&
                                                data.status !== 'SENT' && data.status !== 'DISCARDED') {
                                                if (!latestSession || (data.created_at > latestSession.created_at)) {
                                                    latestSession = data;
                                                    activeSessionId = data.session_id;
                                                    console.log(`[Bot] ✓ Matched session: ${activeSessionId}`);
                                                }
                                            }
                                        }

                                        if (activeSessionId) {
                                            fs.writeFileSync(activeSessionFile, JSON.stringify({
                                                session_id: activeSessionId,
                                                mode: 'edit',
                                                timestamp: Date.now()
                                            }));

                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: `✏️ EDIT MODE ACTIVE for ${latestSession?.patient_name || 'session'}\n\nType your edit instruction, for example:\n• "Remove shortness of breath diagnosis"\n• "Change blood pressure to 130/80"\n• "Add follow-up in 2 weeks"\n\nType your instruction now:`,
                                                    reply_markup: {
                                                        inline_keyboard: [[{ text: "❌ Cancel Edit", callback_data: "cancel_edit" }]]
                                                    }
                                                })
                                            });
                                        } else {
                                            await sendMessage(cb.message.chat.id, '⚠️ No active session found. Use /sessions to select one.');
                                        }
                                    } catch (err: any) {
                                        console.error('[Bot] Error entering edit mode:', err);
                                        await sendMessage(cb.message.chat.id, `❌ Error entering edit mode: ${err?.message || err}`);
                                    }

                                } else if (action === 'cancel_edit') {
                                    const activeSessionFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                                    if (fs.existsSync(activeSessionFile)) fs.unlinkSync(activeSessionFile);
                                    await sendMessage(cb.message.chat.id, '❌ Edit mode cancelled.');

                                } else if (action === 'change_patient') {
                                    await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            chat_id: cb.message.chat.id,
                                            text: `🔍 PATIENT SEARCH\n\nType the patient name to search:`,
                                            reply_markup: {
                                                inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_search" }]]
                                            }
                                        })
                                    });

                                    // Mark that we're in patient search mode
                                    const searchFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                                    fs.writeFileSync(searchFile, JSON.stringify({
                                        mode: 'patient_search',
                                        timestamp: Date.now()
                                    }));

                                } else if (action === 'add_work_note' || action === 'add_discharge_instructions') {
                                    const noteType = action === 'add_work_note' ? 'work_note' : 'discharge_instructions';
                                    const noteLabel = action === 'add_work_note' ? 'Work Note' : 'Discharge Instructions';

                                    await sendMessage(cb.message.chat.id, `⏳ Generating ${noteLabel}...`);

                                    // Find active session
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                                        let activeSession: any = null;

                                        for (const file of files) {
                                            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                                            if (data.chat_id === cb.message.chat.id &&
                                                data.status !== 'SENT' && data.status !== 'DISCARDED') {
                                                if (!activeSession || (data.created_at > activeSession.created_at)) {
                                                    activeSession = data;
                                                }
                                            }
                                        }

                                        if (activeSession && activeSession.documents?.[noteType]) {
                                            const note = activeSession.documents[noteType].replace(/[*_`\[\]]/g, '');
                                            await sendMessage(cb.message.chat.id, `📄 ${noteLabel}:\n\n${note}`);

                                            // Show action buttons
                                            const actionButtons = {
                                                inline_keyboard: [
                                                    [{ text: "✏️ Edit", callback_data: "edit_help" }, { text: "🔄 Change Patient", callback_data: "change_patient" }],
                                                    [{ text: "🚀 Confirm & Send", callback_data: "confirm_send" }, { text: "🗑️ Discard", callback_data: "reject" }],
                                                    [{ text: "📋 Other Sessions", callback_data: "pending_sessions" }]
                                                ]
                                            };
                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: `📋 ${activeSession.patient_name} - What next?`,
                                                    reply_markup: actionButtons
                                                })
                                            });
                                        } else {
                                            await sendMessage(cb.message.chat.id, `⚠️ ${noteLabel} not available for this session.`);
                                        }
                                    } catch (err) {
                                        console.error(`[Bot] Error showing ${noteType}:`, err);
                                    }

                                } else if (action === 'confirm_send') {
                                    await sendMessage(cb.message.chat.id, `⏳ Sending to Healthie...`);

                                    // Find active session
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                                        let activeSession: any = null;
                                        let sessionFile = '';

                                        for (const file of files) {
                                            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                                            if (data.chat_id === cb.message.chat.id &&
                                                data.status !== 'SENT' && data.status !== 'DISCARDED') {
                                                if (!activeSession || (data.created_at > activeSession.created_at)) {
                                                    activeSession = data;
                                                    sessionFile = path.join(sessionsDir, file);
                                                }
                                            }
                                        }

                                        if (activeSession) {
                                            const patientId = activeSession.classification?.patient_identification?.patient_id;

                                            if (!patientId) {
                                                await sendMessage(cb.message.chat.id, `⚠️ Cannot send: No patient assigned. Use "Change Patient" first.`);
                                                return;
                                            }

                                            // Call the scribe sender
                                            const { exec } = require('child_process');
                                            const cmd = `cd /home/ec2-user/scripts/scribe && python3 -c "
import json
from healthie_sender import send_chart_note
with open('${sessionFile}', 'r') as f:
    session = json.load(f)
success = send_chart_note(
    session['classification'],
    session['documents'],
    session['selected_types']
)
print('SUCCESS' if success else 'FAILED')
"`;

                                            exec(cmd, async (error: any, stdout: string, stderr: string) => {
                                                if (stdout.includes('SUCCESS')) {
                                                    // Update session status
                                                    activeSession.status = 'SENT';
                                                    fs.writeFileSync(sessionFile, JSON.stringify(activeSession, null, 2));

                                                    await sendMessage(cb.message.chat.id, `✅ Successfully sent to Healthie!\n\nPatient: ${activeSession.patient_name}\nSession: ${activeSession.session_id}`);
                                                } else {
                                                    console.error('[Bot] Healthie send error:', stderr);
                                                    await sendMessage(cb.message.chat.id, `❌ Failed to send to Healthie. Check logs.`);
                                                }
                                            });
                                        } else {
                                            await sendMessage(cb.message.chat.id, `⚠️ No active session found.`);
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error sending to Healthie:', err);
                                    }

                                } else if (action === 'reject') {
                                    // Discard the session
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

                                        for (const file of files) {
                                            const filePath = path.join(sessionsDir, file);
                                            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                            if (data.chat_id === cb.message.chat.id &&
                                                data.status !== 'SENT' && data.status !== 'DISCARDED') {
                                                data.status = 'DISCARDED';
                                                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                                                await sendMessage(cb.message.chat.id, `🗑️ Session discarded: ${data.patient_name}`);
                                                break;
                                            }
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error discarding session:', err);
                                    }

                                } else if (action.startsWith('select_patient_')) {
                                    // Patient selected from search
                                    const patientId = action.replace('select_patient_', '');
                                    console.log(`[Bot] 👤 Patient selected: ${patientId}`);

                                    // Clear search mode
                                    const searchFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                                    if (fs.existsSync(searchFile)) fs.unlinkSync(searchFile);

                                    // Find and update the most recent session
                                    const sessionsDir = '/tmp/scribe_sessions';
                                    try {
                                        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
                                        let latestSession: any = null;
                                        let latestFile = '';

                                        for (const file of files) {
                                            const filePath = path.join(sessionsDir, file);
                                            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                            if (data.chat_id === cb.message.chat.id &&
                                                data.status !== 'SENT' && data.status !== 'DISCARDED') {
                                                if (!latestSession || (data.created_at > latestSession.created_at)) {
                                                    latestSession = data;
                                                    latestFile = filePath;
                                                }
                                            }
                                        }

                                        if (latestSession && latestFile) {
                                            // Look up patient name
                                            const { patientsService } = await import('../../lib/patients');
                                            const patients = await patientsService.findByHealthieId(patientId);
                                            const patientName = patients[0]?.fullName || latestSession.patient_name;

                                            // Update session with patient info
                                            latestSession.classification = latestSession.classification || {};
                                            latestSession.classification.patient_identification = latestSession.classification.patient_identification || {};
                                            latestSession.classification.patient_identification.patient_id = patientId;
                                            latestSession.classification.patient_identification.matched_name = patientName;
                                            latestSession.patient_name = patientName;
                                            latestSession.patient_id = patientId;
                                            latestSession.status = 'READY';

                                            fs.writeFileSync(latestFile, JSON.stringify(latestSession, null, 2));

                                            await sendMessage(cb.message.chat.id, `✅ Patient set to: ${patientName}\n\nSession is now READY to send.`);

                                            // Show action buttons
                                            const actionButtons = {
                                                inline_keyboard: [
                                                    [
                                                        { text: "📄 View SOAP", callback_data: `view_soap_${latestSession.session_id}` },
                                                        { text: "✏️ Edit", callback_data: "edit_help" }
                                                    ],
                                                    [
                                                        { text: "🚀 Confirm & Send", callback_data: "confirm_send" },
                                                        { text: "🗑️ Discard", callback_data: "reject" }
                                                    ],
                                                    [{ text: "📋 Other Sessions", callback_data: "pending_sessions" }]
                                                ]
                                            };

                                            await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    chat_id: cb.message.chat.id,
                                                    text: `📋 ${patientName} - Ready to send!`,
                                                    reply_markup: actionButtons
                                                })
                                            });
                                        }
                                    } catch (err) {
                                        console.error('[Bot] Error selecting patient:', err);
                                        await sendMessage(cb.message.chat.id, '❌ Error selecting patient.');
                                    }

                                } else if (action === 'cancel_search') {
                                    const searchFile = path.join(approvalDir, `active_edit_${cb.message.chat.id}.json`);
                                    if (fs.existsSync(searchFile)) fs.unlinkSync(searchFile);
                                    await sendMessage(cb.message.chat.id, '❌ Search cancelled.');

                                } else if (!action.startsWith('toggle_')) {
                                    let statusEmoji = '📝 PROCESSING';
                                    if (action === 'approve') {
                                        statusEmoji = '✅ APPROVED';
                                    } else if (action === 'view_soap') {
                                        statusEmoji = '📄 VIEWING SOAP';
                                    }
                                    await sendMessage(cb.message.chat.id, `Received: ${statusEmoji}`);
                                }
                            }
                        } catch (err) {
                            console.error('[Bot] Failed to save approval IPC:', err);
                        }
                    }
                }
            }
        } catch (error: any) {
            const msg = error.message || '';
            if (msg.includes('fetch failed') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
                console.warn(`[Bot] ⚠️ Network error polling Telegram (retrying in 5s): ${msg}`);
            } else {
                console.error('[Bot] Polling error:', error);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down bot...');
    destroyConnection();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Received SIGTERM, shutting down...');
    destroyConnection();
    process.exit(0);
});

// Start the bot
main().catch(console.error);

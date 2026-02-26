/**
 * Message Handlers Module
 * 
 * Routes messages to appropriate handlers
 */

// Load env from home directory
require('dotenv').config({ path: '/home/ec2-user/.env' });

import * as fs from 'fs';
import * as path from 'path';
import { patientsService } from '../../lib/patients';
import { fetchGraphQL } from '../../lib/healthie/financials';

// Import from other modules
import { callGemini, callGeminiWithTools } from './gemini';
import { connectSnowflake, executeQuery, executeQueryWithRetry } from './snowflake';
import {
    getConversationContext,
    setConversationContext,
    isFollowUpQuery,
    extractPatientName,
    isFinancialQuery,
    logMissingData,
    loadDiscoveredSchema,
    SCHEMA_CONTEXT
} from './conversation';
import {
    findHealthieUser,
    fetchHealthieBillingItems,
    fetchHealthieRequestedPayments,
    updateHealthiePatient,
    findHealthieClientId,
    parseUpdateCommand
} from './healthie';
import { executeAgenticTool } from './agentic-tools';
import { generateSQL, formatAnswer } from './sql-generator';

// Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const AUTHORIZED_CHAT_IDS = process.env.TELEGRAM_AUTHORIZED_CHAT_IDS?.split(',').map(id => parseInt(id.trim())) || [];

// ============================================================================
// TELEGRAM API HELPERS
// ============================================================================
export async function sendMessage(chatId: number, text: string, parseMode?: 'Markdown' | 'HTML') {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Bot] No Telegram token configured');
        return;
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode
            })
        });
    } catch (error) {
        console.error('[Bot] Send error:', error);
    }
}

export async function sendTyping(chatId: number) {
    if (!TELEGRAM_BOT_TOKEN) return;

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                action: 'typing'
            })
        });
    } catch (error) {
        console.error('[Bot] Typing error:', error);
    }
}

// ============================================================================
// PATIENT LOOKUP HANDLER
// ============================================================================
export async function handlePatientLookup(chatId: number, query: string) {
    try {
        await sendTyping(chatId);
        const patients = await patientsService.findByQuery({ name: query });

        if (patients.length === 0) {
            await sendMessage(chatId, `No patients found matching "${query}" in the dashboard.`);
            return;
        }

        let response = `🔍 *Found ${patients.length} patient(s):*\n\n`;
        for (const p of patients.slice(0, 5)) {
            response += `👤 *${p.fullName}*\n`;
            response += `🆔 Patient ID: \`${p.patientId}\`\n`;
            if (p.healthieClientId) response += `🏥 Healthie ID: \`${p.healthieClientId}\`\n`;
            if (p.ghlContactId) response += `📱 GHL ID: \`${p.ghlContactId}\`\n`;
            if (p.email) response += `📧 ${p.email}\n`;
            if (p.phone) response += `📞 ${p.phone}\n`;
            response += '\n';
        }

        if (patients.length > 5) {
            response += `_...and ${patients.length - 5} more._`;
        }

        await sendMessage(chatId, response, 'Markdown');
    } catch (error: any) {
        console.error('Patient lookup error:', error);
        await sendMessage(chatId, `❌ Error looking up patient: ${error.message}`);
    }
}

// ============================================================================
// HEALTHIE FINANCE HANDLER
// ============================================================================
export async function handleHealthieFinance(chatId: number, patientName: string) {
    try {
        await sendTyping(chatId);

        const userSearchQuery = `
      query FindUser($keywords: String!) {
        users(keywords: $keywords, page_size: 5) {
          id
          email
          first_name
          last_name
          phone_number
          active_tags { id name }
        }
      }
    `;

        let healthieUser: any = null;
        try {
            const searchData = await fetchGraphQL<any>(userSearchQuery, { keywords: patientName });
            if (searchData.users && searchData.users.length > 0) {
                healthieUser = searchData.users[0];
            }
        } catch (e: any) {
            console.error('User search error:', e);
        }

        if (!healthieUser) {
            await sendMessage(chatId, `No patient found in Healthie matching "${patientName}".`);
            return;
        }

        const healthieClientId = healthieUser.id;
        const fullName = `${healthieUser.first_name} ${healthieUser.last_name}`;

        await sendTyping(chatId);

        const billingItems = await fetchHealthieBillingItems(healthieClientId);
        const requestedPayments = await fetchHealthieRequestedPayments(patientName, healthieClientId);

        let totalPaid = 0;
        let response = `💰 *Healthie Financial Data for ${fullName}*\n`;
        response += `🆔 Healthie ID: \`${healthieClientId}\`\n`;
        response += `📧 ${healthieUser.email || 'N/A'} | 📞 ${healthieUser.phone_number || 'N/A'}\n`;
        if (healthieUser.active_tags?.length) {
            response += `🏷️ ${healthieUser.active_tags.map((t: any) => t.name).join(', ')}\n`;
        }
        response += '\n';

        // Billing Items
        if (billingItems.length > 0) {
            response += `📋 *Billing Items (${billingItems.length}):*\n`;
            for (const item of billingItems.slice(0, 10)) {
                const amount = parseFloat(item.amount_paid || '0');
                if (item.state === 'succeeded') totalPaid += amount;
                const date = item.created_at?.split(' ')[0] || item.created_at?.split('T')[0] || 'N/A';
                response += `• ${item.offering?.name || 'Charge'}: *$${amount.toFixed(2)}* (${item.state}) - ${date}\n`;
            }
            if (billingItems.length > 10) response += `  _...and ${billingItems.length - 10} more_\n`;
            response += '\n';
        } else {
            response += `📋 *Billing Items:* None\n\n`;
        }

        // Requested Payments
        if (requestedPayments.length > 0) {
            response += `💳 *Requested Payments (${requestedPayments.length}):*\n`;
            for (const rp of requestedPayments.slice(0, 10)) {
                const amount = parseFloat(rp.price || '0');
                const date = rp.paid_at?.split(' ')[0] || rp.created_at?.split('T')[0] || 'N/A';
                response += `• ${rp.offering?.name || 'Payment'}: *$${amount.toFixed(2)}* (${rp.status}) - ${date}\n`;
            }
            if (requestedPayments.length > 10) response += `  _...and ${requestedPayments.length - 10} more_\n`;
            response += '\n';
        } else {
            response += `💳 *Requested Payments:* None\n\n`;
        }

        response += `💵 *Total Paid (from billing items):* $${totalPaid.toFixed(2)}`;

        await sendMessage(chatId, response, 'Markdown');
    } catch (error: any) {
        console.error('Healthie finance error:', error);
        await sendMessage(chatId, `❌ Error fetching Healthie data: ${error.message}`);
    }
}

// ============================================================================
// HEALTHIE UPDATE HANDLER
// ============================================================================
export async function handleHealthieUpdate(chatId: number, text: string): Promise<boolean> {
    const parsed = parseUpdateCommand(text);
    if (!parsed) {
        return false;
    }

    console.log(`[Bot] 📝 Parsed update command:`, parsed);
    await sendTyping(chatId);

    const { healthieClientId, fullName } = await findHealthieClientId(parsed.patientName);

    if (!healthieClientId) {
        await sendMessage(chatId,
            `❌ Could not find patient "${parsed.patientName}" or they don't have a Healthie account linked.\n\n` +
            `Make sure the patient exists in the system and has a Healthie client ID.`
        );
        return true;
    }

    let confirmMsg = `📝 *Updating ${fullName} in Healthie*\n\n`;
    confirmMsg += `*Update type:* ${parsed.updateType}\n`;
    confirmMsg += `*Changes:*\n`;

    for (const [key, value] of Object.entries(parsed.fields)) {
        if (value !== undefined) {
            confirmMsg += `• ${key.replace('_', ' ')}: \`${value}\`\n`;
        }
    }

    confirmMsg += `\n⏳ _Processing update..._`;
    await sendMessage(chatId, confirmMsg, 'Markdown');

    const result = await updateHealthiePatient(healthieClientId, parsed.fields);

    if (result.success) {
        let successMsg = `✅ *Successfully updated ${fullName}!*\n\n`;
        if (result.user) {
            successMsg += `*Updated profile:*\n`;
            if (result.user.email) successMsg += `• Email: ${result.user.email}\n`;
            if (result.user.phone_number) successMsg += `• Phone: ${result.user.phone_number}\n`;
            if (result.user.location) {
                const loc = result.user.location;
                if (loc.line1) successMsg += `• Address: ${loc.line1}`;
                if (loc.line2) successMsg += `, ${loc.line2}`;
                if (loc.city) successMsg += `, ${loc.city}`;
                if (loc.state) successMsg += `, ${loc.state}`;
                if (loc.zip) successMsg += ` ${loc.zip}`;
                successMsg += `\n`;
            }
        }
        await sendMessage(chatId, successMsg, 'Markdown');
    } else {
        let errorMsg = `❌ *Failed to update ${fullName}*\n\n`;
        if (result.errors) {
            for (const err of result.errors) {
                errorMsg += `• ${err.field}: ${err.message}\n`;
            }
        }
        await sendMessage(chatId, errorMsg, 'Markdown');
    }

    return true;
}

// ============================================================================
// MAIN MESSAGE HANDLER
// ============================================================================
export async function handleMessage(chatId: number, text: string, username?: string) {
    console.log(`[Bot] Message from ${username} (${chatId}): ${text}`);

    // Authorization check
    if (AUTHORIZED_CHAT_IDS.length > 0 && !AUTHORIZED_CHAT_IDS.includes(chatId)) {
        await sendMessage(chatId, '⛔ You are not authorized to use this bot.');
        return;
    }

    // Check for scribe lock (collision avoidance)
    const lockFile = `/tmp/scribe_lock_${chatId}`;
    if (fs.existsSync(lockFile)) {
        console.log(`[Bot] Scribe lock active for ${chatId}. Forwarding message to Scribe...`);
        const responseDir = "/tmp/telegram_approvals";
        if (!fs.existsSync(responseDir)) fs.mkdirSync(responseDir);
        fs.writeFileSync(
            path.join(responseDir, `text_response_${chatId}.json`),
            JSON.stringify({ text, timestamp: Date.now() })
        );
        return;
    }

    const textLower = text.toLowerCase();

    // /start command
    if (textLower === '/start') {
        await sendMessage(chatId,
            `🤖 *GMH Clinic AI Assistant (V2) - Self-Learning System*

I can answer questions about your clinic data. I automatically:
• 📊 Query Snowflake (demographics, billing, inventory)
• 💳 Fetch Healthie API (real-time billing, payments)
• 🔧 Self-correct SQL errors automatically
• 📝 Learn what data is missing for future improvements
• ✏️ Update patient profiles in Healthie!

📊 *Query Commands:*
• /patient Andrew Lang - Basic patient info
• /healthie Andrew Lang - Healthie financial data only
• /schema-gaps - See what data is missing
• /refresh-schema - Re-discover database schema
• "Give me all data on Andrew Lang" - FULL data from ALL systems!

✏️ *Update Commands (natural language):*
• "Update address for John Smith to 123 Main St, City, ST 12345"
• "Change phone number for Jane Doe to 555-123-4567"
• "Set email for Bob Wilson to new@email.com"

🤖 *Agentic AI Commands (NEW!):*
• /agent find John Smith - Search patients
• /agent get labs for John Smith - Get lab results
• /agent send John Smith his latest lab results - Multi-step action!
• /agent create task for John: call to follow up

Just ask your question in plain English!`, 'Markdown');
        return;
    }

    // /schema-gaps command
    if (textLower === '/schema-gaps') {
        let response = '📝 *Schema Gaps & Missing Data Requests*\n\n';

        try {
            const logPath = path.join(__dirname, '../../data/missing-data-requests.json');
            if (fs.existsSync(logPath)) {
                const logged = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                if (logged.length > 0) {
                    const grouped = new Map<string, number>();
                    for (const req of logged) {
                        grouped.set(req.missingElement, (grouped.get(req.missingElement) || 0) + 1);
                    }
                    response += '*Columns requested but not found:*\n';
                    for (const [col, count] of Array.from(grouped.entries()).sort((a, b) => b[1] - a[1])) {
                        response += `• \`${col}\` - requested ${count} time(s)\n`;
                    }
                } else {
                    response += '_No missing data requests logged yet._';
                }
            } else {
                response += '_No missing data requests logged yet._';
            }
        } catch (e) {
            response += '_Error loading missing data log._';
        }

        response += '\n\n_Run /refresh-schema to re-discover the database structure._';
        await sendMessage(chatId, response, 'Markdown');
        return;
    }

    // /refresh-schema command
    if (textLower === '/refresh-schema') {
        await sendMessage(chatId, '🔄 _Re-discovering database schema... This may take a moment._', 'Markdown');
        try {
            const { execSync } = require('child_process');
            execSync('npx tsx scripts/discover-schema.ts', {
                cwd: '/home/ec2-user/gmhdashboard',
                timeout: 60000
            });
            const newSchema = loadDiscoveredSchema();
            if (newSchema) {
                await sendMessage(chatId, '✅ Schema refreshed! I now have the latest database structure.', 'Markdown');
            } else {
                await sendMessage(chatId, '⚠️ Schema discovery completed but could not reload. Try restarting the bot.', 'Markdown');
            }
        } catch (e: any) {
            await sendMessage(chatId, `❌ Schema refresh failed: ${e.message}`, 'Markdown');
        }
        return;
    }

    // /sessions command - List pending scribe sessions
    console.log(`[Bot] 🔍 Checking /sessions: textLower="${textLower}" === "/sessions" ? ${textLower === '/sessions'}`);
    if (textLower === '/sessions' || textLower.startsWith('/session')) {
        console.log('[Bot] 📋 /sessions command - listing pending scribe sessions');
        const sessionsDir = '/tmp/scribe_sessions';

        try {
            if (!fs.existsSync(sessionsDir)) {
                await sendMessage(chatId, '📋 No pending sessions.');
                return;
            }

            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
            const sessions: any[] = [];

            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
                if (data.status === 'SENT' || data.status === 'DISCARDED') continue;
                if (data.chat_id !== chatId) continue;
                sessions.push(data);
            }

            sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

            if (sessions.length === 0) {
                await sendMessage(chatId, '📋 No pending sessions.\n\nAll patient visits have been completed or discarded.');
                return;
            }

            let msg = '📋 *PENDING SCRIBE SESSIONS*\n\nTap to switch to a patient:\n\n';
            const buttons: any[][] = [];

            for (const s of sessions.slice(0, 10)) {
                const icon = s.patient_id ? '🟡' : '🔴';
                const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '?';
                msg += `${icon} *${s.patient_name}* (${time}) - ${s.status}\n`;
                buttons.push([{ text: `${icon} ${s.patient_name} (${time})`, callback_data: `switch_session_${s.session_id}` }]);
            }

            buttons.push([{ text: '🔙 Cancel', callback_data: 'cancel_pending' }]);

            const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: buttons }
                })
            });
        } catch (err) {
            console.error('[Bot] Error listing sessions:', err);
            await sendMessage(chatId, '❌ Error listing sessions.');
        }
        return;
    }

    // /patient command
    if (textLower.startsWith('/patient ')) {
        const query = text.substring('/patient '.length).trim();
        await handlePatientLookup(chatId, query);
        return;
    }

    // /healthie command
    if (textLower.startsWith('/healthie ')) {
        const query = text.substring('/healthie '.length).trim();
        console.log(`[Bot] Handling /healthie command for: ${query}`);
        await handleHealthieFinance(chatId, query);
        return;
    }

    // /agent command - Agentic AI with function calling
    if (textLower.startsWith('/agent ')) {
        const query = text.substring('/agent '.length).trim();
        console.log(`[Bot] 🤖 Agentic query: "${query}"`);
        await sendTyping(chatId);

        try {
            const systemPrompt = `You are an AI assistant for a men's health clinic. You have access to tools for:
- Searching patients (by name, phone, email)
- Getting patient lab results from Healthie
- Sending emails via AWS SES
- Creating tasks in Healthie

When a user asks you to do something, use the appropriate tool. For multi-step tasks, you may need to call multiple tools.
Always confirm what you're doing before sending emails.`;

            let response = await callGeminiWithTools(query, systemPrompt);
            let maxIterations = 5;
            let iteration = 0;
            let conversationLog = `🤖 *Agentic AI Processing*\n\nQuery: "${query}"\n\n`;

            while (response.functionCall && iteration < maxIterations) {
                iteration++;
                const { name, args } = response.functionCall;
                conversationLog += `*Step ${iteration}:* Calling \`${name}\`\n`;

                console.log(`[Agentic] Step ${iteration}: Executing ${name}`, args);
                const toolResult = await executeAgenticTool(name, args);
                console.log(`[Agentic] Tool result:`, toolResult.substring(0, 200));

                const followUpPrompt = `Tool "${name}" returned: ${toolResult}\n\nBased on this result, what should I do next? If the task is complete, provide a summary for the user.`;
                response = await callGeminiWithTools(followUpPrompt, systemPrompt);
            }

            if (response.text) {
                conversationLog += `\n*Result:*\n${response.text}`;
            } else if (response.functionCall) {
                conversationLog += `\n⚠️ Max iterations reached. Last tool: ${response.functionCall.name}`;
            }

            await sendMessage(chatId, conversationLog, 'Markdown');

        } catch (error: any) {
            console.error('[Agentic] Error:', error);
            await sendMessage(chatId, `❌ Agentic error: ${error.message}`);
        }
        return;
    }

    // Update commands (natural language)
    if (textLower.match(/^(please\s+)?(can\s+you\s+)?(update|change|set|modify|edit)\s/)) {
        console.log(`[Bot] Detected potential update command: "${text}"`);
        const wasHandled = await handleHealthieUpdate(chatId, text);
        if (wasHandled) return;
        console.log(`[Bot] Update command not fully parsed, falling through to SQL generation`);
    }

    // SMART DATA FUSION: Main query handling
    const detectedPatientName = extractPatientName(text);
    const needsFinancialData = isFinancialQuery(text);
    const prevContext = getConversationContext(chatId);
    const isFollowUp = isFollowUpQuery(text);

    console.log(`[Bot] Smart detection: patient="${detectedPatientName}", financial=${needsFinancialData}, followUp=${isFollowUp}`);
    if (isFollowUp && prevContext) {
        console.log(`[Bot] 🔄 Using previous context: "${prevContext.lastQuery}" with ${prevContext.lastResults.length} results`);
    }

    try {
        await sendTyping(chatId);

        console.log('[Bot] Generating SQL...');
        const sql = await generateSQL(text, prevContext);
        console.log('[Bot] Generated SQL:', sql);

        const isSql = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i.test(sql);
        if (!isSql) {
            console.log('[Bot] Generated content is not SQL.');
            await sendMessage(chatId, `I generated a text response instead of SQL. I will not execute it as a query.\n\n${sql}`);
            return;
        }

        await sendTyping(chatId);
        console.log('[Bot] Executing Snowflake query (with self-healing)...');
        const { results: snowflakeResults, finalSQL, retryCount } = await executeQueryWithRetry(sql, text, SCHEMA_CONTEXT, prevContext);
        console.log('[Bot] Got', snowflakeResults.length, 'Snowflake results', retryCount > 0 ? `(after ${retryCount} retries)` : '');

        const sqlWasFixed = retryCount > 0;
        const actualSQL = finalSQL;

        // If asking about a specific patient, query Healthie API for complete data
        let healthieData: any = null;
        if (detectedPatientName) {
            console.log(`[Bot] 🔗 SMART FUSION: Fetching Healthie API data for "${detectedPatientName}"...`);
            await sendTyping(chatId);

            try {
                const healthieUser = await findHealthieUser(detectedPatientName);
                if (healthieUser) {
                    const billingItems = await fetchHealthieBillingItems(healthieUser.id);
                    const requestedPayments = await fetchHealthieRequestedPayments(detectedPatientName, healthieUser.id);

                    let totalBillingPaid = 0;
                    for (const item of billingItems) {
                        if (item.state === 'succeeded') {
                            totalBillingPaid += parseFloat(item.amount_paid || '0');
                        }
                    }

                    healthieData = {
                        user: healthieUser,
                        billingItems,
                        requestedPayments,
                        totalPaid: totalBillingPaid
                    };

                    console.log(`[Bot] ✅ Healthie data: ${billingItems.length} billing items, $${healthieData.totalPaid.toFixed(2)} total paid`);
                }
            } catch (e: any) {
                console.error('[Bot] Healthie API error:', e.message);
            }
        }

        // Format combined answer
        await sendTyping(chatId);
        console.log('[Bot] Formatting combined answer...');

        let combinedContext = '';
        if (healthieData) {
            let addressStr = 'Not on file';
            const loc = healthieData.user.locations?.[0];
            if (loc) {
                const parts = [loc.line1, loc.line2, loc.city, loc.state, loc.zip, loc.country].filter(Boolean);
                addressStr = parts.join(', ') || 'Not on file';
            }

            combinedContext = `
HEALTHIE API DATA (Real-time):
- Patient: ${healthieData.user.first_name} ${healthieData.user.last_name} (ID: ${healthieData.user.id})
- Email: ${healthieData.user.email || 'N/A'}
- Phone: ${healthieData.user.phone_number || 'N/A'}
- Address: ${addressStr}
- Billing Items: ${healthieData.billingItems.length}
- Total Paid: $${healthieData.totalPaid.toFixed(2)}
`;
        }

        const answer = await formatAnswer(text, actualSQL, snowflakeResults, combinedContext);
        await sendMessage(chatId, answer);

        if (snowflakeResults.length > 0) {
            let sqlMessage = `\`\`\`sql\n${actualSQL}\n\`\`\``;
            if (sqlWasFixed) {
                sqlMessage = `🔧 _Query self-corrected after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}_\n` + sqlMessage;
            }
            await sendMessage(chatId, sqlMessage, 'Markdown');
        }

        // Save conversation context
        setConversationContext(chatId, text, actualSQL, snowflakeResults);
        console.log(`[Bot] 💾 Saved context: ${snowflakeResults.length} results for follow-ups`);

        if (healthieData) {
            await sendMessage(chatId, `\n🔗 _Data combined from Snowflake + Healthie API for complete view_`, 'Markdown');
        }

    } catch (error: any) {
        console.error('[Bot] Error after all retries:', error);

        if (error.message?.includes('invalid identifier')) {
            const match = error.message.match(/invalid identifier '(\w+)'/i);
            if (match) {
                logMissingData(chatId, text, match[1]);
            }
        }

        let errorMsg = `❌ Error: ${error.message}`;
        if (error.message?.includes('invalid identifier')) {
            errorMsg += `\n\n💡 _The query referenced a column that doesn't exist. I tried to self-correct but couldn't find a working solution._\n\n📝 _This data gap has been logged. Run \`/schema-gaps\` to see what data is missing and how to add it._`;
        }
        await sendMessage(chatId, errorMsg, 'Markdown');
    }
}

/**
 * Telegram Bot Client - Shared Library
 * 
 * Consolidated Telegram API functions for all GMH scripts.
 * Used by: telegram-ai-bot-v2.ts, morning-telegram-report.ts
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramMessage {
    chat: {
        id: number;
        type: string;
    };
    from?: {
        id: number;
        first_name: string;
        last_name?: string;
        username?: string;
    };
    text?: string;
    message_id: number;
    reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: {
        id: string;
        from: {
            id: number;
            first_name: string;
            username?: string;
        };
        message?: TelegramMessage;
        data?: string;
        chat_instance: string;
    };
}

export interface InlineKeyboardButton {
    text: string;
    callback_data?: string;
    url?: string;
}

export interface InlineKeyboard {
    inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
    parseMode?: 'Markdown' | 'HTML';
    replyToMessageId?: number;
    replyMarkup?: InlineKeyboard;
    disableWebPagePreview?: boolean;
}

/**
 * Send a message to a Telegram chat
 */
export async function sendMessage(
    chatId: number | string,
    text: string,
    options?: SendMessageOptions
): Promise<{ ok: boolean; result?: any; error?: string }> {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Telegram] Bot token not configured');
        return { ok: false, error: 'Bot token not configured' };
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const body: any = {
        chat_id: chatId,
        text,
    };

    if (options?.parseMode) {
        body.parse_mode = options.parseMode;
    }
    if (options?.replyToMessageId) {
        body.reply_to_message_id = options.replyToMessageId;
    }
    if (options?.replyMarkup) {
        body.reply_markup = options.replyMarkup;
    }
    if (options?.disableWebPagePreview) {
        body.disable_web_page_preview = options.disableWebPagePreview;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
            console.error('[Telegram] Failed to send message:', data);
            return { ok: false, error: data.description || 'Unknown error' };
        }

        return { ok: true, result: data.result };
    } catch (error: any) {
        console.error('[Telegram] Error sending message:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * Send typing indicator
 */
export async function sendTyping(chatId: number | string): Promise<void> {
    if (!TELEGRAM_BOT_TOKEN) return;

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                action: 'typing',
            }),
        });
    } catch (error) {
        console.error('[Telegram] Error sending typing action:', error);
    }
}

/**
 * Answer callback query (from inline keyboard button press)
 */
export async function answerCallbackQuery(
    callbackQueryId: string,
    options?: {
        text?: string;
        showAlert?: boolean;
    }
): Promise<void> {
    if (!TELEGRAM_BOT_TOKEN) return;

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: options?.text,
                show_alert: options?.showAlert || false,
            }),
        });
    } catch (error) {
        console.error('[Telegram] Error answering callback query:', error);
    }
}

/**
 * Edit an existing message
 */
export async function editMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: { parseMode?: 'Markdown' | 'HTML'; replyMarkup?: InlineKeyboard }
): Promise<{ ok: boolean; error?: string }> {
    if (!TELEGRAM_BOT_TOKEN) {
        return { ok: false, error: 'Bot token not configured' };
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;

    const body: any = {
        chat_id: chatId,
        message_id: messageId,
        text,
    };

    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return { ok: data.ok };
    } catch (error: any) {
        console.error('[Telegram] Error editing message:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * Send a document (file)
 */
export async function sendDocument(
    chatId: number | string,
    document: Buffer | string,
    options?: {
        filename?: string;
        caption?: string;
        mimeType?: string;
    }
): Promise<{ ok: boolean; error?: string }> {
    if (!TELEGRAM_BOT_TOKEN) {
        return { ok: false, error: 'Bot token not configured' };
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

    try {
        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('chat_id', String(chatId));

        if (typeof document === 'string') {
            formData.append('document', document);
        } else {
            formData.append('document', document, {
                filename: options?.filename || 'document',
                contentType: options?.mimeType || 'application/octet-stream',
            });
        }

        if (options?.caption) {
            formData.append('caption', options.caption);
        }

        const response = await fetch(url, {
            method: 'POST',
            body: formData as any,
        });

        const data = await response.json();
        return { ok: data.ok };
    } catch (error: any) {
        console.error('[Telegram] Error sending document:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * Set webhook URL
 */
export async function setWebhook(webhookUrl: string): Promise<boolean> {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Telegram] Bot token not configured');
        return false;
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                allowed_updates: ['message', 'callback_query'],
            }),
        });

        const result = await response.json();
        console.log('[Telegram] Webhook set result:', result);
        return result.ok;
    } catch (error) {
        console.error('[Telegram] Error setting webhook:', error);
        return false;
    }
}

/**
 * Get webhook info
 */
export async function getWebhookInfo(): Promise<any> {
    if (!TELEGRAM_BOT_TOKEN) return null;

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`;

    try {
        const response = await fetch(url);
        const result = await response.json();
        return result.result;
    } catch (error) {
        console.error('[Telegram] Error getting webhook info:', error);
        return null;
    }
}

/**
 * Get updates (for polling mode)
 */
export async function getUpdates(
    offset?: number,
    timeout: number = 5
): Promise<TelegramUpdate[]> {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }

    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
    const params: any = {
        timeout,
        allowed_updates: ['message', 'callback_query'],
    };
    if (offset) params.offset = offset;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        const data = await response.json();
        return data.result || [];
    } catch (error: any) {
        console.error('[Telegram] Error getting updates:', error.message);
        return [];
    }
}

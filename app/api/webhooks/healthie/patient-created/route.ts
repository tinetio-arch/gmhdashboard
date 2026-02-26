import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

/**
 * Healthie Patient Created Webhook Handler
 * 
 * Triggered when: patient.created event fires in Healthie
 * Purpose: Sync new patient to Snowflake immediately for scribe system availability
 * 
 * Healthie Webhook Setup:
 * 1. Go to Healthie Settings → Developer → Webhooks
 * 2. Add endpoint: https://nowoptimal.com/ops/api/webhooks/healthie/patient-created
 * 3. Select event: patient.created
 */

const WEBHOOK_SECRET = process.env.HEALTHIE_WEBHOOK_SECRET;
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

interface PatientCreatedPayload {
    event_type?: string;
    resource_id?: string;
    resource_id_type?: string;
    resource?: {
        id: string;
        first_name?: string;
        last_name?: string;
        email?: string;
        dob?: string;
    };
}

function extractQuerySecret(request: Request): string | null {
    try {
        const url = new URL(request.url);
        return (
            url.searchParams.get('secret') ||
            url.searchParams.get('token') ||
            url.searchParams.get('webhook_secret')
        );
    } catch {
        return null;
    }
}

function isAuthorized(request: Request): boolean {
    if (!WEBHOOK_SECRET) {
        // No secret configured - allow all (development mode)
        return true;
    }

    const querySecret = extractQuerySecret(request);
    if (querySecret === WEBHOOK_SECRET) {
        return true;
    }

    const provided =
        request.headers.get('x-healthie-secret') ||
        request.headers.get('x-webhook-secret') ||
        request.headers.get('authorization');

    if (!provided) {
        return false;
    }

    if (provided === WEBHOOK_SECRET) {
        return true;
    }

    if (provided.startsWith('Bearer ')) {
        return provided.slice('Bearer '.length) === WEBHOOK_SECRET;
    }

    // Also accept Basic auth with Healthie API key
    if (HEALTHIE_API_KEY && provided.startsWith('Basic ')) {
        const encoded = provided.slice('Basic '.length).trim();
        if (encoded === HEALTHIE_API_KEY) {
            return true;
        }
    }

    return false;
}

async function sendTelegramAlert(message: string): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_APPROVAL_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.log('[patient-created-webhook] Telegram not configured');
        return;
    }

    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown',
            }),
        });
    } catch (error) {
        console.error('[patient-created-webhook] Telegram alert failed:', error);
    }
}

async function triggerPatientSync(): Promise<{ success: boolean; message: string }> {
    /**
     * Triggers the Healthie → Snowflake patient sync script.
     * This ensures the new patient is immediately available in the scribe system.
     */
    return new Promise((resolve) => {
        const syncScript = '/home/ec2-user/scripts/scribe/healthie_snowflake_sync.py';

        console.log('[patient-created-webhook] Triggering patient sync...');

        const process = spawn('python3', [syncScript], {
            cwd: '/home/ec2-user/scripts/scribe',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...globalThis.process?.env,
                PATH: '/usr/local/bin:/usr/bin:/bin',
            },
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
            process.kill();
            resolve({
                success: false,
                message: 'Sync timed out after 60 seconds',
            });
        }, 60000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                console.log('[patient-created-webhook] Sync completed successfully');
                resolve({
                    success: true,
                    message: 'Patient sync completed',
                });
            } else {
                console.error('[patient-created-webhook] Sync failed:', stderr);
                resolve({
                    success: false,
                    message: `Sync failed with code ${code}: ${stderr.slice(0, 200)}`,
                });
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            console.error('[patient-created-webhook] Sync spawn error:', error);
            resolve({
                success: false,
                message: `Spawn error: ${error.message}`,
            });
        });
    });
}

export async function POST(request: Request): Promise<Response> {
    console.log('[patient-created-webhook] Received webhook');

    // Verify authorization
    if (!isAuthorized(request)) {
        console.warn('[patient-created-webhook] Unauthorized request');
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Parse payload
    let payload: PatientCreatedPayload;
    try {
        payload = await request.json();
    } catch (error) {
        console.error('[patient-created-webhook] Invalid JSON:', error);
        return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    // Log webhook for debugging
    console.log('[patient-created-webhook] Payload:', JSON.stringify(payload, null, 2));

    // Extract event type
    const eventType = payload.event_type || 'patient.created';

    // Verify this is a patient event
    if (!eventType.includes('patient')) {
        console.log(`[patient-created-webhook] Ignoring event type: ${eventType}`);
        return NextResponse.json({ success: true, message: 'Event ignored' });
    }

    // Extract patient info
    const resource = payload.resource;
    const patientId = payload.resource_id || resource?.id || 'unknown';
    const patientName = resource
        ? `${resource.first_name || ''} ${resource.last_name || ''}`.trim()
        : 'Unknown';

    console.log(`[patient-created-webhook] New patient: ${patientName} (ID: ${patientId})`);

    // Send immediate Telegram notification
    await sendTelegramAlert(
        `👤 *New Patient Created in Healthie*\n\n` +
        `*Name:* ${patientName || 'Not provided'}\n` +
        `*Healthie ID:* \`${patientId}\`\n\n` +
        `🔄 Syncing to Snowflake...`
    );

    // Trigger sync in the background (don't wait)
    // This ensures patient is available in scribe system immediately
    triggerPatientSync().then(async (result) => {
        if (result.success) {
            await sendTelegramAlert(
                `✅ *Patient Synced Successfully*\n\n` +
                `${patientName} is now available in the scribe system.`
            );
        } else {
            await sendTelegramAlert(
                `⚠️ *Patient Sync Issue*\n\n` +
                `${patientName} may not be immediately available.\n` +
                `Error: ${result.message}\n\n` +
                `_The API fallback will still find them._`
            );
        }
    });

    return NextResponse.json({
        success: true,
        message: 'Patient received, sync triggered',
        patientId,
        patientName,
    });
}

// Health check endpoint
export async function GET(): Promise<Response> {
    return NextResponse.json({
        service: 'healthie-patient-created-webhook',
        status: 'healthy',
        description: 'Syncs new Healthie patients to Snowflake for scribe system',
        timestamp: new Date().toISOString(),
    });
}

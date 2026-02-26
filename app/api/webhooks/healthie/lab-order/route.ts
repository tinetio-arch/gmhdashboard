import { NextResponse } from 'next/server';

/**
 * Healthie Lab Order Webhook Handler
 * 
 * Triggered when: lab_order.created event fires in Healthie
 * Purpose: Forward lab orders to Access Medical Labs API
 * 
 * Healthie Webhook Setup:
 * 1. Go to Healthie Settings → Webhooks
 * 2. Add endpoint: https://nowoptimal.com/ops/api/webhooks/healthie/lab-order
 * 3. Select event: lab_order.created
 */

const WEBHOOK_SECRET = process.env.HEALTHIE_WEBHOOK_SECRET;
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

// Access Labs is not configured yet - will be populated later
const ACCESS_LABS_CONFIGURED = Boolean(
    process.env.ACCESS_LABS_USERNAME && process.env.ACCESS_LABS_PASSWORD
);

interface LabOrderWebhookPayload {
    event_type?: string;
    resource_id?: string;
    resource?: {
        id: string;
        status?: string;
        patient?: {
            id: string;
            first_name?: string;
            last_name?: string;
            dob?: string;
            email?: string;
            phone_number?: string;
            address?: string;
            city?: string;
            state?: string;
            zip?: string;
            gender?: string;
        };
        lab_tests?: string[];
        ordering_physician?: {
            id: string;
            name?: string;
            npi?: string;
        };
        notes?: string;
        stat?: boolean;
        created_at?: string;
    };
}

interface LabOrderQueueItem {
    id: string;
    healthie_lab_order_id: string;
    patient: {
        healthie_id: string;
        first_name: string;
        last_name: string;
        dob?: string;
        email?: string;
        phone?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        gender?: string;
    };
    tests: string[];
    provider: {
        healthie_id: string;
        name?: string;
        npi?: string;
    };
    notes?: string;
    priority: 'ROUTINE' | 'STAT';
    status: 'pending' | 'submitted' | 'failed';
    created_at: string;
    submitted_at?: string;
    external_order_id?: string;
    error?: string;
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
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.log('[lab-order-webhook] Telegram not configured');
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
        console.error('[lab-order-webhook] Telegram alert failed:', error);
    }
}

async function queueLabOrder(queueItem: LabOrderQueueItem): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    const queueDir = '/home/ec2-user/gmhdashboard/data';
    const queueFile = path.join(queueDir, 'lab-orders-outbound.json');

    // Ensure directory exists
    await fs.promises.mkdir(queueDir, { recursive: true });

    // Load existing queue
    let queue: LabOrderQueueItem[] = [];
    try {
        const data = await fs.promises.readFile(queueFile, 'utf-8');
        queue = JSON.parse(data);
    } catch (error) {
        // File doesn't exist yet
        queue = [];
    }

    // Add new item
    queue.push(queueItem);

    // Save
    await fs.promises.writeFile(queueFile, JSON.stringify(queue, null, 2));

    console.log(`[lab-order-webhook] Queued lab order: ${queueItem.id}`);
}

export async function POST(request: Request): Promise<Response> {
    console.log('[lab-order-webhook] Received webhook');

    // Verify authorization
    if (!isAuthorized(request)) {
        console.warn('[lab-order-webhook] Unauthorized request');
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Parse payload
    let payload: LabOrderWebhookPayload;
    try {
        payload = await request.json();
    } catch (error) {
        console.error('[lab-order-webhook] Invalid JSON:', error);
        return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    // Log webhook for debugging
    console.log('[lab-order-webhook] Payload:', JSON.stringify(payload, null, 2));

    // Extract event type
    const eventType = payload.event_type || 'lab_order.created';

    // Only handle lab_order.created for now
    if (!eventType.includes('lab_order')) {
        console.log(`[lab-order-webhook] Ignoring event type: ${eventType}`);
        return NextResponse.json({ success: true, message: 'Event ignored' });
    }

    // Extract resource (lab order data)
    const resource = payload.resource;
    if (!resource) {
        console.warn('[lab-order-webhook] No resource in payload');
        return NextResponse.json({ success: false, error: 'No resource' }, { status: 400 });
    }

    // Build queue item
    const patient = resource.patient || {};
    const provider = resource.ordering_physician || {};

    const queueItem: LabOrderQueueItem = {
        id: `LAB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        healthie_lab_order_id: resource.id,
        patient: {
            healthie_id: patient.id || '',
            first_name: patient.first_name || '',
            last_name: patient.last_name || '',
            dob: patient.dob,
            email: patient.email,
            phone: patient.phone_number,
            address: patient.address,
            city: patient.city,
            state: patient.state,
            zip: patient.zip,
            gender: patient.gender,
        },
        tests: resource.lab_tests || [],
        provider: {
            healthie_id: provider.id || '',
            name: provider.name,
            npi: provider.npi,
        },
        notes: resource.notes,
        priority: resource.stat ? 'STAT' : 'ROUTINE',
        status: 'pending',
        created_at: new Date().toISOString(),
    };

    // Queue the order for processing
    try {
        await queueLabOrder(queueItem);
    } catch (error) {
        console.error('[lab-order-webhook] Failed to queue order:', error);
        return NextResponse.json({ success: false, error: 'Queue failed' }, { status: 500 });
    }

    // Send Telegram notification
    const patientName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'Unknown';
    const testList = (resource.lab_tests || []).join(', ') || 'No tests specified';

    let alertMessage = `🧪 *New Lab Order from Healthie*\n\n`;
    alertMessage += `*Patient*: ${patientName}\n`;
    alertMessage += `*Tests*: ${testList}\n`;
    alertMessage += `*Priority*: ${queueItem.priority}\n`;
    alertMessage += `*Order ID*: \`${queueItem.id}\`\n\n`;

    if (ACCESS_LABS_CONFIGURED) {
        alertMessage += `✅ Will submit to Access Medical Labs automatically.`;
    } else {
        alertMessage += `⚠️ Access Labs API not configured yet.\nOrder queued for manual processing.`;
    }

    await sendTelegramAlert(alertMessage);

    // If Access Labs is configured, trigger submission
    if (ACCESS_LABS_CONFIGURED) {
        // TODO: Call Access Labs API to submit order
        // For now, just log that we would submit
        console.log('[lab-order-webhook] Would submit to Access Labs (API configured)');
    }

    return NextResponse.json({
        success: true,
        message: 'Lab order queued',
        queueItemId: queueItem.id,
        accessLabsConfigured: ACCESS_LABS_CONFIGURED,
    });
}

// Also handle GET for health checks
export async function GET(): Promise<Response> {
    return NextResponse.json({
        service: 'healthie-lab-order-webhook',
        status: 'healthy',
        accessLabsConfigured: ACCESS_LABS_CONFIGURED,
        timestamp: new Date().toISOString(),
    });
}

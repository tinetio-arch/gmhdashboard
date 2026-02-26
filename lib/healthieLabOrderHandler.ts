/**
 * Healthie Lab Order Webhook Handler
 * 
 * Handles lab_order.created and lab_order.updated webhooks from Healthie.
 * Queues orders for submission to Access Medical Labs.
 */

const ORDERS_QUEUE_FILE = '/home/ec2-user/gmhdashboard/data/lab-orders-outbound.json';

// Access Labs configuration status
const ACCESS_LABS_CONFIGURED = Boolean(
    process.env.ACCESS_LABS_USERNAME && process.env.ACCESS_LABS_PASSWORD
);

interface LabOrderWebhookResult {
    handled: boolean;
    orderId?: string;
    status?: string;
    error?: string;
}

interface OutboundLabOrder {
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
        healthie_id?: string;
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

async function loadOrders(): Promise<OutboundLabOrder[]> {
    const fs = await import('fs');
    try {
        const data = await fs.promises.readFile(ORDERS_QUEUE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveOrders(orders: OutboundLabOrder[]): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    await fs.promises.mkdir(path.dirname(ORDERS_QUEUE_FILE), { recursive: true });
    await fs.promises.writeFile(ORDERS_QUEUE_FILE, JSON.stringify(orders, null, 2));
}

async function sendTelegramAlert(message: string): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.log('[lab-order-handler] Telegram not configured');
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
        console.error('[lab-order-handler] Telegram alert failed:', error);
    }
}

function isLabOrderWebhook(payload: any): boolean {
    // Check various ways Healthie might send lab order events
    const eventType = payload?.event_type || payload?.resource_type || payload?.type || '';

    if (typeof eventType === 'string') {
        return eventType.toLowerCase().includes('lab_order') ||
            eventType.toLowerCase().includes('laborder');
    }

    // Check if it has lab order specific fields
    if (payload?.resource?.lab || payload?.lab_order || payload?.labOrder) {
        return true;
    }

    return false;
}

export async function handleHealthieLabOrderWebhook(payload: any): Promise<LabOrderWebhookResult> {
    // Check if this is a lab order webhook
    if (!isLabOrderWebhook(payload)) {
        return { handled: false };
    }

    console.log('[lab-order-handler] Processing lab order webhook');

    // Extract lab order data - handle different payload structures
    const resource = payload?.resource || payload?.lab_order || payload?.labOrder || payload;

    if (!resource?.id && !resource?.lab) {
        console.log('[lab-order-handler] No lab order data in payload');
        return { handled: false };
    }

    // Extract patient info
    const patient = resource?.patient || resource?.user || {};
    const provider = resource?.ordering_provider || resource?.orderer || resource?.ordering_physician || {};

    // Build queue item
    const order: OutboundLabOrder = {
        id: `LAB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        healthie_lab_order_id: String(resource.id || ''),
        patient: {
            healthie_id: String(patient.id || ''),
            first_name: patient.first_name || '',
            last_name: patient.last_name || '',
            dob: patient.dob,
            email: patient.email,
            phone: patient.phone_number || patient.phone,
            address: patient.address,
            city: patient.city,
            state: patient.state,
            zip: patient.zip,
            gender: patient.gender,
        },
        tests: Array.isArray(resource.lab_tests) ? resource.lab_tests :
            (resource.lab ? [resource.lab] : []),
        provider: {
            healthie_id: String(provider.id || ''),
            name: provider.name || provider.full_name,
            npi: provider.npi,
        },
        notes: resource.notes,
        priority: resource.stat ? 'STAT' : 'ROUTINE',
        status: 'pending',
        created_at: new Date().toISOString(),
    };

    // Check for duplicates
    const existingOrders = await loadOrders();
    const isDuplicate = existingOrders.some(
        o => o.healthie_lab_order_id === order.healthie_lab_order_id
    );

    if (isDuplicate) {
        console.log(`[lab-order-handler] Duplicate order ignored: ${order.healthie_lab_order_id}`);
        return {
            handled: true,
            orderId: order.healthie_lab_order_id,
            status: 'duplicate_ignored'
        };
    }

    // Save to queue
    existingOrders.push(order);
    await saveOrders(existingOrders);

    console.log(`[lab-order-handler] Queued order: ${order.id}`);

    // Send Telegram notification
    const patientName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'Unknown';
    const testList = order.tests.join(', ') || 'Tests not specified';

    let alertMessage = `🧪 *New Lab Order from Healthie*\n\n`;
    alertMessage += `*Patient*: ${patientName}\n`;
    alertMessage += `*Tests*: ${testList}\n`;
    alertMessage += `*Priority*: ${order.priority}\n`;
    alertMessage += `*Healthie Order ID*: \`${order.healthie_lab_order_id}\`\n`;
    alertMessage += `*Queue ID*: \`${order.id}\`\n\n`;

    if (ACCESS_LABS_CONFIGURED) {
        alertMessage += `✅ Will submit to Access Medical Labs.`;
    } else {
        alertMessage += `⚠️ Access Labs API not configured yet.\nOrder queued for manual processing.`;
    }

    await sendTelegramAlert(alertMessage);

    return {
        handled: true,
        orderId: order.id,
        status: 'queued',
    };
}

import { NextRequest, NextResponse } from 'next/server';
import { sendChatMessage } from '@/lib/notifications/chat';

export const dynamic = 'force-dynamic';

const BILLING_WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { patientId, patientName, overrideReason, userName } = body;

        if (!patientName || !overrideReason) {
            return NextResponse.json(
                { error: 'Patient name and override reason are required' },
                { status: 400 }
            );
        }

        // Send notification to billing channel
        await sendChatMessage(BILLING_WEBHOOK, {
            text: `⚠️ *Quickbooks Dispense Override*`,
            cardSections: [
                {
                    header: 'Override Details',
                    items: [
                        { key: 'Patient', value: patientName },
                        { key: 'Patient ID', value: patientId || 'N/A' },
                        { key: 'Override Reason', value: overrideReason },
                        { key: 'Dispensed By', value: userName || 'Unknown' },
                        { key: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }) }
                    ]
                },
                {
                    header: 'Action Required',
                    items: [
                        { key: 'Status', value: '🔴 Patient needs to be migrated to Healthie EMR billing' }
                    ]
                }
            ]
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error sending override notification:', error);
        return NextResponse.json(
            { error: 'Failed to send notification' },
            { status: 500 }
        );
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { sendChatMessage } from '@/lib/notifications/chat';
import { getHealthieClient } from '@/lib/healthie';

/**
 * POST /api/jarvis/share
 *
 * Shares a Jarvis conversation (or excerpt) with the patient's care team.
 * Dual delivery: Google Chat notification (immediate) + Healthie chart note (permanent record).
 *
 * Auth: x-jarvis-secret header (Lambda → Dashboard)
 */
export async function POST(request: NextRequest) {
    // Authenticate — only the Lambda should call this
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthieId, patientName, shareType, messages } = body;

        if (!healthieId || !messages || messages.length === 0) {
            return NextResponse.json({ error: 'Missing healthieId or messages' }, { status: 400 });
        }

        // Format the conversation for display
        const conversationText = messages.map((m: { role: string; text: string }) => {
            const label = m.role === 'user' ? 'Patient' : 'JARVIS';
            return `**${label}**: ${m.text}`;
        }).join('\n\n');

        const timestamp = new Date().toLocaleString('en-US', {
            timeZone: 'America/Phoenix',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });

        const shareLabel = shareType === 'full_conversation'
            ? 'Full Conversation'
            : 'Selected Message';

        // 1. Send Google Chat notification (immediate visibility)
        const chatWebhook = process.env.GOOGLE_CHAT_REVIEW_WEBHOOK;
        if (chatWebhook) {
            await sendChatMessage(chatWebhook, {
                text: `📋 *JARVIS — Patient Shared ${shareLabel}*`,
                cardSections: [
                    {
                        header: `${patientName || 'Patient'} (Healthie #${healthieId})`,
                        items: [
                            { key: 'Shared at', value: timestamp },
                            { key: 'Type', value: shareLabel },
                        ],
                    },
                    {
                        header: 'Conversation',
                        items: messages.map((m: { role: string; text: string }) => ({
                            key: m.role === 'user' ? 'Patient' : 'JARVIS',
                            value: m.text.substring(0, 500),
                        })),
                    },
                ],
            });
        }

        // 2. Create Healthie chart note (permanent medical record)
        try {
            const noteBody = [
                `**JARVIS AI — Patient-Shared ${shareLabel}**`,
                `Shared on: ${timestamp}`,
                '',
                '---',
                '',
                conversationText,
                '',
                '---',
                '_This note was created when the patient chose to share their JARVIS conversation with their care team._',
            ].join('\n');

            const healthie = getHealthieClient();
            await healthie.createChartNote({
                client_id: String(healthieId),
                title: `JARVIS: Patient-Shared ${shareLabel} — ${timestamp}`,
                body: noteBody,
            });
        } catch (healthieError) {
            console.error('[Jarvis Share] Healthie chart note failed:', healthieError);
            // Don't fail the whole request — Google Chat notification already sent
        }

        return NextResponse.json({ success: true, message: 'Shared with your care team' });

    } catch (error) {
        console.error('[Jarvis Share] Error:', error);
        return NextResponse.json({ error: 'Failed to share' }, { status: 500 });
    }
}

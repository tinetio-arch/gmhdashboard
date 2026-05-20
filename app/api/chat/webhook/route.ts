import { NextResponse } from 'next/server';

// Google Chat webhook stub endpoint.
// We use Chat for OUTBOUND DMs only (via dispatch-mcp -> chat.googleapis.com).
// Google requires an HTTP endpoint URL be configured in the Chat app settings
// even when we don't process inbound events. This stub returns 200 silently
// for any POST so Google's webhook verification passes.
//
// If we later want to handle inbound (DM replies, mentions, etc.), we'll
// extend this handler. For now it just logs and acks.

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Log the event type for observability (no payload — could contain PHI in user messages)
    const eventType = (body as { type?: string })?.type || 'unknown';
    console.log(`[chat-webhook] received event type=${eventType}`);

    // Acknowledge — Google Chat expects 200 within ~30s
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[chat-webhook] error:', err);
    return NextResponse.json({ ok: true }); // Still return 200 to avoid Google retries
  }
}

export async function GET() {
  // Some verification flows use GET — return 200 with a simple identifier
  return NextResponse.json({ service: 'dispatch-mcp-chat-webhook', status: 'ok' });
}

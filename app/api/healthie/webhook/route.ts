import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { recordHealthieWebhook, type HealthieWebhookPayload } from '@/lib/healthie/webhooks';
import { handleBillingItemCreated } from '@/lib/healthie/peptideWebhook';

const CONTENT_TYPE = 'application/json';

function timingSafeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  // Cast to Uint8Array to satisfy TS typing for ArrayBufferView
  return crypto.timingSafeEqual(new Uint8Array(aBuf), new Uint8Array(bBuf));
}

function buildDataToSign(params: {
  method: string;
  path: string;
  query: string;
  contentDigest: string;
  contentLength: number;
}) {
  const { method, path, query, contentDigest, contentLength } = params;
  return `${method.toLowerCase()} ${path} ${query} ${contentDigest} ${CONTENT_TYPE} ${contentLength}`;
}

function extractSignature(rawHeader: string | null) {
  if (!rawHeader) return null;
  const parts = rawHeader.split('=');
  return parts.length === 2 ? parts[1].trim() : null;
}

function sign(data: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export async function POST(req: Request) {
  const secret = process.env.HEALTHIE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'HEALTHIE_WEBHOOK_SECRET not set' }, { status: 500 });
  }

  // Read body once so we can validate signature and parse JSON safely.
  const bodyText = await req.text();
  const contentLength = Buffer.byteLength(bodyText, 'utf8');

  const url = new URL(req.url);
  const contentDigestHeader = req.headers.get('content-digest');
  const signatureInputHeader = req.headers.get('signature-input');
  const signatureHeader = req.headers.get('signature');

  // Extract digest value - handle base64 padding which contains '=' characters
  // Format is "sha-256=<base64hash>" - we need everything after "sha-256="
  const digestParts = contentDigestHeader?.split('=') ?? [];
  const contentDigest = digestParts.slice(1).join('='); // Rejoin in case base64 has '=' padding
  const signature = extractSignature(signatureHeader);

  if (!contentDigestHeader || !signatureInputHeader || !signature) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
  }

  // Healthie computes signature with the external URL path (including /ops prefix)
  // but Next.js strips the basePath internally, so we need to add it back
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/ops';
  const externalPath = basePath + url.pathname;

  const dataToSign = buildDataToSign({
    method: req.method,
    path: externalPath,
    query: url.search.replace(/^\?/, ''),
    contentDigest,
    contentLength,
  });

  const computed = sign(dataToSign, secret);

  if (!timingSafeEqual(computed, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: HealthieWebhookPayload;
  try {
    body = JSON.parse(bodyText);
  } catch (err) {
    console.error('Webhook JSON parse error', err);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = body?.event_type || 'unknown';
  const changedFields = Array.isArray(body?.changed_fields) ? body.changed_fields : undefined;

  // Persist for idempotent processing; ignore duplicates gracefully.
  try {
    await recordHealthieWebhook({
      bodyText,
      payload: body,
      signature,
      contentDigest,
      contentLength,
    });
  } catch (err) {
    console.error('Healthie webhook persistence error', err);
    // Do not fail delivery; acknowledge to avoid retries while we investigate.
  }

  console.log('Healthie webhook received', {
    eventType,
    resource_id: body.resource_id,
    resource_id_type: body.resource_id_type,
    changed_fields: changedFields,
  });

  // Handle billing_item.created for peptide purchases
  if (eventType.toLowerCase() === 'billing_item.created' || eventType.toLowerCase() === 'billingitem.created') {
    try {
      const result = await handleBillingItemCreated(body.resource_id);
      console.log('Peptide webhook result:', result);
      return NextResponse.json({
        received: true,
        eventType,
        peptide: result,
      });
    } catch (err) {
      console.error('Peptide webhook handler error:', err);
      // Don't fail the webhook, just log and continue
    }
  }

  return NextResponse.json({ received: true, eventType, changed_fields: changedFields });
}


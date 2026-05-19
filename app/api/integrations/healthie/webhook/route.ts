import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { handleHealthiePaymentWebhook } from '@/lib/healthiePaymentAutomation';
import { handleHealthieLabOrderWebhook } from '@/lib/healthieLabOrderHandler';

const WEBHOOK_SECRET = process.env.HEALTHIE_WEBHOOK_SECRET;
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

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

  if (HEALTHIE_API_KEY && provided.startsWith('Basic ')) {
    const encoded = provided.slice('Basic '.length).trim();
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const [username] = decoded.split(':');
        if (username === HEALTHIE_API_KEY) {
          return true;
        }
      } catch (error) {
        console.warn('[healthie-webhook] Failed to decode basic auth header', error);
      }
    }
  }

  if (HEALTHIE_API_KEY && provided === `Basic ${HEALTHIE_API_KEY}`) {
    return true;
  }

  return false;
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function sanitizePhone(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits || null;
}

function extractClient(payload: any): any {
  return payload?.client ?? payload?.data?.client ?? payload?.user ?? payload?.payload?.client ?? null;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const labOrderResult = await handleHealthieLabOrderWebhook(body);
    if (labOrderResult.handled) {
      return NextResponse.json({
        success: true,
        type: 'lab_order',
        orderId: labOrderResult.orderId,
        status: labOrderResult.status,
      });
    }
  } catch (error) {
    console.error('[healthie-webhook] lab order handling failed', error);
  }

  try {
    const paymentResult = await handleHealthiePaymentWebhook(body);
    if (paymentResult.handled) {
      return NextResponse.json({
        success: true,
        patientId: paymentResult.patientId,
        invoiceId: paymentResult.invoiceId,
        status: paymentResult.status,
      });
    }
  } catch (error) {
    console.error('[healthie-webhook] payment handling failed', error);
  }

  const client = extractClient(body);
  if (!client) {
    return NextResponse.json({ success: false, error: 'No client payload' }, { status: 200 });
  }

  const healthieClientId = client.id ?? client.user_id;
  if (!healthieClientId) {
    return NextResponse.json({ success: false, error: 'Client id missing' }, { status: 200 });
  }

  const matches = await query<{ patient_id: string }>(
    `
      SELECT patient_id
      FROM healthie_clients
      WHERE healthie_client_id = $1
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `,
    [healthieClientId]
  );
  const patientId = matches[0]?.patient_id;
  if (!patientId) {
    return NextResponse.json({
      success: true,
      message: 'Client not linked to local patient',
    });
  }

  const location = client.location ?? client.primary_location ?? {};
  const line1 = location.line1 ?? client.address_line1 ?? null;
  const city = location.city ?? client.city ?? null;
  const state = location.state ?? client.state ?? null;
  const zip = location.zip ?? client.zip ?? null;

  const incoming = {
    dob: normalizeDate(client.dob ?? client.date_of_birth ?? null),
    phone_primary: sanitizePhone(client.phone_number ?? client.phone ?? null),
    address_line1: line1,
    city,
    state,
    postal_code: zip,
    email: client.email ?? null,
  };

  // PHASE 3 INSTRUMENTATION (2026-05-19): log every divergence between the
  // incoming Healthie payload and the current local patients row to
  // agent_action_log (agent_name='healthie_webhook', action_type='patient_divergence').
  // This is ADDITIVE — the COALESCE UPDATE below still runs and still wins —
  // but the log lets us quantify how often Healthie disagrees with our local
  // state. A future iteration will flip this to log-only once we know volume
  // and which fields drift most often (the eventual SoT-enforcement step).
  try {
    const [current] = await query<{
      dob: any;
      phone_primary: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      email: string | null;
    }>(
      `SELECT dob, phone_primary, address_line1, city, state, postal_code, email
         FROM patients WHERE patient_id = $1`,
      [patientId]
    );
    if (current) {
      const divergences: Record<string, { local: any; healthie: any }> = {};
      for (const k of Object.keys(incoming) as Array<keyof typeof incoming>) {
        const inc = incoming[k as keyof typeof incoming];
        if (inc === null || inc === undefined) continue; // Healthie didn't send this field
        const cur = (current as any)[k];
        // Normalize for comparison: dob comes back as a Date object from pg.
        let curStr: string;
        if (cur instanceof Date) {
          curStr = cur.toISOString().slice(0, 10);
        } else {
          curStr = cur == null ? '' : String(cur);
        }
        const incStr = String(inc);
        if (incStr !== curStr) {
          divergences[k] = { local: cur ?? null, healthie: inc };
        }
      }
      if (Object.keys(divergences).length > 0) {
        await query(
          `INSERT INTO agent_action_log
             (agent_name, action_type, category, summary, details, status)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            'healthie_webhook',
            'patient_divergence',
            'sync',
            `Healthie webhook diverged from local patients row on: ${Object.keys(divergences).join(', ')}`,
            JSON.stringify({
              patient_id: patientId,
              healthie_client_id: healthieClientId,
              divergences,
            }),
            'completed',
          ]
        );
      }
    }
  } catch (divergenceErr) {
    // Instrumentation must never break the webhook — swallow and continue.
    console.warn('[healthie-webhook] divergence logging failed (non-fatal):', divergenceErr);
  }

  await query(
    `
      UPDATE patients
         SET dob = COALESCE($2, dob),
             phone_primary = COALESCE($3, phone_primary),
             address_line1 = COALESCE($4, address_line1),
             city = COALESCE($5, city),
             state = COALESCE($6, state),
             postal_code = COALESCE($7, postal_code),
             email = COALESCE($8, email),
             updated_at = NOW()
       WHERE patient_id = $1
    `,
    [
      patientId,
      incoming.dob,
      incoming.phone_primary,
      incoming.address_line1,
      incoming.city,
      incoming.state,
      incoming.postal_code,
      incoming.email,
    ]
  );

  return NextResponse.json({
    success: true,
    patientId,
  });
}


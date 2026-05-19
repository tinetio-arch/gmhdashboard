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

  // PHASE 3 (2026-05-19): SoT ENFORCEMENT. /ops + /ipad + /mobile are the
  // source of truth for patient demographics; Healthie is a downstream
  // consumer. The inbound webhook NO LONGER overwrites a populated /ops field
  // (the old COALESCE clobbered /ops whenever Healthie sent any value).
  // Per incoming field:
  //   - /ops field IS NULL/empty  → BACKFILL it (one-time, no conflict).
  //   - /ops == Healthie          → no-op.
  //   - /ops != Healthie          → record a sync_conflicts row; LEAVE /ops as-is.
  // This replaces the prior additive agent_action_log 'patient_divergence'
  // breadcrumb (removed) — sync_conflicts is now the structured truth.
  let backfilledCount = 0;
  let conflictCount = 0;
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
      // Field names below are a FIXED, code-controlled set (the keys of the
      // `incoming` object) — never patient/payload-derived — so interpolating
      // them into the UPDATE column list is the sanctioned dynamic-UPDATE
      // pattern, not SQL injection.
      const backfill: Record<string, string> = {};
      const conflicts: Array<{ field: string; opsValue: string; externalValue: string }> = [];

      for (const k of Object.keys(incoming) as Array<keyof typeof incoming>) {
        const inc = incoming[k];
        if (inc === null || inc === undefined) continue; // Healthie didn't send this field
        const cur = (current as any)[k];
        // dob comes back as a Date object from pg; normalize for comparison.
        const curStr = cur instanceof Date ? cur.toISOString().slice(0, 10) : cur == null ? '' : String(cur);
        const incStr = String(inc);

        if (curStr === '') {
          backfill[k as string] = inc as string; // /ops empty → backfill
        } else if (incStr === curStr) {
          // equal → no-op
        } else {
          conflicts.push({ field: k as string, opsValue: curStr, externalValue: incStr });
        }
      }

      // Record conflicts — /ops wins, Healthie value is rejected and logged.
      for (const c of conflicts) {
        await query(
          `INSERT INTO sync_conflicts
             (patient_id, source_system, field_name, ops_value, external_value)
           VALUES ($1, 'healthie', $2, $3, $4)`,
          [patientId, c.field, c.opsValue, c.externalValue]
        );
      }
      conflictCount = conflicts.length;

      // Backfill only the fields /ops did not already have.
      const fields = Object.keys(backfill);
      if (fields.length > 0) {
        const setClauses: string[] = [];
        const values: any[] = [patientId];
        let idx = 2;
        for (const f of fields) {
          setClauses.push(`${f} = $${idx++}`);
          values.push(backfill[f]);
        }
        setClauses.push('updated_at = NOW()');
        await query(
          `UPDATE patients SET ${setClauses.join(', ')} WHERE patient_id = $1`,
          values
        );
        backfilledCount = fields.length;
      }
    }
  } catch (sotErr) {
    // SoT reconciliation must never 500 the webhook — log and continue.
    console.error('[healthie-webhook] sync-conflict reconciliation failed (non-fatal):', sotErr);
  }

  return NextResponse.json({
    success: true,
    patientId,
    backfilled: backfilledCount,
    conflicts: conflictCount,
  });
}


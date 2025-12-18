import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const WEBHOOK_SECRET = process.env.HEALTHIE_WEBHOOK_SECRET;

function isAuthorized(request: Request): boolean {
  if (!WEBHOOK_SECRET) {
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
      normalizeDate(client.dob ?? client.date_of_birth ?? null),
      sanitizePhone(client.phone_number ?? client.phone ?? null),
      line1 ?? null,
      city ?? null,
      state ?? null,
      zip ?? null,
      client.email ?? null,
    ]
  );

  return NextResponse.json({
    success: true,
    patientId,
  });
}


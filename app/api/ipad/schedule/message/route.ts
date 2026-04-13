/**
 * iPad — Send a message to a patient from the schedule tile.
 *
 * POST /api/ipad/schedule/message/
 * Body: { patient_id: string (UUID or Healthie ID), body: string, dry_run?: boolean }
 *
 * GET  /api/ipad/schedule/message/?patient_id=... — returns available channels
 *                                                    (used by the UI to show the
 *                                                    auto-picked channel label).
 *
 * Channel resolution (server-side, never trusted from client):
 *   1. Look up patient in gmhdashboard DB
 *   2. Use lib/ghl.getGHLClientForPatient(clinic, client_type_key) to pick the
 *      right GHL sub-account (Men's Health / Primary Care / ABXTAC)
 *   3. Find the patient's GHL contact by email → SMS via that contact
 *   4. If no GHL contact, report unavailable (future: fall back to Healthie chat)
 *
 * Side effects & safety:
 *   - Every send is logged with staff email, patient, channel, truncated body
 *   - Body capped at 1600 chars (carrier SMS safe limit)
 *   - dry_run=true returns channel info without actually sending
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { getGHLClientForPatient } from '@/lib/ghl';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const SMS_MAX_LEN = 1600;

interface ChannelInfo {
    channel: 'sms_mens_health' | 'sms_primary_care' | 'sms_abxtac' | 'unavailable';
    label: string;
    brand: string;
    phone?: string | null;
    reason?: string;   // when unavailable
}

async function resolveChannel(patientId: string): Promise<{
    info: ChannelInfo;
    patient: any;
    ghlContactId?: string;
}> {
    // Look up patient
    const [patient] = await query<any>(
        `SELECT p.patient_id, p.full_name, p.email, p.phone_primary,
                p.client_type_key, p.clinic_key
         FROM patients p WHERE p.patient_id = $1`,
        [patientId]
    );

    if (!patient) {
        return {
            info: { channel: 'unavailable', label: 'No patient record', brand: '', reason: 'Patient not found in local DB' },
            patient: null,
        };
    }

    if (!patient.email) {
        return {
            info: { channel: 'unavailable', label: 'No contact email', brand: '', reason: 'Patient has no email on file — cannot look up GHL contact' },
            patient,
        };
    }

    const ghl = getGHLClientForPatient(patient.clinic_key, patient.client_type_key);
    if (!ghl) {
        return {
            info: { channel: 'unavailable', label: 'No GHL routing', brand: '', reason: 'Could not determine GHL sub-account' },
            patient,
        };
    }

    // Find GHL contact by email
    let contactId: string | undefined;
    try {
        const contact = await ghl.findContactByEmail(patient.email);
        if (contact?.id) contactId = contact.id;
    } catch (err: any) {
        console.warn('[ipad-message] GHL contact lookup failed:', err.message);
    }

    if (!contactId) {
        return {
            info: { channel: 'unavailable', label: 'No GHL contact', brand: '', reason: 'Patient has no GHL contact in the routed sub-account' },
            patient,
        };
    }

    // Determine brand label
    const clientType = (patient.client_type_key || '').toLowerCase();
    let channel: ChannelInfo['channel'];
    let brand: string;
    if (clientType === 'abxtac') {
        channel = 'sms_abxtac';
        brand = 'ABXTAC';
    } else if (
        clientType === 'nowprimarycare' ||
        clientType === 'nowlongevity' ||
        clientType === 'nowmentalhealth' ||
        (patient.clinic_key || '').toLowerCase().includes('primarycare')
    ) {
        channel = 'sms_primary_care';
        brand = 'Primary Care';
    } else {
        channel = 'sms_mens_health';
        brand = "Men's Health";
    }

    return {
        info: {
            channel,
            label: `SMS via ${brand}`,
            brand,
            phone: patient.phone_primary || null,
        },
        patient,
        ghlContactId: contactId,
    };
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const { searchParams } = new URL(request.url);
        const raw = searchParams.get('patient_id');
        if (!raw) return NextResponse.json({ error: 'patient_id required' }, { status: 400 });

        const resolved = await resolvePatientId(raw);
        if (!resolved) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

        const { info, patient } = await resolveChannel(resolved);
        return NextResponse.json({
            success: true,
            patient: patient ? { full_name: patient.full_name, email: patient.email } : null,
            channel: info,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[ipad-message] GET error:', error);
        return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = (await request.json()) as {
            patient_id: string;
            body: string;
            dry_run?: boolean;
        };

        if (!body.patient_id || typeof body.body !== 'string' || !body.body.trim()) {
            return NextResponse.json({ error: 'patient_id and non-empty body required' }, { status: 400 });
        }

        const messageBody = body.body.trim().slice(0, SMS_MAX_LEN);

        const resolved = await resolvePatientId(body.patient_id);
        if (!resolved) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

        const { info, patient, ghlContactId } = await resolveChannel(resolved);

        if (info.channel === 'unavailable' || !ghlContactId) {
            return NextResponse.json({
                success: false,
                channel: info,
                error: info.reason || 'No messaging channel available',
            }, { status: 400 });
        }

        const actor = (user as any).email || 'staff';

        if (body.dry_run) {
            return NextResponse.json({
                success: true,
                dry_run: true,
                channel: info,
                patient: { full_name: patient.full_name, email: patient.email },
                body_preview: messageBody,
            });
        }

        // Send
        const ghl = getGHLClientForPatient(patient.clinic_key, patient.client_type_key);
        if (!ghl) {
            return NextResponse.json({ error: 'GHL client unavailable' }, { status: 500 });
        }

        const result = await ghl.sendSms(ghlContactId, messageBody);

        console.log(
            `[ipad-message] SMS sent by ${actor} → ${patient.full_name} (${info.brand}, contact=${ghlContactId}) msg_id=${result.id} body="${messageBody.slice(0, 80)}${messageBody.length > 80 ? '...' : ''}"`
        );

        return NextResponse.json({
            success: true,
            channel: info,
            message_id: result.id,
            sent_to: patient.full_name,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[ipad-message] POST error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to send' }, { status: 500 });
    }
}

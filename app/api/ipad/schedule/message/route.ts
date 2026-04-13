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
import {
    getGHLClientForPatient,
    createGHLClientForMensHealth,
    createGHLClientForPrimaryCare,
    createGHLClientForABXTAC,
    createGHLClientForLongevity,
} from '@/lib/ghl';
import { resolvePatientId } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const SMS_MAX_LEN = 1600;

type SubAccount = 'mens_health' | 'primary_care' | 'abxtac' | 'longevity';

interface ChannelInfo {
    channel: SubAccount | 'unavailable';
    label: string;
    brand: string;
    phone?: string | null;
    reason?: string;
    tried?: string[];           // which sub-accounts we probed (for transparency)
}

const SUB_ACCOUNT_LABEL: Record<SubAccount, string> = {
    mens_health: "Men's Health",
    primary_care: 'Primary Care',
    longevity: 'Longevity',
    abxtac: 'ABXTAC',
};

function factoryFor(sub: SubAccount) {
    switch (sub) {
        case 'mens_health': return createGHLClientForMensHealth;
        case 'primary_care': return createGHLClientForPrimaryCare;
        case 'longevity': return createGHLClientForLongevity;
        case 'abxtac': return createGHLClientForABXTAC;
    }
}

/**
 * Rank sub-accounts by likelihood, using (in priority order):
 *   1. Appointment type hints ("Men's", "HRT", "TRT", "MHM" → mens_health;
 *      "Primary Care" → primary_care; "Longevity" → longevity;
 *      "Mental" → primary_care; "EvexiPel" → primary_care)
 *   2. Patient's client_type_key (strongest single signal)
 *   3. Patient's clinic field
 * Returns an ordered list of all 4 sub-accounts so we probe every one
 * if needed — guarantees we find the patient if they exist anywhere.
 */
function rankSubAccounts(
    appointmentType: string | null | undefined,
    clientType: string | null | undefined,
    clinic: string | null | undefined,
): SubAccount[] {
    const atype = (appointmentType || '').toLowerCase();
    const ctype = (clientType || '').toLowerCase();
    const clin = (clinic || '').toLowerCase();
    const order: SubAccount[] = [];
    const push = (s: SubAccount) => { if (!order.includes(s)) order.push(s); };

    // ─── Appointment type hints (strongest — reflects current intent) ───
    if (/\b(hrt|trt|mhm|men['’]?s|male hrt|testosterone|evexipel.*male)\b/i.test(atype)) push('mens_health');
    if (/\b(primary\s*care|primary_care|evexipel|female)\b/i.test(atype)) push('primary_care');
    if (/\b(longevity|peptide|iv\s*therapy)\b/i.test(atype)) push('longevity');
    if (/\b(abxtac|research peptide)\b/i.test(atype)) push('abxtac');
    if (/\b(mental|psych|therapy|counsel)\b/i.test(atype)) push('primary_care');

    // ─── Patient group (client_type_key) ───
    if (ctype === 'nowmenshealth') push('mens_health');
    if (ctype === 'nowprimarycare') push('primary_care');
    if (ctype === 'nowlongevity') push('longevity');
    if (ctype === 'nowmentalhealth') push('primary_care');
    if (ctype === 'abxtac') push('abxtac');

    // ─── Clinic field ───
    if (clin.includes('menshealth')) push('mens_health');
    if (clin.includes('primarycare') || clin.includes('primary_care')) push('primary_care');
    if (clin.includes('longevity')) push('longevity');

    // ─── Default tail — probe all remaining so we never miss a contact ───
    push('mens_health');
    push('primary_care');
    push('longevity');
    push('abxtac');

    return order;
}

async function resolveChannel(
    patientId: string,
    appointmentTypeHint?: string | null,
): Promise<{
    info: ChannelInfo;
    patient: any;
    ghlContactId?: string;
    sub?: SubAccount;
}> {
    const [patient] = await query<any>(
        `SELECT p.patient_id, p.full_name, p.email, p.phone_primary,
                p.client_type_key, p.clinic
         FROM patients p WHERE p.patient_id = $1`,
        [patientId]
    );

    if (!patient) {
        return { info: { channel: 'unavailable', label: 'No patient record', brand: '', reason: 'Patient not found in local DB' }, patient: null };
    }

    if (!patient.email) {
        return { info: { channel: 'unavailable', label: 'No contact email', brand: '', reason: 'Patient has no email on file — cannot look up GHL contact' }, patient };
    }

    const ordered = rankSubAccounts(appointmentTypeHint, patient.client_type_key, patient.clinic);
    const tried: string[] = [];

    for (const sub of ordered) {
        const factory = factoryFor(sub);
        const ghl = factory();
        if (!ghl) continue;    // sub-account not configured (no token in env)
        tried.push(sub);
        try {
            const contact = await ghl.findContactByEmail(patient.email);
            if (contact?.id) {
                return {
                    info: {
                        channel: sub,
                        label: `SMS via ${SUB_ACCOUNT_LABEL[sub]}`,
                        brand: SUB_ACCOUNT_LABEL[sub],
                        phone: patient.phone_primary || null,
                        tried,
                    },
                    patient,
                    ghlContactId: contact.id,
                    sub,
                };
            }
        } catch (err: any) {
            console.warn(`[ipad-message] Contact lookup in ${sub} failed:`, err.message);
        }
    }

    return {
        info: {
            channel: 'unavailable',
            label: 'No GHL contact',
            brand: '',
            reason: `Patient email ${patient.email} not found in any configured GHL sub-account (tried: ${tried.join(', ') || 'none'})`,
            tried,
        },
        patient,
    };
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const { searchParams } = new URL(request.url);
        const raw = searchParams.get('patient_id');
        const apptType = searchParams.get('appointment_type');
        if (!raw) return NextResponse.json({ error: 'patient_id required' }, { status: 400 });

        const resolved = await resolvePatientId(raw);
        if (!resolved) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

        const { info, patient } = await resolveChannel(resolved, apptType);
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
            appointment_type?: string;
            dry_run?: boolean;
        };

        if (!body.patient_id || typeof body.body !== 'string' || !body.body.trim()) {
            return NextResponse.json({ error: 'patient_id and non-empty body required' }, { status: 400 });
        }

        const messageBody = body.body.trim().slice(0, SMS_MAX_LEN);

        const resolved = await resolvePatientId(body.patient_id);
        if (!resolved) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

        const { info, patient, ghlContactId, sub } = await resolveChannel(resolved, body.appointment_type);

        if (info.channel === 'unavailable' || !ghlContactId || !sub) {
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

        // Use the sub-account we actually located the contact in.
        const ghl = factoryFor(sub)();
        if (!ghl) {
            return NextResponse.json({ error: 'GHL client for ' + sub + ' unavailable' }, { status: 500 });
        }

        const result = await ghl.sendSms(ghlContactId, messageBody);

        console.log(
            `[ipad-message] SMS sent by ${actor} → ${patient.full_name} via ${info.brand} (contact=${ghlContactId}) msg_id=${result.id} body="${messageBody.slice(0, 80)}${messageBody.length > 80 ? '...' : ''}"`
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

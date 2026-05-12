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

    // FIX(2026-04-16): client_type_key is now the AUTHORITATIVE signal — patient type
    // determines routing, not whichever GHL sub-account happens to have a historical
    // duplicate of the contact. Previously everybody was silently falling back to
    // Men's Health because GHL has legacy dupes of many patients there.

    // ─── 1. Patient group (client_type_key) — authoritative ───
    if (ctype === 'nowmenshealth') push('mens_health');
    else if (ctype === 'nowprimarycare') push('primary_care');
    else if (ctype === 'nowlongevity') push('longevity');
    else if (ctype === 'nowmentalhealth') push('primary_care');
    else if (ctype === 'abxtac') push('abxtac');

    // ─── 2. Clinic field — second-strongest signal ───
    if (clin.includes('menshealth')) push('mens_health');
    if (clin.includes('primarycare') || clin.includes('primary_care')) push('primary_care');
    if (clin.includes('longevity')) push('longevity');

    // ─── 3. Appointment-type hints (weakest — only used if client_type_key/clinic missing) ───
    // FIX(2026-04-16): the prior `evexipel.*male` pattern false-positived on
    // "EvexiPel ... FEmale" because .*male\b matches the end of "female".
    // Require explicit male/men word boundaries and explicitly exclude "female".
    if (/\bfemale\b/i.test(atype)) push('primary_care');
    else if (/\b(hrt|trt|mhm|men['’]?s|male hrt|testosterone)\b/i.test(atype)
             || /evexipel\s+[a-z ]*\bmale\b/i.test(atype)) push('mens_health');
    if (/\b(primary\s*care|primary_care)\b/i.test(atype)) push('primary_care');
    if (/\bevexipel\b/i.test(atype) && !/\bmale\b/i.test(atype)) push('primary_care');
    if (/\b(longevity|peptide|iv\s*therapy)\b/i.test(atype)) push('longevity');
    if (/\b(abxtac|research peptide)\b/i.test(atype)) push('abxtac');
    if (/\b(mental|psych|therapy|counsel)\b/i.test(atype)) push('primary_care');

    // ─── 4. Default tail — probe remaining accounts only so we can still locate
    // the patient IF they have no client_type_key/clinic AND no appointment hint.
    // Order chosen so Men's Health is NOT first by default any more.
    push('primary_care');
    push('mens_health');
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
                p.client_type_key, p.clinic, p.messaging_account_override
         FROM patients p WHERE p.patient_id = $1`,
        [patientId]
    );

    if (!patient) {
        return { info: { channel: 'unavailable', label: 'No patient record', brand: '', reason: 'Patient not found in local DB' }, patient: null };
    }

    // Healthie often stores placeholder emails like `<hash>@gethealthie.com` when the
    // patient record was created without an email. GHL has the REAL email / phone,
    // so we must fall back to phone lookup when the email is a placeholder.
    const isPlaceholderEmail = /@gethealthie\.com$/i.test(patient.email || '');
    const canEmailLookup = !!patient.email && !isPlaceholderEmail;
    const canPhoneLookup = !!patient.phone_primary;

    if (!canEmailLookup && !canPhoneLookup) {
        return { info: { channel: 'unavailable', label: 'No contact info', brand: '', reason: 'Patient has no usable email or phone on file' }, patient };
    }

    // FIX(2026-04-16): respect per-patient override — Linda Hargrave case where
    // `clinic` says nowmenshealth.care but she's actually a Longevity patient.
    // Override takes absolute precedence and short-circuits the probe loop.
    const override: SubAccount | null = (
        patient.messaging_account_override === 'mens_health' ||
        patient.messaging_account_override === 'primary_care' ||
        patient.messaging_account_override === 'longevity' ||
        patient.messaging_account_override === 'abxtac'
    ) ? patient.messaging_account_override : null;

    const ordered: SubAccount[] = override
        ? [override]
        : rankSubAccounts(appointmentTypeHint, patient.client_type_key, patient.clinic);
    const tried: string[] = [];

    for (const sub of ordered) {
        const factory = factoryFor(sub);
        const ghl = factory();
        if (!ghl) continue;    // sub-account not configured (no token in env)
        tried.push(sub);
        try {
            let contact = null;
            if (canEmailLookup) {
                contact = await ghl.findContactByEmail(patient.email);
            }
            if (!contact && canPhoneLookup) {
                contact = await ghl.findContactByPhone(patient.phone_primary);
            }
            if (contact?.id) {
                return {
                    info: {
                        channel: sub,
                        label: `SMS via ${SUB_ACCOUNT_LABEL[sub]}`,
                        brand: SUB_ACCOUNT_LABEL[sub],
                        phone: patient.phone_primary || null,
                        tried,
                        override_active: !!override,
                    } as any,
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

// One-off channel resolution that probes ONE specific sub-account only. Used when
// staff picks an account in the dropdown without checking "Remember".
async function resolveChannelForcedAccount(
    patientId: string,
    sub: SubAccount,
): Promise<{ info: ChannelInfo; patient: any; ghlContactId?: string; sub?: SubAccount }> {
    const [patient] = await query<any>(
        `SELECT p.patient_id, p.full_name, p.email, p.phone_primary
         FROM patients p WHERE p.patient_id = $1`,
        [patientId]
    );
    if (!patient) return { info: { channel: 'unavailable', label: 'No patient', brand: '', reason: 'Patient not found' }, patient: null };
    const ghl = factoryFor(sub)();
    if (!ghl) return { info: { channel: 'unavailable', label: 'Account unavailable', brand: '', reason: `Sub-account ${sub} not configured` }, patient };
    const isPlaceholderEmail = /@gethealthie\.com$/i.test(patient.email || '');
    const canEmailLookup = !!patient.email && !isPlaceholderEmail;
    try {
        let contact = null;
        if (canEmailLookup) contact = await ghl.findContactByEmail(patient.email);
        if (!contact && patient.phone_primary) contact = await ghl.findContactByPhone(patient.phone_primary);
        if (contact?.id) {
            return {
                info: { channel: sub, label: `SMS via ${SUB_ACCOUNT_LABEL[sub]}`, brand: SUB_ACCOUNT_LABEL[sub], phone: patient.phone_primary || null, tried: [sub] },
                patient, ghlContactId: contact.id, sub,
            };
        }
    } catch (err: any) {
        console.warn(`[ipad-message] Forced lookup in ${sub} failed:`, err.message);
    }
    return {
        info: { channel: 'unavailable', label: 'No contact in ' + SUB_ACCOUNT_LABEL[sub], brand: SUB_ACCOUNT_LABEL[sub], reason: `No contact in ${SUB_ACCOUNT_LABEL[sub]} for ${patient.email || patient.phone_primary}`, tried: [sub] },
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
            patient: patient ? {
                full_name: patient.full_name,
                email: patient.email,
                messaging_account_override: patient.messaging_account_override || null,
                client_type_key: patient.client_type_key || null,
                clinic: patient.clinic || null,
            } : null,
            channel: info,
            // All sub-account options staff can pick from in the override dropdown.
            available_accounts: [
                { key: 'mens_health', label: "Men's Health" },
                { key: 'primary_care', label: 'Primary Care' },
                { key: 'longevity', label: 'Longevity' },
                { key: 'abxtac', label: 'ABX TAC' },
            ],
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
            save_account_override?: string | null; // 'mens_health' | 'primary_care' | 'longevity' | 'abxtac' | null
            use_account_for_send?: string;         // one-shot: force this send to route through account X without saving
        };

        if (!body.patient_id || typeof body.body !== 'string' || !body.body.trim()) {
            return NextResponse.json({ error: 'patient_id and non-empty body required' }, { status: 400 });
        }

        // Optional: save an override BEFORE resolving the channel, so the resolution
        // immediately uses the new value. Passing null clears the override.
        if (body.save_account_override !== undefined) {
            const override = body.save_account_override;
            const valid = override === null ||
                override === 'mens_health' || override === 'primary_care' ||
                override === 'longevity' || override === 'abxtac';
            if (!valid) {
                return NextResponse.json({ error: 'Invalid save_account_override' }, { status: 400 });
            }
            const resolvedForSave = await resolvePatientId(body.patient_id);
            if (resolvedForSave) {
                await query(
                    `UPDATE patients SET messaging_account_override = $1, updated_at = NOW() WHERE patient_id = $2::uuid`,
                    [override, resolvedForSave]
                );
                console.log(`[ipad-message] Saved messaging override for patient ${resolvedForSave}: ${override || 'CLEARED'}`);
            }
        }

        const messageBody = body.body.trim().slice(0, SMS_MAX_LEN);

        const resolved = await resolvePatientId(body.patient_id);
        if (!resolved) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

        // One-shot send override: if staff picked an account in the dropdown without saving,
        // still route THIS send through it by temporarily setting the override for this call.
        let channelResult = await resolveChannel(resolved, body.appointment_type);
        if (body.use_account_for_send && !body.save_account_override) {
            const validKeys = ['mens_health', 'primary_care', 'longevity', 'abxtac'];
            if (validKeys.includes(body.use_account_for_send)) {
                const forced = await resolveChannelForcedAccount(resolved, body.use_account_for_send as SubAccount);
                if (forced.ghlContactId) channelResult = forced;
            }
        }
        const { info, patient, ghlContactId, sub } = channelResult;

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

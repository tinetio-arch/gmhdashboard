/**
 * App-Version Nudge Cron — Phase 3 of
 * `untangling-healthie-communications-from-healthie`
 * (dispatch row `20260526-192910-191f`).
 *
 * Goal: when a patient has an upcoming telehealth/video appointment but their
 * native app is missing or outdated, push (and therefore the sibling Phase-3
 * "join your video" link from claude-task-2907f4ba) won't reach them. We
 * nudge them on a non-push channel BEFORE the appointment so they can update
 * or install the app in time.
 *
 *   Window:  appointment starts in [36h, 48h]  — gives the patient at least a
 *            day to install/update before the visit, well before the 24h
 *            appointment-reminder cron and the ~1h "join your video" push.
 *   Channel: prefers SMS (push is the failure we're working around; the
 *            gateway would normally try push first). Email falls in as the
 *            second priority via the gateway's normal fallback chain.
 *   Cadence: cron fires every 30 min. The 12h-wide window is plenty wider
 *            than the cadence; the gateway's idempotency_key
 *            (`app-version-nudge:<appt_id>`) makes accidental double-tick a
 *            no-op.
 *
 * Phil's hard rule (project doc): the entire new comms stack stays gated
 * off real patients until he signs off on testing. This route ships in
 * SHADOW (dry-run) mode by default. Set `APP_VERSION_NUDGE_DRY_RUN=0` in
 * `.env.local` to enable real sends through `notifyPatient()`. Shadow mode
 * logs every would-have-sent candidate (full payload + chosen channel) in
 * the response — no ledger writes, no patient contact.
 *
 * `APP_VERSION_NUDGE_ENABLED=0` kills the cron entirely (returns
 * `{ success: true, disabled: true }`).
 *
 * NOT wired into crontab yet. Phil flips the env flags AND adds the crontab
 * entry after reviewing dry-run output.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { notifyPatient, type GatewayChannel, type NotifyResult } from '@/lib/comms-gateway';
import { type AccountKey } from '@/lib/comms-ledger';
import {
    evaluateAppVersion,
    type AppVersionEvaluation,
    type AppVersionStatus,
    MIN_SUPPORTED_APP_VERSION,
    LATEST_APP_VERSION,
} from '@/lib/app-version-gate';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEADLINE_MS = 270_000;
const HOUR_MS = 60 * 60 * 1000;
const PER_PATIENT_DELAY_MS = 500; // gentle on Healthie's rate limit

// Telehealth appointments only — in-person visits don't depend on the app.
// Healthie's `contact_type` is a free-text-ish field; the canonical strings
// in this codebase are 'Telehealth' / 'In Person' / 'Video Chat'. We
// normalize to lowercase and include the common synonyms.
const TELEHEALTH_CONTACT_TYPES = new Set([
    'telehealth',
    'video',
    'video chat',
    'videochat',
    'video call',
    'phone call',  // phone calls also rely on the app for in-app dialing on some clinics
]);

interface CandidateRow {
    patient_id: string;
    healthie_client_id: string;
    full_name: string;
    client_type_key: string | null;
    clinic: string | null;
    app_installed: boolean;
    app_version_max: string | null;
    sms_eligible: boolean;
    email_eligible: boolean;
    sms_reachable: boolean;
    email_reachable: boolean;
    allow_appointments: boolean;
}

interface HealthieAppt {
    id: string;
    date: string;
    pm_status?: string | null;
    contact_type?: string | null;
    appointment_type?: { name?: string } | null;
    provider?: { first_name?: string; last_name?: string } | null;
}

interface DryRunPreview {
    patient_id: string;
    healthie_client_id: string;
    appointment_id: string;
    appointment_at: string;
    contact_type: string | null;
    account_key: AccountKey | null;
    idempotency_key: string;
    gate_status: AppVersionStatus;
    gate_reason: string;
    current_version: string | null;
    min_supported_version: string;
    recommended_action: 'install' | 'update' | 'none';
    title: string;
    sms_body: string;
    email_subject: string;
    email_body: string;
    preferred_channel: GatewayChannel;
}

interface LiveSendResult {
    patient_id: string;
    appointment_id: string;
    gate_status: AppVersionStatus;
    status: NotifyResult['status'];
    channel: GatewayChannel | null;
    ledger_id: string;
    idempotent: boolean;
}

function firstName(fullName: string): string {
    return (fullName.split(' ')[0] || 'there').trim();
}

function formatTimeAZ(isoDate: string): string {
    try {
        return new Date(isoDate).toLocaleTimeString('en-US', {
            timeZone: 'America/Phoenix',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

function formatDateAZ(isoDate: string): string {
    try {
        return new Date(isoDate).toLocaleDateString('en-US', {
            timeZone: 'America/Phoenix',
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return '';
    }
}

/** Same mapping the sibling intake-reminders cron uses. Audit metadata only;
 *  notifyPatient does not switch GHL sub-accounts on this today. */
function clientTypeToAccountKey(clientTypeKey: string | null): AccountKey | null {
    if (!clientTypeKey) return null;
    const k = clientTypeKey.toLowerCase();
    if (k === 'abxtac') return 'abxtac';
    if (k.startsWith('nowmenshealth') || k.startsWith('nowlongevity') || k.startsWith('qbo_tcmh')) {
        return 'mensHealth';
    }
    if (
        k.startsWith('nowprimarycare') ||
        k === 'sick_visit' ||
        k.startsWith('primecare_') ||
        k.startsWith('ins_supp')
    ) {
        return 'primaryCare';
    }
    return null;
}

function isTelehealth(contactType: string | null | undefined): boolean {
    if (!contactType) return false;
    return TELEHEALTH_CONTACT_TYPES.has(contactType.toLowerCase().trim());
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NudgeCopy {
    title: string;
    smsBody: string;
    emailSubject: string;
    emailBody: string;
}

function buildNudgeCopy(args: {
    firstName: string;
    apptTypeName: string;
    providerName: string;
    dateStr: string;
    timeStr: string;
    contactType: string;
    evaluation: AppVersionEvaluation;
}): NudgeCopy {
    const { evaluation } = args;
    const verb = evaluation.recommendedAction === 'install' ? 'install' : 'update';
    const verbCap = verb.charAt(0).toUpperCase() + verb.slice(1);

    const title =
        evaluation.recommendedAction === 'install'
            ? 'Install the NowOptimal app before your visit'
            : 'Update the NowOptimal app before your visit';

    // SMS keeps it short. We include only the iOS link — the App Store URL
    // resolves correctly on Android phones too (it bounces to a generic
    // landing). The email gets both links spelled out.
    const smsBody =
        `Hi ${args.firstName}, your ${args.contactType.toLowerCase()} ${args.apptTypeName.toLowerCase()} ` +
        `with ${args.providerName} is ${args.dateStr} at ${args.timeStr}. ` +
        `Please ${verb} the NowOptimal app so you can join the video and receive reminders: ${evaluation.storeLinks.ios} ` +
        `— Granite Mountain Health`;

    const emailSubject =
        evaluation.recommendedAction === 'install'
            ? `Please install the NowOptimal app before your ${args.dateStr} visit`
            : `Please update the NowOptimal app before your ${args.dateStr} visit`;

    const versionLine =
        evaluation.status === 'outdated'
            ? `Your app is on version ${evaluation.currentVersion}; the current supported version is ${evaluation.latestVersion}.\n\n`
            : evaluation.status === 'no_app'
            ? `It looks like the NowOptimal app isn't installed on this account yet.\n\n`
            : '';

    const emailBody =
        `Hi ${args.firstName},\n\n` +
        `You have a ${args.contactType.toLowerCase()} ${args.apptTypeName.toLowerCase()} with ${args.providerName} ` +
        `on ${args.dateStr} at ${args.timeStr}.\n\n` +
        versionLine +
        `${verbCap} the NowOptimal app before your visit so you can join the video and get appointment reminders:\n` +
        `\n` +
        `  • iPhone / iPad: ${evaluation.storeLinks.ios}\n` +
        `  • Android: ${evaluation.storeLinks.android}\n` +
        `\n` +
        `Thank you,\n` +
        `Granite Mountain Health`;

    return { title, smsBody, emailSubject, emailBody };
}

export async function GET(request: NextRequest) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.APP_VERSION_NUDGE_ENABLED === '0') {
        return NextResponse.json({ success: true, disabled: true });
    }

    const dryRun = process.env.APP_VERSION_NUDGE_DRY_RUN !== '0';
    const started = Date.now();

    const now = Date.now();
    // Pre-appointment window: 36–48h before. Wide enough to absorb a missed
    // 30-min tick; idempotency_key (`app-version-nudge:<appt_id>`) is the
    // real backstop against duplicates. 36h is the floor so the nudge lands
    // well before the 24h appointment-reminder cron and gives the patient
    // overnight to actually update.
    const WIN_LO = now + 36 * HOUR_MS;
    const WIN_HI = now + 48 * HOUR_MS;

    try {
        // One JOIN against v_patient_comms_profile — the gateway's single
        // read source for app-state + opt-outs. We pull patients who:
        //   (a) have a healthie_client_id (so we can fetch their appts), and
        //   (b) have at least one non-push channel reachable (otherwise we
        //       literally cannot nudge them — push is by definition broken),
        //   (c) have `allow_appointments=TRUE` (the category gate).
        // Active-status filter mirrors intake-reminders cron.
        const candidates = await query<CandidateRow>(
            `SELECT p.patient_id::text       AS patient_id,
                    p.healthie_client_id     AS healthie_client_id,
                    p.full_name              AS full_name,
                    p.client_type_key        AS client_type_key,
                    p.clinic                 AS clinic,
                    v.app_installed          AS app_installed,
                    v.app_version_max        AS app_version_max,
                    v.sms_eligible           AS sms_eligible,
                    v.email_eligible         AS email_eligible,
                    v.sms_reachable          AS sms_reachable,
                    v.email_reachable        AS email_reachable,
                    v.allow_appointments     AS allow_appointments
               FROM patients p
               JOIN v_patient_comms_profile v ON v.patient_id = p.patient_id
              WHERE p.healthie_client_id IS NOT NULL
                AND COALESCE(p.status_key, 'active') = 'active'
                AND v.allow_appointments = TRUE
                AND (v.sms_eligible = TRUE OR v.email_eligible = TRUE)`
        );

        const APPT_QUERY = `
            query UpcomingApptsForVersionGate($user_id: ID, $filter: String) {
                appointments(user_id: $user_id, filter: $filter, should_paginate: false) {
                    id date pm_status contact_type
                    appointment_type { name }
                    provider { first_name last_name }
                }
            }
        `;

        const previews: DryRunPreview[] = [];
        const sends: LiveSendResult[] = [];
        let patientsChecked = 0;
        let apptsInWindow = 0;
        let apptsTelehealth = 0;
        let gateOkOrUnknown = 0;
        let healthieErrors = 0;
        let timedOut = false;

        for (const c of candidates) {
            if (Date.now() - started > DEADLINE_MS) {
                timedOut = true;
                console.warn('[app-version-nudge] Deadline hit; remaining candidates deferred to next tick');
                break;
            }
            patientsChecked++;

            let appts: HealthieAppt[] = [];
            try {
                const data = await healthieGraphQL<{ appointments: HealthieAppt[] }>(APPT_QUERY, {
                    user_id: c.healthie_client_id,
                    filter: 'upcoming',
                });
                appts = (data.appointments || []).filter((a) => {
                    const s = (a.pm_status || '').toLowerCase();
                    return s !== 'cancelled' && s !== 'canceled';
                });
            } catch (err) {
                healthieErrors++;
                console.error(
                    '[app-version-nudge] Healthie appt fetch failed for',
                    c.healthie_client_id,
                    err instanceof Error ? err.message : err
                );
                await sleep(PER_PATIENT_DELAY_MS);
                continue;
            }

            for (const appt of appts) {
                const when = new Date(appt.date).getTime();
                if (!Number.isFinite(when)) continue;
                if (when < WIN_LO || when > WIN_HI) continue;
                apptsInWindow++;

                if (!isTelehealth(appt.contact_type)) continue;
                apptsTelehealth++;

                const evaluation = evaluateAppVersion({
                    appInstalled: c.app_installed,
                    versionMax: c.app_version_max,
                });

                if (!evaluation.needsUpdate) {
                    gateOkOrUnknown++;
                    continue;
                }

                // Choose a non-push channel. Push is by definition broken for
                // this patient (that's why we're here). Prefer SMS; if not
                // available, fall through to email via the gateway's normal
                // priority.
                const preferredChannel: GatewayChannel = c.sms_eligible ? 'sms' : 'email';

                const providerName = appt.provider
                    ? `${appt.provider.first_name || ''} ${appt.provider.last_name || ''}`.trim() || 'your provider'
                    : 'your provider';
                const apptTypeName = appt.appointment_type?.name || 'appointment';
                const contactType = appt.contact_type || 'telehealth';
                const dateStr = formatDateAZ(appt.date);
                const timeStr = formatTimeAZ(appt.date);
                const fname = firstName(c.full_name);

                const idempotencyKey = `app-version-nudge:${appt.id}`;
                const accountKey = clientTypeToAccountKey(c.client_type_key);
                const copy = buildNudgeCopy({
                    firstName: fname,
                    apptTypeName,
                    providerName,
                    dateStr,
                    timeStr,
                    contactType,
                    evaluation,
                });

                if (dryRun) {
                    previews.push({
                        patient_id: c.patient_id,
                        healthie_client_id: c.healthie_client_id,
                        appointment_id: appt.id,
                        appointment_at: appt.date,
                        contact_type: appt.contact_type ?? null,
                        account_key: accountKey,
                        idempotency_key: idempotencyKey,
                        gate_status: evaluation.status,
                        gate_reason: evaluation.reason,
                        current_version: evaluation.currentVersion,
                        min_supported_version: evaluation.minSupportedVersion,
                        recommended_action: evaluation.recommendedAction,
                        title: copy.title,
                        sms_body: copy.smsBody,
                        email_subject: copy.emailSubject,
                        email_body: copy.emailBody,
                        preferred_channel: preferredChannel,
                    });
                    continue;
                }

                try {
                    const result = await notifyPatient(
                        c.patient_id,
                        {
                            name: 'app_version_nudge_pre_appt',
                            category: 'appointments',
                            idempotencyKey,
                            // No soft dedup beyond the hard idempotency_key —
                            // one nudge per appointment is the contract.
                            dedupWindowMinutes: 0,
                            accountKey: accountKey ?? undefined,
                            preferredChannel,
                            templateKey: 'app_version_nudge_pre_appt.v1',
                            templateVariables: {
                                first_name: fname,
                                provider_name: providerName,
                                appt_type: apptTypeName,
                                appt_date: dateStr,
                                appt_time: timeStr,
                                contact_type: contactType,
                                current_version: evaluation.currentVersion,
                                min_supported_version: evaluation.minSupportedVersion,
                                latest_version: evaluation.latestVersion,
                                recommended_action: evaluation.recommendedAction,
                                gate_status: evaluation.status,
                                gate_reason: evaluation.reason,
                            },
                        },
                        {
                            title: copy.title,
                            // Top-level body satisfies notifyPatient's body
                            // requirement; per-channel bodies override it.
                            body: copy.smsBody,
                            data: {
                                type: 'app_version_nudge',
                                appointmentId: appt.id,
                                gateStatus: evaluation.status,
                                recommendedAction: evaluation.recommendedAction,
                            },
                            sms: { body: copy.smsBody },
                            email: { subject: copy.emailSubject, body: copy.emailBody },
                        },
                        {
                            source: 'cron:app-version-nudge',
                            clinic: c.clinic ?? undefined,
                        }
                    );
                    sends.push({
                        patient_id: c.patient_id,
                        appointment_id: appt.id,
                        gate_status: evaluation.status,
                        status: result.status,
                        channel: result.channel,
                        ledger_id: result.ledgerId,
                        idempotent: result.idempotent,
                    });
                } catch (err) {
                    console.error(
                        '[app-version-nudge] notifyPatient failed for',
                        c.patient_id,
                        appt.id,
                        err instanceof Error ? err.message : err
                    );
                    sends.push({
                        patient_id: c.patient_id,
                        appointment_id: appt.id,
                        gate_status: evaluation.status,
                        status: 'failed',
                        channel: null,
                        ledger_id: '',
                        idempotent: false,
                    });
                }
            }

            await sleep(PER_PATIENT_DELAY_MS);
        }

        // Bucket counts for quick dashboard / log scanning.
        const byChannel: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        const byGate: Record<string, number> = {};
        for (const s of sends) {
            byChannel[s.channel ?? 'none'] = (byChannel[s.channel ?? 'none'] ?? 0) + 1;
            byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
            byGate[s.gate_status] = (byGate[s.gate_status] ?? 0) + 1;
        }
        for (const p of previews) {
            byGate[p.gate_status] = (byGate[p.gate_status] ?? 0) + 1;
        }

        return NextResponse.json({
            success: true,
            dry_run: dryRun,
            duration_ms: Date.now() - started,
            min_supported_version: MIN_SUPPORTED_APP_VERSION,
            latest_version: LATEST_APP_VERSION,
            candidates_total: candidates.length,
            patients_checked: patientsChecked,
            appts_in_window: apptsInWindow,
            appts_telehealth: apptsTelehealth,
            gate_ok_or_unknown: gateOkOrUnknown,
            healthie_errors: healthieErrors,
            timed_out: timedOut,
            previews_count: previews.length,
            sends_count: sends.length,
            by_channel: byChannel,
            by_status: byStatus,
            by_gate: byGate,
            previews: dryRun ? previews : undefined,
            sends: dryRun ? undefined : sends,
        });
    } catch (error) {
        console.error('[app-version-nudge] Fatal:', error);
        return NextResponse.json(
            { error: 'Cron failed', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

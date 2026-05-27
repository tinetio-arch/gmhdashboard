/**
 * Intake-Reminder Cron — Phase 2 of `untangling-healthie-communications-from-healthie`.
 *
 * Goal: replace Healthie's native "finish your intake forms" alert. Find patients
 * with an incomplete Healthie intake AND an upcoming appointment, then send one
 * nudge per appointment via the central `notifyPatient()` gateway (push → SMS →
 * email priority). Single 24h reminder per appointment.
 *
 * Phil's standing rule (project doc): the entire new comms stack stays gated
 * off real patients until he signs off. This route therefore ships in DRY-RUN
 * mode by default. Set `INTAKE_REMINDER_DRY_RUN=0` in `.env.local` to enable
 * real sends through `notifyPatient()`. Dry-run mode logs every would-have-sent
 * candidate (with the full payload + chosen channel preview) in the response —
 * no ledger writes, no patient contact.
 *
 * Cadence note: the sibling Phase-2 task (row 20260526-192906-2008) owns the
 * "per-clinic reminder cadence standard". This cron currently fires a single
 * 24h reminder per appointment, the agreed default. When that task lands, it
 * can plug per-clinic windows in via env / config without changing this file's
 * shape.
 *
 * Run cadence: every 15 min (cron). Wide window (22h–26h before appt) ensures
 * a missed run still catches the send on the next tick; the gateway's
 * idempotency_key (`intake:<appt_id>:24h`) prevents duplicates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { notifyPatient, type GatewayChannel, type NotifyResult } from '@/lib/comms-gateway';
import { type AccountKey } from '@/lib/comms-ledger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEADLINE_MS = 270_000;
const HOUR_MS = 60 * 60 * 1000;
const PER_PATIENT_DELAY_MS = 1000; // stays under Healthie's per-account rate ceiling

interface CandidateRow {
    patient_id: string;
    healthie_client_id: string;
    full_name: string;
    client_type_key: string | null;
    intake_state: 'warn' | 'bad';
    intake_forms_finished: number | null;
    intake_forms_total: number | null;
    intake_fetched_at: string;
}

interface HealthieAppt {
    id: string;
    date: string;
    pm_status?: string | null;
    appointment_type?: { name?: string } | null;
    provider?: { first_name?: string; last_name?: string } | null;
    contact_type?: string | null;
}

interface DryRunPreview {
    patient_id: string;
    healthie_client_id: string;
    appointment_id: string;
    appointment_at: string;
    intake_state: 'warn' | 'bad';
    forms_progress: string;
    account_key: AccountKey | null;
    idempotency_key: string;
    title: string;
    push_body: string;
    sms_body: string;
}

interface LiveSendResult {
    patient_id: string;
    appointment_id: string;
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

/**
 * Map our local `client_type_key` onto the GHL sub-account that owns the
 * patient relationship. This is audit metadata for the ledger; `notifyPatient`
 * does not currently switch GHL accounts on it (the ABXTAC migration sibling
 * task will introduce per-account routing). Returning null is safe.
 */
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (process.env.INTAKE_REMINDER_ENABLED === '0') {
        return NextResponse.json({ success: true, disabled: true });
    }

    const dryRun = process.env.INTAKE_REMINDER_DRY_RUN !== '0';
    const started = Date.now();

    // Single 24h reminder window. Wide enough to absorb a skipped 15-min tick
    // (cron cadence + clock skew) without doubling sends — idempotency_key is
    // the real backstop against duplicates.
    const now = Date.now();
    const WIN_LO = now + 22 * HOUR_MS;
    const WIN_HI = now + 26 * HOUR_MS;

    try {
        // Pull all candidate patients with an incomplete Healthie intake.
        // ABXTAC patients are excluded — they live on our own intake stack
        // (see lib/intakeForms.ts) and never receive Healthie's onboarding flow.
        const candidates = await query<CandidateRow>(
            `SELECT p.patient_id::text       AS patient_id,
                    p.healthie_client_id     AS healthie_client_id,
                    p.full_name              AS full_name,
                    p.client_type_key        AS client_type_key,
                    psc.intake_state         AS intake_state,
                    psc.intake_forms_finished AS intake_forms_finished,
                    psc.intake_forms_total    AS intake_forms_total,
                    psc.intake_fetched_at::text AS intake_fetched_at
               FROM patients p
               JOIN patient_signals_cache psc ON psc.patient_id = p.patient_id
              WHERE psc.intake_state IN ('warn', 'bad')
                AND p.healthie_client_id IS NOT NULL
                AND COALESCE(p.client_type_key, '') <> 'abxtac'
                AND COALESCE(p.status_key, 'active') = 'active'`
        );

        const APPT_QUERY = `
            query UpcomingApptsForIntake($user_id: ID, $filter: String) {
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
        let healthieErrors = 0;
        let timedOut = false;

        for (const c of candidates) {
            if (Date.now() - started > DEADLINE_MS) {
                timedOut = true;
                console.warn('[intake-reminders] Deadline hit; remaining candidates deferred to next tick');
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
                    '[intake-reminders] Healthie appt fetch failed for',
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

                const providerName = appt.provider
                    ? `${appt.provider.first_name || ''} ${appt.provider.last_name || ''}`.trim()
                    : 'your provider';
                const typeName = appt.appointment_type?.name || 'your appointment';
                const timeStr = formatTimeAZ(appt.date);
                const dateStr = formatDateAZ(appt.date);
                const fname = firstName(c.full_name);
                const formsProgress =
                    c.intake_forms_finished !== null && c.intake_forms_total !== null
                        ? `${c.intake_forms_finished}/${c.intake_forms_total} forms done`
                        : c.intake_state === 'bad'
                        ? 'no forms started'
                        : 'in progress';

                const idempotencyKey = `intake:${appt.id}:24h`;
                const accountKey = clientTypeToAccountKey(c.client_type_key);

                const title = 'Finish your intake before your appointment';
                const pushBody = `${typeName} with ${providerName} on ${dateStr} at ${timeStr}. Please complete your intake forms so your provider has what they need.`;
                const smsBody = `Hi ${fname}, your ${typeName.toLowerCase()} is ${dateStr} at ${timeStr}. Please finish your intake forms before then so your provider can review. — Granite Mountain Health`;
                const emailBody =
                    `Hi ${fname},\n\n` +
                    `This is a reminder that your ${typeName.toLowerCase()} with ${providerName} is on ${dateStr} at ${timeStr}.\n\n` +
                    `We still need you to complete your intake forms (${formsProgress}) before the visit so your provider has the most up-to-date information.\n\n` +
                    `Thank you,\nGranite Mountain Health`;
                const emailSubject = 'Please finish your intake forms before your appointment';

                if (dryRun) {
                    previews.push({
                        patient_id: c.patient_id,
                        healthie_client_id: c.healthie_client_id,
                        appointment_id: appt.id,
                        appointment_at: appt.date,
                        intake_state: c.intake_state,
                        forms_progress: formsProgress,
                        account_key: accountKey,
                        idempotency_key: idempotencyKey,
                        title,
                        push_body: pushBody,
                        sms_body: smsBody,
                    });
                    continue;
                }

                try {
                    const result = await notifyPatient(
                        c.patient_id,
                        {
                            name: 'intake_reminder_24h',
                            category: 'appointments',
                            idempotencyKey,
                            dedupWindowMinutes: 60,
                            accountKey: accountKey ?? undefined,
                            templateKey: 'intake_reminder_24h.v1',
                            templateVariables: {
                                first_name: fname,
                                provider_name: providerName,
                                appt_type: typeName,
                                appt_date: dateStr,
                                appt_time: timeStr,
                                forms_progress: formsProgress,
                            },
                        },
                        {
                            title,
                            body: pushBody,
                            data: {
                                type: 'intake_reminder',
                                appointmentId: appt.id,
                                phase: '24h',
                            },
                            push: { body: pushBody },
                            sms: { body: smsBody },
                            email: { subject: emailSubject, body: emailBody },
                        },
                        {
                            source: 'cron:intake-reminders',
                        }
                    );
                    sends.push({
                        patient_id: c.patient_id,
                        appointment_id: appt.id,
                        status: result.status,
                        channel: result.channel,
                        ledger_id: result.ledgerId,
                        idempotent: result.idempotent,
                    });
                } catch (err) {
                    console.error(
                        '[intake-reminders] notifyPatient failed for',
                        c.patient_id,
                        appt.id,
                        err instanceof Error ? err.message : err
                    );
                    sends.push({
                        patient_id: c.patient_id,
                        appointment_id: appt.id,
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
        for (const s of sends) {
            byChannel[s.channel ?? 'none'] = (byChannel[s.channel ?? 'none'] ?? 0) + 1;
            byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
        }

        return NextResponse.json({
            success: true,
            dry_run: dryRun,
            duration_ms: Date.now() - started,
            candidates_total: candidates.length,
            patients_checked: patientsChecked,
            appts_in_window: apptsInWindow,
            healthie_errors: healthieErrors,
            timed_out: timedOut,
            previews_count: previews.length,
            sends_count: sends.length,
            by_channel: byChannel,
            by_status: byStatus,
            previews: dryRun ? previews : undefined,
            sends: dryRun ? undefined : sends,
        });
    } catch (error) {
        console.error('[intake-reminders] Fatal:', error);
        return NextResponse.json(
            { error: 'Cron failed', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

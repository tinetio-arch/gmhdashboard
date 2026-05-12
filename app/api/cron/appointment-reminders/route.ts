/**
 * Appointment Reminder Cron
 *
 * Runs every 15 minutes. For each patient with an active push token, fetches upcoming
 * appointments from Healthie and sends push reminders at two phases:
 *   - 24h out  (dedupe key: appt:<id>:24h)
 *   - 1h out   (dedupe key: appt:<id>:1h)
 *
 * Windows are wide enough (3h for 24h phase, 30m for 1h phase) that a missed run
 * still catches the send on the next tick. The UNIQUE constraint on push_send_log
 * prevents duplicate sends even if the cron overlaps itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { sendPushMessages, PushMessage } from '@/lib/expoPush';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEADLINE_MS = 270_000; // bail before the 5-min cap so we flush the last batch cleanly

interface TokenRow {
    expo_token: string;
    healthie_client_id: string;
    appointments_opt_in: boolean;
}

interface HealthieAppt {
    id: string;
    date: string;
    pm_status?: string | null;
    appointment_type?: { name?: string } | null;
    provider?: { first_name?: string; last_name?: string } | null;
    contact_type?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

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

export async function GET(request: NextRequest) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const started = Date.now();
    const messages: PushMessage[] = [];
    let patientsChecked = 0;
    let appointmentsFound = 0;
    let apiErrors = 0;

    try {
        // One row per (patient, device). A single patient may have multiple devices.
        const tokens = await query<TokenRow>(
            `SELECT expo_token,
                    healthie_client_id,
                    COALESCE((preferences->>'appointments')::boolean, TRUE) AS appointments_opt_in
             FROM patient_push_tokens
             WHERE active = TRUE
               AND COALESCE((preferences->>'appointments')::boolean, TRUE) = TRUE`
        );

        // Group tokens by patient so we only hit Healthie once per patient.
        const tokensByPatient = new Map<string, TokenRow[]>();
        for (const t of tokens) {
            const list = tokensByPatient.get(t.healthie_client_id) || [];
            list.push(t);
            tokensByPatient.set(t.healthie_client_id, list);
        }
        patientsChecked = tokensByPatient.size;

        const now = Date.now();
        // Tune windows to cron cadence (15 min). Keep generous cushions on both sides:
        // 24h phase fires in [22h, 25h]; 1h phase in [45m, 75m].
        const WIN_24H_LO = now + 22 * HOUR_MS;
        const WIN_24H_HI = now + 25 * HOUR_MS;
        const WIN_1H_LO = now + 45 * 60 * 1000;
        const WIN_1H_HI = now + 75 * 60 * 1000;

        const APPT_QUERY = `
            query UpcomingAppts($user_id: ID, $filter: String) {
                appointments(user_id: $user_id, filter: $filter, should_paginate: false) {
                    id date pm_status contact_type
                    appointment_type { name }
                    provider { first_name last_name }
                }
            }
        `;

        let timedOut = false;
        for (const [healthieId, devices] of tokensByPatient) {
            if (Date.now() - started > DEADLINE_MS) {
                timedOut = true;
                console.warn('[appointment-reminders] Deadline hit; remaining patients deferred to next tick');
                break;
            }
            let appts: HealthieAppt[] = [];
            try {
                const data = await healthieGraphQL<{ appointments: HealthieAppt[] }>(
                    APPT_QUERY,
                    { user_id: healthieId, filter: 'upcoming' }
                );
                appts = (data.appointments || []).filter(a => {
                    const s = (a.pm_status || '').toLowerCase();
                    return s !== 'cancelled' && s !== 'canceled';
                });
            } catch (err) {
                apiErrors++;
                console.error('[appointment-reminders] Healthie error for', healthieId, err instanceof Error ? err.message : err);
                continue;
            }

            for (const appt of appts) {
                const when = new Date(appt.date).getTime();
                if (!Number.isFinite(when)) continue;
                appointmentsFound++;

                const providerName = appt.provider
                    ? `${appt.provider.first_name || ''} ${appt.provider.last_name || ''}`.trim()
                    : 'your provider';
                const typeName = appt.appointment_type?.name || 'your appointment';
                const timeStr = formatTimeAZ(appt.date);
                const dateStr = formatDateAZ(appt.date);

                let phase: '24h' | '1h' | null = null;
                if (when >= WIN_24H_LO && when <= WIN_24H_HI) phase = '24h';
                else if (when >= WIN_1H_LO && when <= WIN_1H_HI) phase = '1h';
                if (!phase) continue;

                const title = phase === '24h' ? 'Appointment tomorrow' : 'Appointment in 1 hour';
                const body = phase === '24h'
                    ? `${typeName} with ${providerName} on ${dateStr} at ${timeStr}.`
                    : `${typeName} with ${providerName} at ${timeStr}.`;

                for (const device of devices) {
                    messages.push({
                        target: {
                            expoToken: device.expo_token,
                            healthieClientId: healthieId,
                        },
                        category: 'appointments',
                        dedupeKey: `appt:${appt.id}:${phase}`,
                        title,
                        body,
                        channelId: 'appointments',
                        data: {
                            type: 'appointment_reminder',
                            appointmentId: appt.id,
                            phase,
                            contactType: appt.contact_type || null,
                        },
                    });
                }
            }
        }

        const sendResult = messages.length > 0
            ? await sendPushMessages(messages)
            : { attempted: 0, sent: 0, skippedDuplicate: 0, failed: 0, deviceNotRegistered: 0 };

        return NextResponse.json({
            success: true,
            duration_ms: Date.now() - started,
            patients_checked: patientsChecked,
            appointments_found: appointmentsFound,
            api_errors: apiErrors,
            timed_out: timedOut,
            ...sendResult,
        });
    } catch (error) {
        console.error('[appointment-reminders] Fatal:', error);
        return NextResponse.json(
            { error: 'Cron failed', details: String(error) },
            { status: 500 }
        );
    }
}

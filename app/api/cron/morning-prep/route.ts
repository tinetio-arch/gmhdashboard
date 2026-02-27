import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { sendMessage } from '@/lib/telegram-client';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ==================== AUTH ====================
function verifyCronSecret(request: NextRequest): boolean {
    const cronSecret = request.headers.get('x-cron-secret');
    return cronSecret === process.env.CRON_SECRET;
}

// ==================== HEALTHIE APPOINTMENTS ====================
interface HealthieAppointment {
    id: string;
    date: string;
    appointment_type?: { name?: string } | null;
    provider?: { full_name?: string } | null;
    status?: string | null;
    client?: { id?: string; first_name?: string; last_name?: string } | null;
}

async function fetchTodayAppointments(): Promise<HealthieAppointment[]> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    try {
        const data = await healthieGraphQL<{
            appointments: HealthieAppointment[];
        }>(`
      query GetTodayAppointments($date: String) {
        appointments(
          filter_by_date_range: true,
          date_from: $date,
          date_to: $date,
          should_paginate: false
        ) {
          id
          date
          appointment_type {
            name
          }
          provider {
            full_name
          }
          status
          client {
            id
            first_name
            last_name
          }
        }
      }
    `, { date: todayStr });
        return data.appointments || [];
    } catch (err) {
        console.error('[MorningPrep] Healthie appointments fetch failed:', err instanceof Error ? err.message : err);
        return [];
    }
}

// ==================== CROSS-REFERENCE PATIENTS ====================
interface MatchedPatient {
    healthie_id: string;
    patient_id: string | null;
    full_name: string;
    appointment_type: string;
    provider: string;
    appointment_status: string;
    has_staged_dose: boolean;
    has_payment_issue: boolean;
    has_pending_lab: boolean;
}

async function crossReferencePatients(
    appointments: HealthieAppointment[]
): Promise<MatchedPatient[]> {
    if (appointments.length === 0) return [];

    const healthieIds = appointments
        .map((a) => a.client?.id)
        .filter(Boolean) as string[];

    if (healthieIds.length === 0) return [];

    // Fetch local patients by Healthie ID
    const patients = await query<{
        patient_id: string;
        healthie_client_id: string;
        full_name: string;
    }>(`
    SELECT patient_id, healthie_client_id, full_name
    FROM patients
    WHERE healthie_client_id = ANY($1)
  `, [healthieIds]);

    const patientMap = new Map(
        patients.map((p) => [p.healthie_client_id, p])
    );

    return appointments.map((appt) => {
        const healthieId = appt.client?.id || '';
        const local = patientMap.get(healthieId);
        return {
            healthie_id: healthieId,
            patient_id: local?.patient_id ?? null,
            full_name: local?.full_name ?? `${appt.client?.first_name ?? ''} ${appt.client?.last_name ?? ''}`.trim(),
            appointment_type: appt.appointment_type?.name ?? 'Unknown',
            provider: appt.provider?.full_name ?? 'Unknown',
            appointment_status: appt.status ?? 'unknown',
            has_staged_dose: false,
            has_payment_issue: false,
            has_pending_lab: false,
        };
    });
}

// ==================== CHECK STAGED DOSES ====================
async function checkStagedDoses(matchedPatients: MatchedPatient[]): Promise<void> {
    const patientIds = matchedPatients
        .map((p) => p.patient_id)
        .filter(Boolean) as string[];
    if (patientIds.length === 0) return;

    const staged = await query<{ patient_id: string }>(`
    SELECT DISTINCT patient_id
    FROM staged_doses
    WHERE patient_id = ANY($1)
      AND staged_for_date = (NOW() AT TIME ZONE 'America/Denver')::date
      AND status = 'staged'
  `, [patientIds]);

    const stagedSet = new Set(staged.map((s) => s.patient_id));
    matchedPatients.forEach((p) => {
        if (p.patient_id && stagedSet.has(p.patient_id)) {
            p.has_staged_dose = true;
        }
    });
}

// ==================== CHECK PAYMENT STATUS ====================
async function checkPaymentStatus(matchedPatients: MatchedPatient[]): Promise<{ totalIssues: number; totalOwed: number }> {
    const patientIds = matchedPatients
        .map((p) => p.patient_id)
        .filter(Boolean) as string[];
    if (patientIds.length === 0) return { totalIssues: 0, totalOwed: 0 };

    const issues = await query<{ patient_id: string; amount_owed: string }>(`
    SELECT patient_id, COALESCE(amount_owed, 0) as amount_owed
    FROM payment_issues
    WHERE patient_id = ANY($1) AND resolved_at IS NULL
  `, [patientIds]);

    const issueSet = new Set(issues.map((i) => i.patient_id));
    matchedPatients.forEach((p) => {
        if (p.patient_id && issueSet.has(p.patient_id)) {
            p.has_payment_issue = true;
        }
    });

    const totalOwed = issues.reduce((sum, i) => sum + parseFloat(i.amount_owed || '0'), 0);
    return { totalIssues: issues.length, totalOwed };
}

// ==================== CHECK LAB STATUS ====================
async function checkLabStatus(matchedPatients: MatchedPatient[]): Promise<number> {
    const healthieIds = matchedPatients
        .map((p) => p.healthie_id)
        .filter(Boolean);
    if (healthieIds.length === 0) return 0;

    const labs = await query<{ healthie_id: string }>(`
    SELECT patient->>'healthie_id' as healthie_id
    FROM lab_review_queue
    WHERE patient->>'healthie_id' = ANY($1)
      AND status = 'pending_review'
  `, [healthieIds]);

    const labSet = new Set(labs.map((l) => l.healthie_id));
    matchedPatients.forEach((p) => {
        if (labSet.has(p.healthie_id)) {
            p.has_pending_lab = true;
        }
    });

    return labs.length;
}

// ==================== CHECK INVENTORY ====================
interface InventoryStatus {
    peptide_alerts: Array<{ name: string; stock: number; reorder_point: number }>;
    vial_alerts: Array<{ external_id: string; dea_drug_name: string; remaining_ml: number }>;
}

async function checkInventory(): Promise<InventoryStatus> {
    const [peptides, vials] = await Promise.all([
        // Peptide stock below reorder point
        query<{
            name: string;
            stock: string;
            reorder_point: string;
        }>(`
      SELECT
        p.name,
        COALESCE(
          (SELECT SUM(pi.quantity_on_hand) FROM peptide_inventory pi WHERE pi.product_id = p.product_id),
          0
        )::text as stock,
        p.reorder_point::text
      FROM peptide_products p
      WHERE (
        SELECT COALESCE(SUM(pi.quantity_on_hand), 0)
        FROM peptide_inventory pi
        WHERE pi.product_id = p.product_id
      ) <= p.reorder_point
    `),

        // Active vials with low remaining volume (< 5ml)
        query<{
            external_id: string;
            dea_drug_name: string;
            remaining_volume_ml: string;
        }>(`
      SELECT external_id, dea_drug_name, remaining_volume_ml::text
      FROM vials
      WHERE status = 'Active'
        AND remaining_volume_ml::numeric < 5
        AND remaining_volume_ml::numeric > 0
      ORDER BY remaining_volume_ml ASC
      LIMIT 10
    `),
    ]);

    return {
        peptide_alerts: peptides.map((p) => ({
            name: p.name,
            stock: parseInt(p.stock || '0'),
            reorder_point: parseInt(p.reorder_point || '0'),
        })),
        vial_alerts: vials.map((v) => ({
            external_id: v.external_id,
            dea_drug_name: v.dea_drug_name || 'Unknown',
            remaining_ml: parseFloat(v.remaining_volume_ml || '0'),
        })),
    };
}

// ==================== TELEGRAM DIGEST ====================
function buildTelegramDigest(
    patients: MatchedPatient[],
    inventory: InventoryStatus,
    paymentSummary: { totalIssues: number; totalOwed: number },
    pendingLabs: number
): string {
    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    });

    let msg = `☀️ *MORNING PREP REPORT*\n`;
    msg += `📅 ${today}\n\n`;

    // Today's schedule
    msg += `*📋 Today's Schedule (${patients.length} patients)*\n`;
    if (patients.length === 0) {
        msg += `No appointments found.\n`;
    } else {
        patients.forEach((p) => {
            let flags = '';
            if (p.has_staged_dose) flags += ' 💉';
            if (p.has_payment_issue) flags += ' 💳⚠️';
            if (p.has_pending_lab) flags += ' 🧪';
            msg += `• ${p.full_name} — ${p.appointment_type}${flags}\n`;
        });
    }
    msg += '\n';

    // Alerts summary
    const alerts: string[] = [];

    const withStaged = patients.filter((p) => p.has_staged_dose).length;
    const withoutStaged = patients.filter((p) => !p.has_staged_dose && p.patient_id).length;
    if (withStaged > 0) {
        alerts.push(`💉 ${withStaged} patient(s) have doses pre-staged`);
    }
    if (withoutStaged > 0) {
        alerts.push(`⚠️ ${withoutStaged} patient(s) need doses staged`);
    }
    if (paymentSummary.totalIssues > 0) {
        alerts.push(`💳 ${paymentSummary.totalIssues} payment issue(s) — $${paymentSummary.totalOwed.toFixed(2)} outstanding`);
    }
    if (pendingLabs > 0) {
        alerts.push(`🧪 ${pendingLabs} pending lab review(s)`);
    }

    if (alerts.length > 0) {
        msg += `*⚡ Alerts*\n`;
        msg += alerts.join('\n') + '\n\n';
    }

    // Inventory alerts
    if (inventory.peptide_alerts.length > 0 || inventory.vial_alerts.length > 0) {
        msg += `*📦 Inventory Alerts*\n`;
        inventory.peptide_alerts.forEach((p) => {
            msg += `🔴 ${p.name}: ${p.stock} units (reorder at ${p.reorder_point})\n`;
        });
        inventory.vial_alerts.forEach((v) => {
            msg += `🟡 ${v.external_id} (${v.dea_drug_name}): ${v.remaining_ml.toFixed(1)}ml left\n`;
        });
        msg += '\n';
    }

    msg += `_Dashboard: nowoptimal.com/ops_ 🚀`;
    return msg;
}

// ==================== EMAIL ALERTS (SES) ====================
async function sendCriticalInventoryEmails(inventory: InventoryStatus): Promise<number> {
    if (inventory.peptide_alerts.length === 0) return 0;

    const recipientsEnv = process.env.INVENTORY_ALERT_RECIPIENTS ?? process.env.ADMIN_ALERT_RECIPIENTS;
    const sender = process.env.INVENTORY_ALERT_SENDER ?? process.env.SES_SENDER ?? process.env.ALERT_SENDER;
    const region = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? process.env.SES_REGION;

    if (!recipientsEnv || !sender || !region) {
        console.warn('[MorningPrep] SES not configured — skipping email alerts');
        return 0;
    }

    const recipients = recipientsEnv.split(',').map((e) => e.trim()).filter(Boolean);
    if (recipients.length === 0) return 0;

    const sesClient = new SESClient({ region });
    let sent = 0;

    for (const item of inventory.peptide_alerts) {
        const subject = `⚠️ Low Stock Alert: ${item.name} (${item.stock} units)`;
        const body = [
            `Morning Prep Inventory Alert`,
            ``,
            `Product: ${item.name}`,
            `Current Stock: ${item.stock} units`,
            `Reorder Point: ${item.reorder_point} units`,
            ``,
            `Please reorder immediately.`,
            ``,
            `— GMH Dashboard (Morning Prep Cron)`,
        ].join('\n');

        try {
            await sesClient.send(
                new SendEmailCommand({
                    Source: sender,
                    Destination: { ToAddresses: recipients },
                    Message: {
                        Subject: { Data: subject },
                        Body: { Text: { Data: body } },
                    },
                })
            );
            sent++;
        } catch (err) {
            console.error(`[MorningPrep] SES email failed for ${item.name}:`, err);
        }
    }

    return sent;
}

// ==================== MAIN HANDLER ====================
export async function GET(request: NextRequest) {
    if (!verifyCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();

    try {
        // Step 1: Fetch today's appointments from Healthie
        const appointments = await fetchTodayAppointments();

        // Step 2: Cross-reference with local patients
        const matchedPatients = await crossReferencePatients(appointments);

        // Steps 3-6: Run all checks in parallel
        const [, paymentSummary, pendingLabs, inventory] = await Promise.all([
            checkStagedDoses(matchedPatients),      // Step 3: mutates matchedPatients
            checkPaymentStatus(matchedPatients),     // Step 4: mutates matchedPatients + returns summary
            checkLabStatus(matchedPatients),         // Step 5: mutates matchedPatients + returns count
            checkInventory(),                        // Step 6: returns inventory status
        ]);

        // Step 7: Generate structured summary
        const summary = {
            date: new Date().toISOString().split('T')[0],
            total_appointments: appointments.length,
            matched_patients: matchedPatients.length,
            patients_with_staged_doses: matchedPatients.filter((p) => p.has_staged_dose).length,
            patients_with_payment_issues: matchedPatients.filter((p) => p.has_payment_issue).length,
            patients_with_pending_labs: matchedPatients.filter((p) => p.has_pending_lab).length,
            inventory_alerts: inventory.peptide_alerts.length + inventory.vial_alerts.length,
            patients: matchedPatients,
            inventory,
            payment_summary: paymentSummary,
            pending_labs: pendingLabs,
        };

        // Step 8: Send Telegram digest
        let telegramSent = false;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (chatId) {
            try {
                const digest = buildTelegramDigest(matchedPatients, inventory, paymentSummary, pendingLabs);
                const result = await sendMessage(chatId, digest, { parseMode: 'Markdown', disableWebPagePreview: true });
                telegramSent = result.ok;
                if (!result.ok) {
                    console.error('[MorningPrep] Telegram send failed:', result.error);
                }
            } catch (err) {
                console.error('[MorningPrep] Telegram error:', err);
            }
        } else {
            console.warn('[MorningPrep] TELEGRAM_CHAT_ID not configured — skipping digest');
        }

        // Step 9: Send email alerts for critical inventory
        const emailsSent = await sendCriticalInventoryEmails(inventory);

        const elapsed = Date.now() - startTime;

        return NextResponse.json({
            success: true,
            data: {
                summary,
                notifications: {
                    telegram_sent: telegramSent,
                    emails_sent: emailsSent,
                },
                elapsed_ms: elapsed,
            },
        });
    } catch (error) {
        console.error('[MorningPrep] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

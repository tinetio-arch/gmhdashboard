import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendChatMessage } from '@/lib/notifications/chat';

/**
 * POST /api/jarvis/peptide-order
 * Creates a pending peptide request from a patient via JARVIS.
 * This goes into the staff review queue — no auto-dispensing.
 *
 * Flow: Patient requests via JARVIS → pending record created → staff reviews →
 *       schedules Peptide Education & Pickup appointment → dispenses at visit.
 *
 * Auth: x-jarvis-secret header
 */
export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthieId, peptideName, requestedVia } = body;

        if (!healthieId || !peptideName) {
            return NextResponse.json({ error: 'Missing healthieId or peptideName' }, { status: 400 });
        }

        // Look up patient name for the notification
        let patientName = 'Unknown Patient';
        try {
            const [found] = await query<{ patient_name: string }>(
                `SELECT COALESCE(first_name || ' ' || last_name, first_name, 'Unknown') as patient_name
                 FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
                [healthieId]
            );
            if (found) patientName = found.patient_name;
        } catch {
            // Patient lookup failed — continue with default name
        }
        const patient = { patient_name: patientName };

        // Create a pending dispense record for staff review
        const [dispense] = await query<{ dispense_id: string }>(
            `INSERT INTO peptide_dispenses (
                product_id, patient_name, quantity, status, education_complete, notes
            )
            SELECT
                p.product_id,
                $2,
                1,
                'Pending',
                false,
                $3
            FROM peptide_products p
            WHERE LOWER(p.name) LIKE LOWER($1)
              AND p.active = true
            LIMIT 1
            RETURNING dispense_id`,
            [
                `%${peptideName}%`,
                patient.patient_name,
                `Patient-requested via ${requestedVia || 'JARVIS'} (Healthie ID: ${healthieId})`,
            ]
        );

        if (!dispense) {
            // Product not found in in-house inventory — still notify staff
            const chatWebhook = process.env.GOOGLE_CHAT_REVIEW_WEBHOOK;
            if (chatWebhook) {
                await sendChatMessage(chatWebhook, {
                    text: `*JARVIS — Peptide Request (product not in inventory)*`,
                    cardSections: [{
                        header: 'Patient Request',
                        items: [
                            { key: 'Patient', value: patient.patient_name },
                            { key: 'Healthie ID', value: healthieId },
                            { key: 'Requested', value: peptideName },
                            { key: 'Note', value: 'Product not found in peptide_products — may need to be added or ordered' },
                        ],
                    }],
                });
            }
            return NextResponse.json({ success: true, message: 'Request submitted for review' });
        }

        // Notify staff via Google Chat
        const chatWebhook = process.env.GOOGLE_CHAT_REVIEW_WEBHOOK;
        if (chatWebhook) {
            await sendChatMessage(chatWebhook, {
                text: `*JARVIS — New Peptide Request*`,
                cardSections: [{
                    header: 'Patient Request',
                    items: [
                        { key: 'Patient', value: patient.patient_name },
                        { key: 'Healthie ID', value: healthieId },
                        { key: 'Peptide', value: peptideName },
                        { key: 'Dispense ID', value: dispense.dispense_id },
                        { key: 'Status', value: 'Pending — needs staff review' },
                    ],
                }],
            });
        }

        return NextResponse.json({
            success: true,
            dispenseId: dispense.dispense_id,
            message: 'Request submitted for review',
        });

    } catch (error) {
        console.error('[Jarvis Peptide Order] Error:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}

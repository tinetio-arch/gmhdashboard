import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * POST /api/ipad/kiosk/submit
 * Submits completed form answers to Healthie and creates audit record.
 *
 * Body: {
 *   patient_id: UUID (local),
 *   healthie_patient_id: string,
 *   form_id: string (Healthie custom_module_form_id),
 *   form_name: string,
 *   answers: [{ custom_module_id: string, answer: string }],
 *   signature_data_url?: string,
 *   kiosk_session_id?: string,
 *   device_info?: object
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'read');
        const body = await request.json();

        const {
            patient_id,
            healthie_patient_id,
            form_id,
            form_name,
            answers,
            signature_data_url,
            kiosk_session_id,
            device_info,
        } = body;

        if (!healthie_patient_id || !form_id || !answers || !Array.isArray(answers)) {
            return NextResponse.json({ error: 'Missing required fields: healthie_patient_id, form_id, answers' }, { status: 400 });
        }

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';

        // 1. Create audit record if no session ID provided
        let sessionId = kiosk_session_id;
        if (!sessionId) {
            const rows = await query<{ session_id: string }>(
                `INSERT INTO kiosk_form_sessions
                    (patient_id, healthie_patient_id, form_id, form_name, initiated_by, ip_address, user_agent, device_info)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING session_id`,
                [patient_id || null, healthie_patient_id, form_id, form_name, user.userId, ip, userAgent, JSON.stringify(device_info || {})]
            );
            sessionId = rows[0].session_id;
        }

        // 2. Submit to Healthie via createFormAnswerGroup mutation
        const formAnswersInput = answers.map((a: { custom_module_id: string; answer: string }) => ({
            custom_module_id: a.custom_module_id,
            answer: a.answer,
            user_id: healthie_patient_id,
        }));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const healthieResponse = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    mutation CreateFormAnswerGroup(
                        $formId: ID!,
                        $userId: String!,
                        $formAnswers: [FormAnswerInput!]!,
                        $finished: Boolean
                    ) {
                        createFormAnswerGroup(input: {
                            custom_module_form_id: $formId,
                            user_id: $userId,
                            form_answers: $formAnswers,
                            finished: $finished
                        }) {
                            form_answer_group {
                                id
                                created_at
                                finished
                            }
                            messages {
                                field
                                message
                            }
                        }
                    }
                `,
                variables: {
                    formId: form_id,
                    userId: healthie_patient_id,
                    formAnswers: formAnswersInput,
                    finished: true,
                },
            }),
            signal: controller.signal,
            cache: 'no-store',
        } as any);

        clearTimeout(timeout);

        let healthieGroupId: string | null = null;
        let healthieError: string | null = null;

        if (healthieResponse.ok) {
            const result = await healthieResponse.json();
            if (result.errors) {
                healthieError = result.errors.map((e: any) => e.message).join(', ');
                console.error('[Kiosk Submit] Healthie mutation errors:', healthieError);
            } else {
                const group = result.data?.createFormAnswerGroup?.form_answer_group;
                healthieGroupId = group?.id || null;
            }
        } else {
            healthieError = `Healthie HTTP ${healthieResponse.status}`;
            console.error('[Kiosk Submit]', healthieError);
        }

        // 3. Update audit record with completion
        const completedAt = new Date().toISOString();
        await query(
            `UPDATE kiosk_form_sessions SET
                completed_at = $1,
                submitted_to_healthie = $2,
                healthie_form_answer_group_id = $3,
                signature_captured = $4,
                status = $5
            WHERE session_id = $6`,
            [
                completedAt,
                !!healthieGroupId,
                healthieGroupId,
                !!signature_data_url,
                healthieGroupId ? 'completed' : 'error',
                sessionId,
            ]
        );

        if (healthieError && !healthieGroupId) {
            return NextResponse.json({
                success: false,
                error: 'Form saved locally but Healthie submission failed',
                session_id: sessionId,
                completed_at: completedAt,
            }, { status: 502 });
        }

        return NextResponse.json({
            success: true,
            session_id: sessionId,
            healthie_form_answer_group_id: healthieGroupId,
            completed_at: completedAt,
        });
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error('[Kiosk Submit] Healthie request timed out');
            return NextResponse.json({ error: 'Healthie request timed out' }, { status: 504 });
        }
        console.error('[Kiosk Submit] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

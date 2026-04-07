import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * POST /api/ipad/patient-chart/reset-password
 *
 * Two modes:
 *   1. Set password directly: { healthie_id, password, email?, patient_name? }
 *   2. Send reset email:      { email, action: "send_reset", patient_name? }
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const body = await request.json();
        const { healthie_id, email, password, action, patient_name } = body;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            // Mode 1: Set password directly via updateClient
            if (password && healthie_id) {
                if (password.length < 8) {
                    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
                }

                const resp = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `
                            mutation UpdateClientPassword($input: updateClientInput!) {
                                updateClient(input: $input) {
                                    user { id email }
                                    messages { field message }
                                }
                            }
                        `,
                        variables: {
                            input: {
                                id: healthie_id,
                                password: password,
                            },
                        },
                    }),
                    signal: controller.signal,
                    cache: 'no-store',
                } as any);

                clearTimeout(timeout);

                if (!resp.ok) {
                    console.error(`[ResetPassword] Healthie HTTP ${resp.status}`);
                    return NextResponse.json({ error: 'Healthie request failed' }, { status: 502 });
                }

                const result = await resp.json();
                if (result.errors) {
                    console.error('[ResetPassword] Healthie errors:', result.errors);
                    return NextResponse.json({ error: result.errors[0]?.message || 'Healthie error' }, { status: 502 });
                }

                const messages = result.data?.updateClient?.messages || [];
                if (messages.length > 0) {
                    return NextResponse.json({ success: false, error: messages.map((m: any) => m.message).join(', ') });
                }

                console.log(`[ResetPassword] Password set for ${patient_name || 'unknown'} (Healthie ID: ${healthie_id})`);
                return NextResponse.json({ success: true, method: 'set_password' });
            }

            // Mode 2: Send reset email via resetPassword
            if (email && (action === 'send_reset' || !password)) {
                if (!email.includes('@')) {
                    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
                }

                const resp = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `
                            mutation ResetPassword($input: resetPasswordInput!) {
                                resetPassword(input: $input) {
                                    messages { field message }
                                }
                            }
                        `,
                        variables: {
                            input: { email: email.trim().toLowerCase() },
                        },
                    }),
                    signal: controller.signal,
                    cache: 'no-store',
                } as any);

                clearTimeout(timeout);

                if (!resp.ok) {
                    return NextResponse.json({ error: 'Healthie request failed' }, { status: 502 });
                }

                const result = await resp.json();
                if (result.errors) {
                    return NextResponse.json({ error: result.errors[0]?.message || 'Healthie error' }, { status: 502 });
                }

                console.log(`[ResetPassword] Sent reset email for ${patient_name || 'unknown'} (${email})`);
                return NextResponse.json({ success: true, method: 'reset_email' });
            }

            clearTimeout(timeout);
            return NextResponse.json({ error: 'Provide healthie_id + password, or email + action:send_reset' }, { status: 400 });
        } finally {
            clearTimeout(timeout);
        }
    } catch (error: any) {
        if (error?.status === 401 || error?.message === 'Unauthorized') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (error.name === 'AbortError') {
            return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
        }
        console.error('[ResetPassword] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

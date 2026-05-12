/**
 * POST /api/ipad/forms/cancel
 *
 * Cancel a Healthie form for a patient. Two modes:
 *   { request_id }       → deleteRequestedFormCompletion (cancel a pending/sent form)
 *   { answer_group_id }  → deleteFormAnswerGroup (remove a finished/in-progress submission;
 *                          useful for clearing bogus empty stubs the kiosk creates if a
 *                          patient bails partway through)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    try {
        const body = await request.json();
        const { request_id, answer_group_id } = body;

        if (!request_id && !answer_group_id) {
            return NextResponse.json({ error: 'request_id or answer_group_id required' }, { status: 400 });
        }

        if (request_id) {
            const r = await healthieGraphQL<any>(`
                mutation Del($id: ID) {
                    deleteRequestedFormCompletion(input: { id: $id }) {
                        requestedFormCompletion { id }
                        messages { field message }
                    }
                }
            `, { id: String(request_id) });

            const msgs = r?.deleteRequestedFormCompletion?.messages || [];
            if (msgs.length) {
                return NextResponse.json({ error: msgs.map((m: any) => m.message).join(', ') }, { status: 400 });
            }
            return NextResponse.json({ success: true, kind: 'request_cancelled', id: request_id });
        }

        // answer_group_id path
        const r = await healthieGraphQL<any>(`
            mutation DelAg($id: ID) {
                deleteFormAnswerGroup(input: { id: $id }) {
                    form_answer_group { id }
                    messages { field message }
                }
            }
        `, { id: String(answer_group_id) });

        const msgs = r?.deleteFormAnswerGroup?.messages || [];
        if (msgs.length) {
            return NextResponse.json({ error: msgs.map((m: any) => m.message).join(', ') }, { status: 400 });
        }
        return NextResponse.json({ success: true, kind: 'answer_group_deleted', id: answer_group_id });
    } catch (error) {
        console.error('[ipad/forms/cancel] Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
    }
}

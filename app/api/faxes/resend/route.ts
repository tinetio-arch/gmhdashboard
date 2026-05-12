import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * POST /api/faxes/resend — Resend a previously sent fax via Healthie
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { fax_id } = await request.json();
        if (!fax_id) {
            return NextResponse.json({ success: false, error: 'fax_id is required' }, { status: 400 });
        }

        const mutation = `
            mutation ResendFax($input: resendSentFaxInput!) {
                resendSentFax(input: $input) {
                    sent_fax {
                        id
                        status
                        status_display_string
                        destination_number
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `;

        const result = await healthieGraphQL<{
            resendSentFax: {
                sent_fax: { id: string; status: string; status_display_string: string; destination_number: string } | null;
                messages: Array<{ field: string; message: string }> | null;
            };
        }>(mutation, { input: { id: fax_id } });

        const fax = result.resendSentFax?.sent_fax;
        const messages = result.resendSentFax?.messages;

        if (!fax) {
            const errorMsg = messages?.map(m => m.message).join(', ') || 'Resend failed';
            return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
        }

        console.log(`[API:FaxResend] Resent fax ${fax_id} → new ID ${fax.id}`);
        return NextResponse.json({ success: true, fax });
    } catch (error: any) {
        console.error('[API:FaxResend] Error:', error.message);
        return NextResponse.json({ success: false, error: 'Failed to resend fax' }, { status: 500 });
    }
}

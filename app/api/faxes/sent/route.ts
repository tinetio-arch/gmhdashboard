import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * GET /api/faxes/sent — List sent faxes from Healthie with status tracking.
 * Optional query params: ?limit=25&patient_id=12345
 */

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
    } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const patientId = searchParams.get('patient_id');

        // Build query — Healthie sentFaxes supports offset pagination
        const query = `
            query GetSentFaxes($offset: Int) {
                sentFaxes(offset: $offset) {
                    id
                    status
                    status_display_string
                    destination_number
                    created_at
                    updated_at
                    resendable
                    sender { id first_name last_name }
                    patient { id first_name last_name }
                }
                sentFaxesCount
            }
        `;

        const result = await healthieGraphQL<{
            sentFaxes: Array<{
                id: string;
                status: string;
                status_display_string: string;
                destination_number: string;
                created_at: string;
                updated_at: string;
                resendable: boolean;
                sender: { id: string; first_name: string; last_name: string } | null;
                patient: { id: string; first_name: string; last_name: string } | null;
            }>;
            sentFaxesCount: number;
        }>(query, { offset: 0 });

        let faxes = result.sentFaxes || [];

        // Filter by patient if requested
        if (patientId) {
            faxes = faxes.filter(f => f.patient?.id === patientId);
        }

        return NextResponse.json({
            success: true,
            faxes: faxes.map(f => ({
                id: f.id,
                status: f.status,
                status_display: f.status_display_string,
                destination: f.destination_number,
                patient_name: f.patient ? `${f.patient.first_name} ${f.patient.last_name}` : 'Unknown',
                patient_id: f.patient?.id || null,
                sender_name: f.sender ? `${f.sender.first_name} ${f.sender.last_name}` : 'Unknown',
                sent_at: f.created_at,
                updated_at: f.updated_at,
                resendable: f.resendable,
            })),
            total: result.sentFaxesCount || faxes.length,
        });
    } catch (error: any) {
        console.error('[API:FaxSent] Error:', error.message);
        return NextResponse.json({ success: false, error: 'Failed to load sent faxes' }, { status: 500 });
    }
}

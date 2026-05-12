import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * POST /api/faxes/send — Send a fax via Healthie's createSentFax mutation.
 * Sends selected patient documents to a destination fax number with optional cover page.
 */

const PROVIDERS: Record<string, { id: string; phone_number: string; qualifications: string }> = {
    whitten: { id: '12093125', phone_number: '(928) 212-2772', qualifications: 'NMD' },
    phil:    { id: '12088269', phone_number: '(928) 212-2772', qualifications: 'FNP-C' },
};

const CLINIC_LOCATION = {
    line1: '215 N McCormick St',
    city: 'Prescott',
    state: 'AZ',
    zip: '86301',
    country: 'US',
};

function sanitizeFaxNumber(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '1' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return digits;
    return null;
}

export async function POST(request: NextRequest) {
    let user;
    try {
        user = await requireApiUser(request, 'write');
    } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const {
            patient_id,
            document_ids,
            destination_number,
            recipient_name,
            recipient_company,
            subject,
            remarks,
            include_cover_page = true,
            include_hipaa_disclaimer = true,
            provider = 'whitten',
        } = body;

        // Validate required fields
        if (!destination_number) {
            return NextResponse.json({ success: false, error: 'Destination fax number is required' }, { status: 400 });
        }
        if (!Array.isArray(document_ids) || document_ids.length === 0) {
            return NextResponse.json({ success: false, error: 'At least one document must be selected' }, { status: 400 });
        }
        if (!patient_id) {
            return NextResponse.json({ success: false, error: 'Patient ID is required' }, { status: 400 });
        }

        const cleanNumber = sanitizeFaxNumber(destination_number);
        if (!cleanNumber) {
            return NextResponse.json({ success: false, error: 'Invalid fax number — must be 10 or 11 digits' }, { status: 400 });
        }

        const providerInfo = PROVIDERS[provider] || PROVIDERS.whitten;

        const mutation = `
            mutation CreateSentFax($input: createSentFaxInput!) {
                createSentFax(input: $input) {
                    sent_fax {
                        id
                        status
                        status_display_string
                        destination_number
                        created_at
                        resendable
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `;

        const variables = {
            input: {
                destination_number: cleanNumber,
                patient_id: String(patient_id),
                document_ids: document_ids.join(','),
                recipient_name: recipient_name || undefined,
                recipient_company: recipient_company || undefined,
                subject: subject || 'Patient Records',
                remarks: remarks || undefined,
                skip_cover_page: !include_cover_page,
                include_hipaa_disclaimer,
                include_header_on_every_page: true,
                dietitian: {
                    id: providerInfo.id,
                    phone_number: providerInfo.phone_number,
                    qualifications: providerInfo.qualifications,
                    location: CLINIC_LOCATION,
                },
            },
        };

        console.log(`[API:FaxSend] Sending fax to ${cleanNumber} for patient_id=${patient_id} (${document_ids.length} docs) by ${user.email}`);

        const result = await healthieGraphQL<{
            createSentFax: {
                sent_fax: { id: string; status: string; status_display_string: string; destination_number: string; created_at: string; resendable: boolean } | null;
                messages: Array<{ field: string; message: string }> | null;
            };
        }>(mutation, variables);

        const sentFax = result.createSentFax?.sent_fax;
        const messages = result.createSentFax?.messages;

        if (!sentFax) {
            const errorMsg = messages?.map(m => m.message).join(', ') || 'Healthie did not return a fax record';
            console.error(`[API:FaxSend] Failed: ${errorMsg}`);
            return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
        }

        console.log(`[API:FaxSend] Success: fax_id=${sentFax.id} status=${sentFax.status}`);

        return NextResponse.json({
            success: true,
            fax: {
                id: sentFax.id,
                status: sentFax.status,
                status_display_string: sentFax.status_display_string,
                destination_number: sentFax.destination_number,
                created_at: sentFax.created_at,
                resendable: sentFax.resendable,
            },
        });
    } catch (error: any) {
        console.error('[API:FaxSend] Error:', error.message || error);
        return NextResponse.json({ success: false, error: 'Failed to send fax' }, { status: 500 });
    }
}

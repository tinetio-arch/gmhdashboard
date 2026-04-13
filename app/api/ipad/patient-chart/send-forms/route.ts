/**
 * iPad — Send Healthie forms to a patient.
 *
 * GET  /api/ipad/patient-chart/send-forms/?q=&limit=
 *      Lists available Healthie form templates (customModuleForm), filtered
 *      by keyword. Used by the "Send Forms" modal on the patient chart.
 *
 * POST /api/ipad/patient-chart/send-forms/
 *      Body: { healthie_patient_id: string, form_ids: string[] }
 *      Creates one requestedFormCompletion per form. Healthie emails the
 *      patient a link and the form(s) appear in their pending queue for
 *      kiosk hand-off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CustomModuleForm {
    id: string;
    name: string;
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const { searchParams } = new URL(request.url);
        const q = (searchParams.get('q') || '').toLowerCase().trim();
        const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);

        // customModuleForms doesn't support server-side search consistently,
        // so we pull a page and filter client-side.
        const data = await healthieGraphQL<{ customModuleForms: CustomModuleForm[] }>(
            `query ListForms($limit: Int) {
                customModuleForms(offset: 0, limit: $limit) {
                    id
                    name
                }
            }`,
            { limit }
        );
        let forms = data.customModuleForms || [];
        if (q) forms = forms.filter(f => (f.name || '').toLowerCase().includes(q));
        forms.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        return NextResponse.json({ success: true, forms, count: forms.length });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[send-forms] GET error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to list forms' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = (await request.json()) as {
            healthie_patient_id: string;
            form_ids: string[];
            skip_notification_email?: boolean;
        };

        if (!body.healthie_patient_id || !Array.isArray(body.form_ids) || body.form_ids.length === 0) {
            return NextResponse.json(
                { error: 'healthie_patient_id and at least one form_id required' },
                { status: 400 }
            );
        }

        const mutation = `
            mutation SendForm($input: createRequestedFormInput!) {
                createRequestedFormCompletion(input: $input) {
                    requestedFormCompletion { id custom_module_form { id name } }
                    messages { field message }
                }
            }
        `;

        const results: any[] = [];
        const errors: Array<{ form_id: string; error: string }> = [];

        for (const form_id of body.form_ids) {
            try {
                const input: Record<string, any> = {
                    custom_module_form_id: form_id,
                    recipient_id: body.healthie_patient_id,
                };
                if (body.skip_notification_email) {
                    input.skip_notification_email = true;
                }
                const r = await healthieGraphQL<{
                    createRequestedFormCompletion: {
                        requestedFormCompletion: { id: string; custom_module_form: { id: string; name: string } } | null;
                        messages: Array<{ field: string; message: string }>;
                    };
                }>(mutation, { input });
                const payload = r.createRequestedFormCompletion;
                const msgs = payload?.messages || [];
                if (msgs.length > 0 || !payload?.requestedFormCompletion) {
                    errors.push({ form_id, error: msgs.map(m => m.message).join('; ') || 'Healthie returned no record' });
                } else {
                    results.push({
                        form_id,
                        request_id: payload.requestedFormCompletion.id,
                        name: payload.requestedFormCompletion.custom_module_form?.name,
                    });
                }
            } catch (err: any) {
                errors.push({ form_id, error: err?.message || String(err) });
            }
        }

        const actor = (user as any).email || 'staff';
        console.log(
            `[send-forms] ${actor} → patient ${body.healthie_patient_id}: ${results.length} sent, ${errors.length} failed (ids=${results.map(r => r.form_id).join(',') || 'none'})`
        );

        return NextResponse.json({
            success: errors.length === 0,
            sent: results,
            errors,
            message: errors.length === 0
                ? `Sent ${results.length} form${results.length === 1 ? '' : 's'} to the patient.`
                : `Sent ${results.length}; ${errors.length} failed.`,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[send-forms] POST error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to send forms' }, { status: 500 });
    }
}
